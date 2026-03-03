import * as vscode from "vscode";
import { promises as fs } from "fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { inspect } from "node:util";
import { CodexAppServerClient, detectCodexExecutable, startThread, userInputs, userTextInput } from "./codexAppServer";
import { getWebviewHtml } from "./webviewHtml";
import { NitoriCodexSidebarViewProvider } from "./sidebarView";
import { renderMarkdownWithShiki } from "./markdownRender";

type WebviewToExtension =
  | { type: "send"; text: string; attachments?: string[] }
  | { type: "init" }
  | { type: "interruptTurn" }
  | { type: "newThread" }
  | { type: "forkThread"; threadId: string }
  | { type: "rollbackThread"; threadId: string; numTurns: number }
  | { type: "archiveThread"; threadId: string }
  | { type: "unarchiveThread"; threadId: string }
  | { type: "resumeThread"; threadId: string }
  | { type: "setRunSettings"; model: string | null; effort: string | null }
  | { type: "setAccessSettings"; approvalPolicy: string | null; sandbox: string | null }
  | { type: "pickFiles" }
  | { type: "uploadFiles"; files: Array<{ name: string; mime?: string; dataBase64: string }> }
  | { type: "openExternal"; url: string }
  | { type: "openFileAt"; path: string; line?: number; column?: number }
  | { type: "getFilePreview"; requestId: string | number; path: string }
  | { type: "openLocalFile"; path: string }
  | {
      type: "approvalResponse";
      requestId: string | number;
      method: string;
      decision: "accept" | "decline" | "cancel";
    }
  | { type: "userInputResponse"; requestId: string | number; answers: Record<string, string[]> };

type ExtensionToWebview =
  | { type: "status"; status: "connecting" | "ready" | "error"; message?: string }
  | { type: "shikiCss"; css: string }
  | { type: "state"; state: any }
  | { type: "rateLimits"; rateLimits: any }
  | { type: "attachments"; files: string[] }
  | { type: "attachmentsAdd"; files: string[] }
  | { type: "userMessage"; text: string; attachments?: string[] }
  | { type: "filePreview"; requestId: string | number; path: string; dataUrl: string | null }
  | { type: "assistantStart"; itemId: string }
  | { type: "assistantDelta"; itemId: string; delta: string }
  | { type: "assistantDone"; itemId: string; text: string; html?: string }
  | { type: "assistantRendered"; itemId: string; html: string }
  | { type: "systemDelta"; itemId: string; delta: string }
  | { type: "systemDone"; itemId: string; text: string; html?: string }
  | { type: "commandExecutionDelta"; itemId: string; delta: string }
  | { type: "commandExecutionDone"; itemId: string; status: string; command: string; output: string }
  | { type: "fileChangeDelta"; itemId: string; delta: string }
  | { type: "fileChangeDone"; itemId: string; changes: Array<{ kind: string; path: string; diff: string }> }
  | { type: "diffUpdated"; diff: string }
  | { type: "turnBusy"; threadId: string; turnId: string | null; busy: boolean }
  | { type: "commandExecutionStart"; itemId: string; command: string }
  | { type: "fileChangeStart"; itemId: string }
  | { type: "systemMessage"; text: string; html?: string }
  | {
      type: "approvalRequest";
      requestId: string | number;
      method: string;
      params: unknown;
    }
  | {
      type: "userInputRequest";
      requestId: string | number;
      params: any;
    };

export function activate(context: vscode.ExtensionContext) {
  let panel: vscode.WebviewPanel | null = null;
  let connectionStatus: "connecting" | "ready" | "error" = "connecting";
  const webviews = new Set<vscode.Webview>();
  let lastInteractiveWebview: vscode.Webview | null = null;
  let ensureReadyPromise: Promise<void> | null = null;
  let lastShikiCss = "";
  const renderedHtmlByAgentItemId = new Map<string, string>();
  const respondedRequestIds = new Set<string | number>();
  const busyByThreadId = new Map<string, { turnId: string; busy: boolean }>();
  const pendingApprovalByRequestId = new Map<string | number, { method: string; params: unknown }>();
  const recentCommandApprovalsByThreadId = new Map<string, { cmd: string; atMs: number }>();

  let lastRateLimitsJson = "";
  let lastRateLimitsFetchAtMs = 0;
  let rateLimitsRefreshTimeout: NodeJS.Timeout | null = null;
  let rateLimitsNextDueAtMs = 0;
  let rateLimitsPollInterval: NodeJS.Timeout | null = null;
  let rateLimitsInFlight: Promise<void> | null = null;

  function normalizeOneLine(s: unknown) {
    return String(s ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function safeJsonPreview(v: unknown, maxChars = 1400): string {
    const maxDepth = 4;
    const maxArray = 40;
    const maxString = 800;
    try {
      const seen = new WeakSet<object>();
      const normalize = (val: unknown, depth: number): unknown => {
        if (val === null) return null;
        const t = typeof val;
        if (t === "string") {
          const s = val as string;
          return s.length > maxString ? s.slice(0, maxString) + `… (${s.length} chars)` : s;
        }
        if (t === "number" || t === "boolean" || t === "bigint") return val;
        if (t === "undefined") return "[undefined]";
        if (t === "function") return "[function]";
        if (t === "symbol") return "[symbol]";
        if (val instanceof Error) return { name: val.name, message: val.message, stack: val.stack };
        if (val instanceof Date) return val.toISOString();

        if (t === "object") {
          const obj = val as any;
          if (seen.has(obj)) return "[circular]";
          seen.add(obj);

          if (depth >= maxDepth) return "[max depth]";

          if (Array.isArray(obj)) {
            const sliced = obj.slice(0, maxArray).map((x) => normalize(x, depth + 1));
            if (obj.length > maxArray) sliced.push(`… (${obj.length - maxArray} more)`);
            return sliced;
          }

          const out: Record<string, unknown> = {};
          const keys = Object.keys(obj);
          for (const k of keys.slice(0, 60)) out[k] = normalize(obj[k], depth + 1);
          if (keys.length > 60) out["…"] = `(${keys.length - 60} more keys)`;
          return out;
        }

        return String(val);
      };

      const normalized = normalize(v, 0);
      const s = JSON.stringify(normalized, null, 2);
      if (s.length <= maxChars) return s;
      return s.slice(0, Math.max(0, maxChars - 64)) + `\n… (truncated, ${s.length} chars total)`;
    } catch {
      const s = inspect(v, { depth: 2, maxArrayLength: 30, breakLength: 120 });
      if (s.length <= maxChars) return s;
      return s.slice(0, Math.max(0, maxChars - 64)) + `\n… (truncated, ${s.length} chars total)`;
    }
  }

  async function readTextFileForTool(filePath: string, maxBytes = 512 * 1024): Promise<string> {
    const st = await fs.stat(filePath);
    if (!st.isFile()) throw new Error("not a file");
    if (st.size > maxBytes) {
      const fh = await fs.open(filePath, "r");
      try {
        const buf = Buffer.allocUnsafe(maxBytes);
        const res = await fh.read(buf, 0, maxBytes, 0);
        const head = buf.subarray(0, res.bytesRead).toString("utf8");
        return head + `\n… (truncated, ${st.size} bytes total)`;
      } finally {
        await fh.close();
      }
    }
    return await fs.readFile(filePath, { encoding: "utf8" });
  }

  async function fetchTextForTool(url: string, maxChars = 200_000): Promise<string> {
    const res = await fetch(url, { redirect: "follow" });
    const ct = res.headers.get("content-type") || "";
    const body = await res.text();
    const head = `HTTP ${res.status} ${res.statusText}\ncontent-type: ${ct}\nurl: ${url}\n`;
    if (body.length <= maxChars) return `${head}\n${body}`;
    return `${head}\n${body.slice(0, Math.max(0, maxChars - 64))}\n… (truncated, ${body.length} chars total)`;
  }

  async function duckDuckGoLiteSearch(query: string): Promise<Array<{ title: string; url: string }>> {
    const q = String(query || "").trim();
    if (!q) return [];
    const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { redirect: "follow" });
    const html = await res.text();
    const out: Array<{ title: string; url: string }> = [];

    // Very simple HTML scrape; keep resilient and conservative.
    const re = /<a[^>]+class=['"]result-link['"][^>]+href=['"]([^'"]+)['"][^>]*>(.*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && out.length < 10) {
      const href = String(m[1] || "");
      const rawTitle = String(m[2] || "");
      const title = normalizeOneLine(rawTitle.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim());
      if (!href) continue;
      out.push({ title: title || "(no title)", url: href });
    }
    return out;
  }

  async function runShellForTool(command: string, cwd: string | null): Promise<string> {
    const cmd = String(command || "").trim();
    if (!cmd) throw new Error("missing command");
    return await new Promise((resolve, reject) => {
      const child = spawn(cmd, {
        shell: true,
        cwd: cwd || undefined,
        windowsHide: true,
        env: process.env
      });
      let stdout = "";
      let stderr = "";
      const max = 200_000;
      const timeout = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }, 60_000);

      child.stdout.on("data", (c) => {
        stdout += String(c);
        if (stdout.length > max) stdout = stdout.slice(0, max) + "\n… (truncated)";
      });
      child.stderr.on("data", (c) => {
        stderr += String(c);
        if (stderr.length > max) stderr = stderr.slice(0, max) + "\n… (truncated)";
      });
      child.on("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      child.on("exit", (code, signal) => {
        clearTimeout(timeout);
        const header = `$ ${cmd}\n(exit code=${code}, signal=${signal ?? ""})`;
        const body = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join("\n\n");
        resolve(body ? `${header}\n\n${body}` : header);
      });
    });
  }

  async function executeToolCall(params: unknown): Promise<{ contentItems: any[]; success: boolean }> {
    const p = params as any;
    const toolName = String(p?.tool?.name ?? p?.name ?? "");
    const args = p?.tool?.arguments ?? p?.arguments ?? p?.input ?? p?.params ?? p;

    // Normalized response items: text blocks.
    const textItem = (text: string) => [{ type: "text", text, text_elements: [] }];

    // Heuristic tool name matching (Codex app-server tool names can vary across versions).
    const n = toolName.toLowerCase();

    try {
      if (n.includes("web") && n.includes("search")) {
        const query =
          typeof args?.query === "string"
            ? args.query
            : Array.isArray(args?.search_query) && args.search_query[0] && typeof args.search_query[0].q === "string"
              ? args.search_query[0].q
              : typeof args?.q === "string"
                ? args.q
                : "";
        const results = await duckDuckGoLiteSearch(query);
        const lines = results.map((r) => `- ${r.title} — ${r.url}`);
        const out = `web search: ${query}\n${lines.join("\n")}`;
        return { contentItems: textItem(out), success: true };
      }

      if (n.includes("http") && (n.includes("get") || n.includes("fetch"))) {
        const url = String(args?.url ?? args?.href ?? "").trim();
        if (!url) return { contentItems: textItem("http.get: missing url"), success: false };
        const out = await fetchTextForTool(url);
        return { contentItems: textItem(out), success: true };
      }

      if ((n.includes("fs") || n.includes("file")) && (n.includes("read") || n.includes("load"))) {
        const filePath = String(args?.path ?? args?.filePath ?? "").trim();
        if (!filePath) return { contentItems: textItem("fs.read: missing path"), success: false };
        const out = await readTextFileForTool(filePath);
        return { contentItems: textItem(`file: ${filePath}\n\n${out}`), success: true };
      }

      if (n.includes("shell") || n.includes("exec") || n.includes("command")) {
        const command = String(args?.command ?? args?.cmd ?? args?.input ?? "").trim();
        const cwd = typeof args?.cwd === "string" ? args.cwd : null;
        if (!command) return { contentItems: textItem("shell.exec: missing command"), success: false };
        const out = await runShellForTool(command, cwd);
        return { contentItems: textItem(out), success: true };
      }

      return { contentItems: textItem(`tool/call unsupported: ${toolName || "(unknown tool)"}\n\n${safeJsonPreview(args)}`), success: false };
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "tool error");
      return { contentItems: textItem(`tool/call failed: ${toolName || "(unknown tool)"}\n\n${msg}`), success: false };
    }
  }

  function summarizeWebSearchItem(item: any): string {
    const query = typeof item?.query === "string" ? item.query : "";
    const provider = typeof item?.provider === "string" ? item.provider : "";
    const results = Array.isArray(item?.results) ? item.results : [];

    const header = ["web search", provider ? `provider=${provider}` : "", query ? `query=${query}` : ""]
      .filter(Boolean)
      .join(" ");

    if (results.length === 0) return header;

    const top = results.slice(0, 5).map((r: any) => {
      const title = typeof r?.title === "string" ? normalizeOneLine(r.title) : "";
      const url = typeof r?.url === "string" ? r.url : "";
      const line = [title || "(no title)", url].filter(Boolean).join(" — ");
      return `- ${line}`;
    });

    return `${header}\n${top.join("\n")}${results.length > 5 ? `\n… (${results.length} results total)` : ""}`;
  }

  function summarizeGenericItem(item: any): string {
    const t = String(item?.type ?? "").trim() || "unknown";
    const text = typeof item?.text === "string" ? String(item.text) : "";
    const summaryArr = Array.isArray(item?.summary) ? item.summary : null;
    const summary = summaryArr ? summaryArr.map((s: any) => String(s ?? "")).join("\n") : "";
    const query = typeof item?.query === "string" ? item.query : "";
    const url = typeof item?.url === "string" ? item.url : "";

    const head = [`item: ${t}`, query ? `query=${normalizeOneLine(query)}` : "", url ? `url=${url}` : ""].filter(Boolean).join("\n");
    const body = summary || text;
    if (body) return `${head}\n\n${body}`;
    return `${head}\n\n${safeJsonPreview(item)}`;
  }

  function normalizeApprovalPolicy(p: unknown): string | null {
    const v = String(p ?? "").trim();
    if (!v) return null;
    if (v === "untrusted" || v === "on-failure" || v === "on-request" || v === "never") return v;
    return null;
  }

  function maybeSandboxPolicyForTurn(sandboxMode: unknown) {
    const v = String(sandboxMode ?? "").trim();
    if (v === "danger-full-access") return { type: "dangerFullAccess" as const };
    return null;
  }

  function imageMimeFromPath(p: unknown): string | null {
    const s = String(p ?? "").trim().toLowerCase();
    const ext = s.split(".").pop() ?? "";
    switch (ext) {
      case "png":
        return "image/png";
      case "jpg":
      case "jpeg":
        return "image/jpeg";
      case "gif":
        return "image/gif";
      case "webp":
        return "image/webp";
      case "bmp":
        return "image/bmp";
      default:
        return null;
    }
  }

  function noteRecentCommandApproval(threadId: unknown, cmd: unknown) {
    const tid = String(threadId ?? "").trim();
    const c = normalizeOneLine(cmd);
    if (!tid || !c) return;
    recentCommandApprovalsByThreadId.set(tid, { cmd: c, atMs: Date.now() });
  }

  function shouldAutoApproveLegacyCommand(conversationId: unknown, command: unknown) {
    const tid = String(conversationId ?? "").trim();
    if (!tid) return false;
    const recent = recentCommandApprovalsByThreadId.get(tid);
    if (!recent) return false;
    if (Date.now() - recent.atMs > 2 * 60 * 1000) return false;
    const cmdArr = Array.isArray(command) ? command.map((x) => String(x ?? "")).join(" ") : String(command ?? "");
    const legacyCmd = normalizeOneLine(cmdArr);
    return Boolean(legacyCmd && recent.cmd && legacyCmd === recent.cmd);
  }

  const settingsKey = {
    threadId: "nitoriCodex.threadId",
    model: "nitoriCodex.model",
    effort: "nitoriCodex.effort",
    approvalPolicy: "nitoriCodex.approvalPolicy",
    sandbox: "nitoriCodex.sandbox"
  } as const;

  const cfg = vscode.workspace.getConfiguration("nitoriCodex");
  const configuredCodexPath = cfg.get<string | null>("codexPath") ?? null;
  const verboseEvents = Boolean(cfg.get<boolean>("verboseEvents") ?? false);

  const client = new CodexAppServerClient({
    onNotification: (msg) => {
      if (msg.method === "thread/tokenUsage/updated") {
        // Usage updates can arrive frequently while streaming; keep the footer in sync,
        // but throttle requests to the server.
        scheduleRateLimitsRefresh();
        return;
      }

      if (msg.method === "turn/started") {
        const p = msg.params as any;
        const threadId = String(p?.threadId ?? "");
        const turnId = String(p?.turn?.id ?? "");
        if (threadId && turnId) {
          busyByThreadId.set(threadId, { turnId, busy: true });
          postAll({ type: "turnBusy", threadId, turnId, busy: true });
        }
        scheduleRateLimitsRefresh();
        return;
      }

      if (msg.method === "turn/completed") {
        const p = msg.params as any;
        const threadId = String(p?.threadId ?? "");
        const turnId = String(p?.turn?.id ?? "");
        if (threadId) {
          const prev = busyByThreadId.get(threadId);
          if (!prev || !turnId || prev.turnId === turnId) {
            busyByThreadId.set(threadId, { turnId: turnId || (prev?.turnId ?? ""), busy: false });
            postAll({ type: "turnBusy", threadId, turnId: turnId || (prev?.turnId ?? null), busy: false });
          }
        }
        scheduleRateLimitsRefresh();
        return;
      }

      if (msg.method === "turn/diff/updated") {
        const p = msg.params as any;
        const diff = String(p?.diff ?? "");
        if (diff) postAll({ type: "diffUpdated", diff });
        return;
      }

      if (msg.method === "item/started") {
        const p = msg.params as any;
        const item = p?.item;
        const itemId = String(item?.id ?? "");
        if (!itemId) return;

        if (item?.type === "agentMessage") {
          postAll({ type: "assistantStart", itemId });
          return;
        }
        if (item?.type === "commandExecution") {
          postAll({ type: "commandExecutionStart", itemId, command: String(item?.command ?? "") });
          return;
        }
        if (item?.type === "fileChange") {
          postAll({ type: "fileChangeStart", itemId });
          return;
        }
        if (item?.type === "webSearch") {
          const query = typeof item?.query === "string" ? item.query : "";
          postAll({ type: "systemMessage", text: `web search: ${query || "(query unknown)"}` });
          return;
        }
        return;
      }

      if (msg.method === "item/agentMessage/delta") {
        const p = msg.params as any;
        const itemId = String(p?.itemId ?? "");
        const delta = String(p?.delta ?? "");
        if (itemId) postAll({ type: "assistantDelta", itemId, delta });
        return;
      }

      if (msg.method === "item/commandExecution/outputDelta") {
        const p = msg.params as any;
        const itemId = String(p?.itemId ?? "");
        const delta = String(p?.delta ?? "");
        if (itemId && delta) postAll({ type: "commandExecutionDelta", itemId, delta });
        return;
      }

      if (msg.method === "item/fileChange/outputDelta") {
        const p = msg.params as any;
        const itemId = String(p?.itemId ?? "");
        const delta = String(p?.delta ?? "");
        if (itemId && delta) postAll({ type: "fileChangeDelta", itemId, delta });
        return;
      }

      if (msg.method === "item/completed") {
        const p = msg.params as any;
        const item = p?.item;
        if (item?.type === "agentMessage" && typeof item?.id === "string") {
          const text = String(item.text ?? "");
          postAll({ type: "assistantDone", itemId: item.id, text });
          void (async () => {
            if (!text.trim() || text.length > 200_000) return;
            try {
              const rendered = await renderMarkdownWithShiki(text);
              maybeUpdateShikiCss(rendered.shikiCss);
              if (rendered.html && rendered.html.trim()) {
                renderedHtmlByAgentItemId.set(item.id, rendered.html);
                postAll({ type: "assistantRendered", itemId: item.id, html: rendered.html });
              }
            } catch {
              // ignore render failures
            }
          })();
          return;
        }
        if (item?.type === "commandExecution") {
          const id = String(item.id ?? "");
          if (id) {
            postAll({
              type: "commandExecutionDone",
              itemId: id,
              status: String(item.status ?? ""),
              command: String(item.command ?? ""),
              output: String(item.aggregatedOutput ?? "")
            });
          } else {
            const out = String(item.aggregatedOutput ?? "");
            const summary = `commandExecution: ${String(item.status ?? "")}\n${String(item.command ?? "")}`;
            postAll({ type: "systemMessage", text: out ? `${summary}\n\n${out}` : summary });
          }
          return;
        }
        if (item?.type === "fileChange") {
          const id = String(item.id ?? "");
          const changes = Array.isArray(item.changes) ? item.changes : [];
          if (id) {
            postAll({
              type: "fileChangeDone",
              itemId: id,
              changes: changes.map((c: any) => ({
                kind: String(c?.kind ?? ""),
                path: String(c?.path ?? ""),
                diff: String(c?.diff ?? "")
              }))
            });
          } else {
            const text = changes
              .map((c: any) => `${String(c.kind ?? "")} ${String(c.path ?? "")}\n${String(c.diff ?? "")}`)
              .join("\n");
            postAll({ type: "systemMessage", text: text || "file change" });
          }
        }
        if (item?.type === "webSearch") {
          postAll({
            type: "systemMessage",
            text: verboseEvents
              ? summarizeWebSearchItem(item)
              : `web search done: ${typeof item?.query === "string" && item.query ? item.query : "(query unknown)"}`
          });
          return;
        }
        if (item && verboseEvents) postAll({ type: "systemMessage", text: summarizeGenericItem(item) });
        return;
      }
    },
    onServerRequest: (req) => {
      const target = pickUiWebview();
      const approvalPolicy = normalizeApprovalPolicy(getRunSettings().approvalPolicy);

      // When the user sets approvalPolicy=never, don't ever block on approval prompts.
      // Some servers still emit approval callbacks; auto-approve to match the policy.
      if (approvalPolicy === "never" && req.method !== "item/tool/requestUserInput" && req.method !== "item/tool/call") {
        if (!respondedRequestIds.has(req.id)) respondedRequestIds.add(req.id);
        if (req.method === "item/commandExecution/requestApproval" || req.method === "item/fileChange/requestApproval") {
          client.respond(req.id, { decision: "accept" });
          return;
        }
        if (req.method === "applyPatchApproval" || req.method === "execCommandApproval") {
          client.respond(req.id, { decision: "approved" });
          return;
        }
        client.respond(req.id, { decision: "accept" });
        return;
      }

      // If we already approved the command via the newer item approval, don't prompt again for legacy exec approval.
      if (req.method === "execCommandApproval") {
        const p = req.params as any;
        if (shouldAutoApproveLegacyCommand(p?.conversationId, p?.command)) {
          if (!respondedRequestIds.has(req.id)) respondedRequestIds.add(req.id);
          client.respond(req.id, { decision: "approved" });
          return;
        }
      }

      if (req.method === "item/tool/requestUserInput") {
        if (target) {
          postTo(target, { type: "userInputRequest", requestId: req.id, params: req.params });
          return;
        }
        void requestUserInputInVsCode(req);
        return;
      }

      if (req.method === "item/tool/call") {
        const p = req.params as any;
        const toolName = String(p?.tool?.name ?? p?.name ?? "");
        const args = p?.tool?.arguments ?? p?.arguments ?? p?.input ?? p?.params ?? p;

        postAll({
          type: "systemMessage",
          text: verboseEvents
            ? `tool/call requested: ${toolName || "(unknown tool)"}\n\n${safeJsonPreview(args)}`
            : `tool/call requested: ${toolName || "(unknown tool)"}`
        });

        if (approvalPolicy === "never") {
          if (!respondedRequestIds.has(req.id)) respondedRequestIds.add(req.id);
          client.respond(req.id, {
            contentItems: [{ type: "text", text: "tool/call denied (approvalPolicy=never)", text_elements: [] }],
            success: false
          });
          return;
        }

        if (target) {
          pendingApprovalByRequestId.set(req.id, { method: req.method, params: req.params });
          postTo(target, { type: "approvalRequest", requestId: req.id, method: req.method, params: req.params });
          return;
        }

        pendingApprovalByRequestId.set(req.id, { method: req.method, params: req.params });
        void requestToolCallApprovalInVsCode(req);
        return;
      }

      if (target) {
        pendingApprovalByRequestId.set(req.id, { method: req.method, params: req.params });
        postTo(target, { type: "approvalRequest", requestId: req.id, method: req.method, params: req.params });
        return;
      }
      pendingApprovalByRequestId.set(req.id, { method: req.method, params: req.params });
      void requestApprovalInVsCode(req);
    }
  });

  async function requestApprovalInVsCode(req: { id: string | number; method: string; params?: unknown }) {
    const requestId = req.id;
    if (respondedRequestIds.has(requestId)) return;

    const choice = await vscode.window.showInformationMessage(
      `Approval required: ${req.method}`,
      { modal: true },
      "Accept",
      "Decline",
      "Cancel"
    );
    const decision: "accept" | "decline" | "cancel" =
      choice === "Accept" ? "accept" : choice === "Decline" ? "decline" : "cancel";

    if (respondedRequestIds.has(requestId)) return;
    respondedRequestIds.add(requestId);

    if (decision === "accept") {
      const p = req.params as any;
      if (req.method === "item/commandExecution/requestApproval") {
        noteRecentCommandApproval(p?.threadId, p?.command);
      }
    }

    switch (req.method) {
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        client.respond(requestId, { decision });
        return;
      case "applyPatchApproval":
      case "execCommandApproval":
        client.respond(requestId, {
          decision: decision === "accept" ? "approved" : decision === "cancel" ? "abort" : "denied"
        });
        return;
      default:
        client.respond(requestId, { decision });
    }
  }

  async function requestToolCallApprovalInVsCode(req: { id: string | number; method: string; params?: unknown }) {
    const requestId = req.id;
    if (respondedRequestIds.has(requestId)) return;

    const p = req.params as any;
    const toolName = String(p?.tool?.name ?? p?.name ?? "");
    const args = p?.tool?.arguments ?? p?.arguments ?? p?.input ?? p?.params ?? p;

    const choice = await vscode.window.showInformationMessage(
      `Tool call requested: ${toolName || "(unknown tool)"}`,
      { modal: true, detail: safeJsonPreview(args, 800) },
      "Run",
      "Decline"
    );

    if (respondedRequestIds.has(requestId)) return;
    respondedRequestIds.add(requestId);

    if (choice !== "Run") {
      client.respond(requestId, { contentItems: [{ type: "text", text: "tool/call declined", text_elements: [] }], success: false });
      return;
    }

    const result = await executeToolCall(req.params);
    client.respond(requestId, result);
  }

  async function requestUserInputInVsCode(req: { id: string | number; method: string; params?: any }) {
    const requestId = req.id;
    if (respondedRequestIds.has(requestId)) return;

    const params = req.params ?? {};
    const questions = Array.isArray(params?.questions) ? params.questions : null;
    const answers: Record<string, { answers: string[] }> = {};

    if (questions && questions.length > 0) {
      for (const q of questions) {
        const id = String(q?.id ?? "input");
        const header = String(q?.header ?? id);
        const question = String(q?.question ?? "");
        const value = await vscode.window.showInputBox({
          prompt: `${header}${question ? `: ${question}` : ""}`,
          password: Boolean(q?.isSecret)
        });
        answers[id] = { answers: [String(value ?? "")] };
      }
    } else {
      const value = await vscode.window.showInputBox({ prompt: "Input required" });
      answers["input"] = { answers: [String(value ?? "")] };
    }

    if (respondedRequestIds.has(requestId)) return;
    respondedRequestIds.add(requestId);
    client.respond(requestId, { answers });
  }

  async function ensureClientCodexPath() {
    // Only set if still default.
    const detected = await detectCodexExecutable();
    if (client.getCodexPath() !== "codex") return;
    client.setCodexPath(configuredCodexPath ?? detected);
  }

  function postTo(webview: vscode.Webview, msg: ExtensionToWebview) {
    webview.postMessage(msg);
  }

  function postAll(msg: ExtensionToWebview) {
    for (const w of webviews) w.postMessage(msg);
  }

  function currentThreadId(): string {
    return ((((context.workspaceState as any).get(settingsKey.threadId) as string) || "") as string).trim();
  }

  function isCurrentThreadBusy(): boolean {
    const tid = currentThreadId();
    if (!tid) return false;
    return Boolean(busyByThreadId.get(tid)?.busy);
  }

  function rateLimitsMinIntervalMs(): number {
    // While streaming or running tools, update aggressively so the footer stays "real-time".
    // When idle, refresh occasionally to catch usage changes from other clients too.
    return isCurrentThreadBusy() ? 2_000 : 15_000;
  }

  function startRateLimitsPolling() {
    if (rateLimitsPollInterval) return;
    rateLimitsPollInterval = setInterval(() => scheduleRateLimitsRefresh(0), 15_000);
  }

  function scheduleRateLimitsRefresh(minDelayMs = 250) {
    const now = Date.now();
    const minIntervalMs = rateLimitsMinIntervalMs();
    const earliestAllowedAt = lastRateLimitsFetchAtMs > 0 ? lastRateLimitsFetchAtMs + minIntervalMs : now;
    const dueAt = Math.max(now + Math.max(0, minDelayMs), earliestAllowedAt);

    // If we already have a refresh scheduled, only reschedule if the new due time is sooner.
    if (rateLimitsRefreshTimeout) {
      if (rateLimitsNextDueAtMs && dueAt >= rateLimitsNextDueAtMs - 25) return;
      clearTimeout(rateLimitsRefreshTimeout);
      rateLimitsRefreshTimeout = null;
      rateLimitsNextDueAtMs = 0;
    }

    rateLimitsNextDueAtMs = dueAt;
    rateLimitsRefreshTimeout = setTimeout(() => {
      rateLimitsRefreshTimeout = null;
      rateLimitsNextDueAtMs = 0;
      void refreshRateLimitsNow();
    }, Math.max(0, dueAt - now));
  }

  async function refreshRateLimitsNow() {
    if (rateLimitsInFlight) return await rateLimitsInFlight;
    rateLimitsInFlight = (async () => {
      try {
        await ensureReady();
        lastRateLimitsFetchAtMs = Date.now();
        const rateRes = await client.request("account/rateLimits/read");
        const rateLimits = (rateRes as any)?.rateLimits ?? null;
        const nextJson = JSON.stringify(rateLimits);
        if (nextJson === lastRateLimitsJson) return;
        lastRateLimitsJson = nextJson;
        postAll({ type: "rateLimits", rateLimits });
      } catch {
        // ignore refresh failures
      } finally {
        rateLimitsInFlight = null;
      }
    })();
    return await rateLimitsInFlight;
  }

  function maybeUpdateShikiCss(css: string) {
    const next = String(css || "");
    if (!next || next === lastShikiCss) return;
    lastShikiCss = next;
    postAll({ type: "shikiCss", css: next });
  }

  function sanitizeFilename(name: string): string {
    const base = path.basename(String(name || "file")).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const trimmed = base.trim();
    return trimmed.length > 0 ? trimmed : "file";
  }

  async function ensureUploadDir(): Promise<string> {
    const dir = path.join(context.globalStorageUri.fsPath, "uploads");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  function pickUiWebview(): vscode.Webview | null {
    if (lastInteractiveWebview && webviews.has(lastInteractiveWebview)) return lastInteractiveWebview;
    const first = webviews.values().next();
    return first.done ? null : first.value;
  }

  function safeDecline(req: { id: string | number; method: string }) {
    switch (req.method) {
      case "item/commandExecution/requestApproval":
        client.respond(req.id, { decision: "decline" });
        return;
      case "item/fileChange/requestApproval":
        client.respond(req.id, { decision: "decline" });
        return;
      case "applyPatchApproval":
      case "execCommandApproval":
        client.respond(req.id, { decision: "denied" });
        return;
      case "item/tool/call":
        client.respond(req.id, { contentItems: [{ type: "text", text: "tool/call denied by client", text_elements: [] }], success: false });
        return;
      default:
        client.error(req.id, { code: -32601, message: `Unsupported request: ${req.method}` });
    }
  }

  async function ensureReady() {
    if (client.isRunning()) return;
    if (ensureReadyPromise) return await ensureReadyPromise;

    ensureReadyPromise = (async () => {
      connectionStatus = "connecting";
      postAll({ type: "status", status: "connecting" });
      try {
        await ensureClientCodexPath();
        await client.start();

        const settings = getRunSettings();
        const cwd = getWorkspaceCwd();
        const existingThreadId = (((context.workspaceState as any).get(settingsKey.threadId) as string) || "").trim();

        let activeThreadId = "";
        if (existingThreadId) {
          try {
            await client.request("thread/resume", {
              threadId: existingThreadId,
              cwd,
              approvalPolicy: settings.approvalPolicy,
              sandbox: settings.sandbox,
              persistExtendedHistory: true
            });
            activeThreadId = existingThreadId;
          } catch {
            // Resume may fail if the server lost state or the thread was archived/deleted.
            activeThreadId = "";
          }
        }

        if (!activeThreadId) {
          const started = await startThread(client, {
            model: settings.model,
            cwd,
            approvalPolicy: settings.approvalPolicy,
            sandbox: settings.sandbox
          });
          activeThreadId = started.threadId;
        }

        (context.workspaceState as any).update(settingsKey.threadId, activeThreadId);
        connectionStatus = "ready";
        postAll({ type: "status", status: "ready", message: `thread=${activeThreadId}` });
        await refreshState();
      } catch (e: any) {
        connectionStatus = "error";
        postAll({ type: "status", status: "error", message: String(e?.message ?? e) });
        throw e;
      }
    })();

    try {
      await ensureReadyPromise;
    } finally {
      ensureReadyPromise = null;
    }
  }

  function getWorkspaceCwd(): string | null {
    const f = vscode.workspace.workspaceFolders?.[0];
    return f?.uri.fsPath ?? null;
  }

  function getRunSettings() {
    const model = ((context.workspaceState as any).get(settingsKey.model) as string | null) ?? null;
    const effort = ((context.workspaceState as any).get(settingsKey.effort) as string | null) ?? null;
    const approvalPolicy =
      ((context.workspaceState as any).get(settingsKey.approvalPolicy) as string | null) ?? null;
    const sandbox = ((context.workspaceState as any).get(settingsKey.sandbox) as string | null) ?? null;
    return { model, effort, approvalPolicy, sandbox };
  }

  async function refreshState(target?: vscode.Webview) {
    await ensureReady();

    const cwd = getWorkspaceCwd();
    const threadId = ((context.workspaceState as any).get(settingsKey.threadId) as string) || "";
    const settings = getRunSettings();
    const busyInfo = threadId ? busyByThreadId.get(threadId) : undefined;

    const [modelsRes, threadsRes, rateRes] = await Promise.all([
      client.request("model/list", { limit: 200, includeHidden: false }),
      client.request("thread/list", { limit: 50 }),
      client.request("account/rateLimits/read")
    ]);

    const models = (modelsRes as any)?.data ?? [];
    const threads = (threadsRes as any)?.data ?? [];
    const rateLimits = (rateRes as any)?.rateLimits ?? null;
    try {
      lastRateLimitsJson = JSON.stringify(rateLimits);
      lastRateLimitsFetchAtMs = Date.now();
    } catch {
      // ignore
    }

    let thread: any = null;
    try {
      if (threadId) {
        const readRes = await client.request("thread/read", { threadId, includeTurns: true });
        thread = (readRes as any)?.thread ?? null;
      }
    } catch {
      thread = null;
    }

    // Pre-render markdown + Shiki for history so links/code blocks stay consistent after reload.
    try {
      const turns = thread && Array.isArray(thread.turns) ? thread.turns : [];
      for (const turn of turns) {
        const items = turn && Array.isArray(turn.items) ? turn.items : [];
        for (const item of items) {
          if (!item || typeof item !== "object") continue;
          if (item.type !== "agentMessage") continue;
          const id = typeof item.id === "string" ? item.id : "";
          const text = typeof item.text === "string" ? item.text : "";
          if (!id || !text.trim()) continue;
          if (renderedHtmlByAgentItemId.has(id)) {
            item.html = renderedHtmlByAgentItemId.get(id);
            continue;
          }
          if (text.length > 200_000) continue;
          const rendered = await renderMarkdownWithShiki(text);
          maybeUpdateShikiCss(rendered.shikiCss);
          if (rendered.html && rendered.html.trim()) {
            renderedHtmlByAgentItemId.set(id, rendered.html);
            item.html = rendered.html;
          }
        }
      }
    } catch {
      // ignore
    }

    let config: any = null;
    try {
      config = await client.request("config/read", { includeLayers: false, cwd });
    } catch {
      config = null;
    }

    const msg: ExtensionToWebview = {
      type: "state",
      state: {
        connectionStatus,
        cwd,
        threadId,
        settings,
        models,
        threads,
        rateLimits,
        thread,
        config,
        busy: Boolean(busyInfo?.busy),
        turnId: busyInfo?.turnId ?? null
      }
    };
    if (lastShikiCss) {
      const cssMsg: ExtensionToWebview = { type: "shikiCss", css: lastShikiCss };
      if (target) postTo(target, cssMsg);
      else postAll(cssMsg);
    }
    if (target) postTo(target, msg);
    else postAll(msg);
  }

  async function startNewThread() {
    await ensureReady();
    const settings = getRunSettings();
    const cwd = getWorkspaceCwd();
    const res = (await client.request("thread/start", {
      model: settings.model,
      cwd,
      approvalPolicy: settings.approvalPolicy,
      sandbox: settings.sandbox,
      experimentalRawEvents: false,
      persistExtendedHistory: true
    })) as any;
    const newId = res?.thread?.id;
    if (typeof newId === "string" && newId) {
      (context.workspaceState as any).update(settingsKey.threadId, newId);
      postAll({ type: "systemMessage", text: `New thread: ${newId}` });
      await refreshState();
    }
  }

  async function resumeThread(threadId: string) {
    await ensureReady();
    const cwd = getWorkspaceCwd();
    const settings = getRunSettings();
    await client.request("thread/resume", {
      threadId,
      cwd,
      approvalPolicy: settings.approvalPolicy,
      sandbox: settings.sandbox,
      persistExtendedHistory: true
    });
    (context.workspaceState as any).update(settingsKey.threadId, threadId);
    postAll({ type: "systemMessage", text: `Resumed thread: ${threadId}` });
    await refreshState();
  }

  async function onWebviewMessage(msg: WebviewToExtension, sourceWebview?: vscode.Webview) {
    if (msg.type === "init") {
      startRateLimitsPolling();
      if (sourceWebview) await refreshState(sourceWebview);
      else await refreshState();
      scheduleRateLimitsRefresh(0);
      return;
    }
    if (msg.type === "openExternal") {
      const url = String(msg.url ?? "").trim();
      if (!url) return;
      try {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      } catch {
        // ignore
      }
      return;
    }
    if (msg.type === "openFileAt") {
      const rawPath = String(msg.path ?? "").trim();
      if (!rawPath) return;
      const cwd = getWorkspaceCwd();
      const resolved = path.isAbsolute(rawPath) ? rawPath : cwd ? path.join(cwd, rawPath) : rawPath;
      const uri = vscode.Uri.file(resolved);
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: false });
        const line = Number(msg.line);
        const col = Number(msg.column);
        if (Number.isFinite(line) && line >= 1) {
          const pos = new vscode.Position(line - 1, Number.isFinite(col) && col >= 1 ? col - 1 : 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        }
      } catch {
        postAll({ type: "systemMessage", text: `Open failed: ${resolved}` });
      }
      return;
    }
    if (msg.type === "getFilePreview") {
      const target = sourceWebview ?? lastInteractiveWebview;
      if (!target) return;
      const mime = imageMimeFromPath(msg.path);
      if (!mime) {
        postTo(target, { type: "filePreview", requestId: msg.requestId, path: msg.path, dataUrl: null });
        return;
      }
      try {
        const st = await fs.stat(msg.path);
        const maxBytes = 6 * 1024 * 1024;
        if (!st.isFile() || st.size > maxBytes) {
          postTo(target, { type: "filePreview", requestId: msg.requestId, path: msg.path, dataUrl: null });
          return;
        }
        const buf = await fs.readFile(msg.path);
        const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
        postTo(target, { type: "filePreview", requestId: msg.requestId, path: msg.path, dataUrl });
      } catch {
        postTo(target, { type: "filePreview", requestId: msg.requestId, path: msg.path, dataUrl: null });
      }
      return;
    }
    if (msg.type === "openLocalFile") {
      const p = String(msg.path ?? "").trim();
      if (!p) return;
      try {
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(p));
      } catch {
        // ignore
      }
      return;
    }
    if (msg.type === "interruptTurn") {
      await ensureReady();
      const threadId = ((context.workspaceState as any).get(settingsKey.threadId) as string) || "";
      const info = threadId ? busyByThreadId.get(threadId) : undefined;
      const turnId = info?.turnId ?? null;
      if (!threadId || !turnId) {
        postAll({ type: "systemMessage", text: "中断できる作業が見つかりませんでした。" });
        return;
      }
      try {
        await client.request("turn/interrupt", { threadId, turnId });
        postAll({ type: "systemMessage", text: "作業を中断しました。" });
      } catch (e: any) {
        postAll({ type: "systemMessage", text: `中断に失敗: ${String(e?.message ?? e)}` });
      }
      return;
    }
    if (msg.type === "setRunSettings") {
      (context.workspaceState as any).update(settingsKey.model, msg.model);
      (context.workspaceState as any).update(settingsKey.effort, msg.effort);
      await refreshState();
      return;
    }
    if (msg.type === "setAccessSettings") {
      (context.workspaceState as any).update(settingsKey.approvalPolicy, msg.approvalPolicy);
      (context.workspaceState as any).update(settingsKey.sandbox, msg.sandbox);
      const threadId = ((context.workspaceState as any).get(settingsKey.threadId) as string) || "";
      if (threadId) await resumeThread(threadId);
      await refreshState();
      return;
    }
    if (msg.type === "newThread") {
      await startNewThread();
      return;
    }
    if (msg.type === "resumeThread") {
      const threadId = msg.threadId?.trim();
      if (!threadId) return;
      await resumeThread(threadId);
      return;
    }
    if (msg.type === "forkThread") {
      const threadId = msg.threadId?.trim();
      if (!threadId) return;
      const cwd = getWorkspaceCwd();
      const settings = getRunSettings();
      const res = (await client.request("thread/fork", {
        threadId,
        cwd,
        model: settings.model,
        approvalPolicy: settings.approvalPolicy,
        sandbox: settings.sandbox,
        persistExtendedHistory: true
      })) as any;
      const newId = res?.thread?.id;
      if (typeof newId === "string" && newId) {
        (context.workspaceState as any).update(settingsKey.threadId, newId);
        postAll({ type: "systemMessage", text: `Forked thread: ${newId}` });
        await refreshState();
      }
      return;
    }
    if (msg.type === "rollbackThread") {
      const threadId = msg.threadId?.trim();
      const numTurns = Number(msg.numTurns);
      if (!threadId || !Number.isFinite(numTurns) || numTurns < 1) return;
      await client.request("thread/rollback", { threadId, numTurns });
      postAll({ type: "systemMessage", text: `Rolled back ${numTurns} turn(s).` });
      await refreshState();
      return;
    }
    if (msg.type === "archiveThread") {
      const threadId = msg.threadId?.trim();
      if (!threadId) return;
      await client.request("thread/archive", { threadId });
      postAll({ type: "systemMessage", text: `Archived thread: ${threadId}` });
      await refreshState();
      return;
    }
    if (msg.type === "unarchiveThread") {
      const threadId = msg.threadId?.trim();
      if (!threadId) return;
      await client.request("thread/unarchive", { threadId });
      postAll({ type: "systemMessage", text: `Unarchived thread: ${threadId}` });
      await refreshState();
      return;
    }
    if (msg.type === "pickFiles") {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: "Attach"
      });
      postAll({ type: "attachments", files: (picked ?? []).map((u) => u.fsPath) });
      return;
    }
    if (msg.type === "uploadFiles") {
      const files = Array.isArray(msg.files) ? msg.files : [];
      if (files.length === 0) return;

      const dir = await ensureUploadDir();
      const written: string[] = [];
      const maxBytes = 6 * 1024 * 1024;

      for (const f of files) {
        const name = sanitizeFilename(String((f as any)?.name ?? "file"));
        const dataBase64 = String((f as any)?.dataBase64 ?? "");
        if (!dataBase64) continue;
        let buf: Buffer;
        try {
          buf = Buffer.from(dataBase64, "base64");
        } catch {
          continue;
        }
        if (buf.length === 0 || buf.length > maxBytes) continue;
        const outPath = path.join(dir, `${randomUUID()}-${name}`);
        try {
          await fs.writeFile(outPath, buf);
          written.push(outPath);
        } catch {
          // ignore per-file failures
        }
      }

      if (written.length > 0) postAll({ type: "attachmentsAdd", files: written });
      else postAll({ type: "systemMessage", text: "添付の取り込みに失敗しました（サイズ超過か形式不明）。" });
      return;
    }
  }

  const cmd = vscode.commands.registerCommand("nitoriCodex.open", async () => {
    if (panel) {
      panel.reveal();
      lastInteractiveWebview = panel.webview;
      return;
    }

    panel = vscode.window.createWebviewPanel(
      "nitoriCodex",
      "Nitori Codex",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);
    webviews.add(panel.webview);
    lastInteractiveWebview = panel.webview;

    panel.onDidDispose(() => {
      const disposedWebview = panel?.webview ?? null;
      panel = null;
      if (disposedWebview) {
        webviews.delete(disposedWebview);
        if (lastInteractiveWebview === disposedWebview) lastInteractiveWebview = null;
      }
    });

    panel.webview.onDidReceiveMessage(async (msg: WebviewToExtension) => {
      lastInteractiveWebview = panel?.webview ?? lastInteractiveWebview;
      await onWebviewMessage(msg, panel?.webview ?? undefined);
      if (msg.type === "send") {
        const text = msg.text?.trim();
        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        if (!text && attachments.length === 0) return;
        await ensureReady();

        postAll({ type: "userMessage", text, attachments });
        const threadId = ((context.workspaceState as any).get(settingsKey.threadId) as string) || "";
        const settings = getRunSettings();
        const cwd = getWorkspaceCwd();
        const approvalPolicy = normalizeApprovalPolicy(settings.approvalPolicy);
        const sandboxPolicy = maybeSandboxPolicyForTurn(settings.sandbox);
        const input = await userInputs(text ?? "", attachments);
        const res = (await client.request("turn/start", {
          threadId,
          input,
          cwd,
          approvalPolicy,
          sandboxPolicy: sandboxPolicy ?? undefined,
          model: settings.model,
          effort: settings.effort
        })) as any;
        scheduleRateLimitsRefresh();
        const turnId = String(res?.turn?.id ?? "");
        if (threadId && turnId) {
          busyByThreadId.set(threadId, { turnId, busy: true });
          postAll({ type: "turnBusy", threadId, turnId, busy: true });
        }
        return;
      }

      if (msg.type === "approvalResponse") {
        const { requestId, method, decision } = msg;
        if (typeof requestId !== "string" && typeof requestId !== "number") return;
        if (respondedRequestIds.has(requestId)) return;
        respondedRequestIds.add(requestId);

        const pending = pendingApprovalByRequestId.get(requestId);
        pendingApprovalByRequestId.delete(requestId);
        if (decision === "accept" && pending && pending.method === "item/commandExecution/requestApproval") {
          const p = pending.params as any;
          noteRecentCommandApproval(p?.threadId, p?.command);
        }

        switch (method) {
          case "item/commandExecution/requestApproval":
            client.respond(requestId, { decision });
            return;
          case "item/fileChange/requestApproval":
            client.respond(requestId, { decision });
            return;
          case "item/tool/call": {
            if (decision !== "accept") {
              client.respond(requestId, {
                contentItems: [{ type: "text", text: "tool/call declined", text_elements: [] }],
                success: false
              });
              return;
            }
            postAll({ type: "systemMessage", text: "tool/call running…" });
            const result = await executeToolCall(pending?.params);
            client.respond(requestId, result);
            postAll({ type: "systemMessage", text: result.success ? "tool/call done." : "tool/call failed." });
            return;
          }
          case "applyPatchApproval":
          case "execCommandApproval":
            client.respond(requestId, {
              decision: decision === "accept" ? "approved" : decision === "cancel" ? "abort" : "denied"
            });
            return;
          default:
            client.respond(requestId, { decision });
        }
        return;
      }

      if (msg.type === "userInputResponse") {
        const { requestId, answers } = msg;
        if (typeof requestId !== "string" && typeof requestId !== "number") return;
        if (respondedRequestIds.has(requestId)) return;
        respondedRequestIds.add(requestId);
        const wrapped: Record<string, { answers: string[] }> = {};
        for (const [k, v] of Object.entries(answers ?? {})) wrapped[k] = { answers: v };
        client.respond(requestId, { answers: wrapped });
      }
    });

    await ensureReady();
  });

  const sidebarProvider = new NitoriCodexSidebarViewProvider(context.extensionUri, (webview) => {
    webviews.add(webview);
    lastInteractiveWebview = webview;
    webview.onDidReceiveMessage(async (msg: WebviewToExtension) => {
      lastInteractiveWebview = webview;
      await onWebviewMessage(msg, webview);
      if (msg.type === "send") {
        const text = msg.text?.trim();
        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        if (!text && attachments.length === 0) return;
        await ensureReady();
        postAll({ type: "userMessage", text, attachments });
        const threadId = ((context.workspaceState as any).get(settingsKey.threadId) as string) || "";
        const settings = getRunSettings();
        const cwd = getWorkspaceCwd();
        const approvalPolicy = normalizeApprovalPolicy(settings.approvalPolicy);
        const sandboxPolicy = maybeSandboxPolicyForTurn(settings.sandbox);
        const input = await userInputs(text ?? "", attachments);
        const res = (await client.request("turn/start", {
          threadId,
          input,
          cwd,
          approvalPolicy,
          sandboxPolicy: sandboxPolicy ?? undefined,
          model: settings.model,
          effort: settings.effort
        })) as any;
        scheduleRateLimitsRefresh();
        const turnId = String(res?.turn?.id ?? "");
        if (threadId && turnId) {
          busyByThreadId.set(threadId, { turnId, busy: true });
          postAll({ type: "turnBusy", threadId, turnId, busy: true });
        }
        return;
      }
      if (msg.type === "approvalResponse") {
        const { requestId, method, decision } = msg;
        if (typeof requestId !== "string" && typeof requestId !== "number") return;
        if (respondedRequestIds.has(requestId)) return;
        respondedRequestIds.add(requestId);

        const pending = pendingApprovalByRequestId.get(requestId);
        pendingApprovalByRequestId.delete(requestId);
        if (decision === "accept" && pending && pending.method === "item/commandExecution/requestApproval") {
          const p = pending.params as any;
          noteRecentCommandApproval(p?.threadId, p?.command);
        }

        switch (method) {
          case "item/commandExecution/requestApproval":
          case "item/fileChange/requestApproval":
            client.respond(requestId, { decision });
            return;
          case "item/tool/call": {
            if (decision !== "accept") {
              client.respond(requestId, {
                contentItems: [{ type: "text", text: "tool/call declined", text_elements: [] }],
                success: false
              });
              return;
            }
            postAll({ type: "systemMessage", text: "tool/call running…" });
            const result = await executeToolCall(pending?.params);
            client.respond(requestId, result);
            postAll({ type: "systemMessage", text: result.success ? "tool/call done." : "tool/call failed." });
            return;
          }
          case "applyPatchApproval":
          case "execCommandApproval":
            client.respond(requestId, {
              decision: decision === "accept" ? "approved" : decision === "cancel" ? "abort" : "denied"
            });
            return;
          default:
            client.respond(requestId, { decision });
        }
        return;
      }
      if (msg.type === "userInputResponse") {
        const { requestId, answers } = msg;
        if (typeof requestId !== "string" && typeof requestId !== "number") return;
        if (respondedRequestIds.has(requestId)) return;
        respondedRequestIds.add(requestId);
        const wrapped: Record<string, { answers: string[] }> = {};
        for (const [k, v] of Object.entries(answers ?? {})) wrapped[k] = { answers: v };
        client.respond(requestId, { answers: wrapped });
      }
    });

    void ensureReady();
  });

  context.subscriptions.push(
    cmd,
    vscode.window.registerWebviewViewProvider(NitoriCodexSidebarViewProvider.viewType, sidebarProvider)
  );
}

export function deactivate() {}
