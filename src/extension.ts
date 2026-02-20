import * as vscode from "vscode";
import { CodexAppServerClient, detectCodexExecutable, startThread, userInputs, userTextInput } from "./codexAppServer";
import { getWebviewHtml } from "./webviewHtml";
import { NitoriCodexSidebarViewProvider } from "./sidebarView";

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
  | {
      type: "approvalResponse";
      requestId: string | number;
      method: string;
      decision: "accept" | "decline" | "cancel";
    }
  | { type: "userInputResponse"; requestId: string | number; answers: Record<string, string[]> };

type ExtensionToWebview =
  | { type: "status"; status: "connecting" | "ready" | "error"; message?: string }
  | { type: "state"; state: any }
  | { type: "attachments"; files: string[] }
  | { type: "userMessage"; text: string }
  | { type: "assistantStart"; itemId: string }
  | { type: "assistantDelta"; itemId: string; delta: string }
  | { type: "assistantDone"; itemId: string; text: string }
  | { type: "systemDelta"; itemId: string; delta: string }
  | { type: "systemDone"; itemId: string; text: string }
  | { type: "commandExecutionDelta"; itemId: string; delta: string }
  | { type: "commandExecutionDone"; itemId: string; status: string; command: string; output: string }
  | { type: "fileChangeDelta"; itemId: string; delta: string }
  | { type: "fileChangeDone"; itemId: string; changes: Array<{ kind: string; path: string; diff: string }> }
  | { type: "diffUpdated"; diff: string }
  | { type: "turnBusy"; threadId: string; turnId: string | null; busy: boolean }
  | { type: "commandExecutionStart"; itemId: string; command: string }
  | { type: "fileChangeStart"; itemId: string }
  | { type: "systemMessage"; text: string }
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
  const respondedRequestIds = new Set<string | number>();
  const busyByThreadId = new Map<string, { turnId: string; busy: boolean }>();

  const settingsKey = {
    threadId: "nitoriCodex.threadId",
    model: "nitoriCodex.model",
    effort: "nitoriCodex.effort",
    approvalPolicy: "nitoriCodex.approvalPolicy",
    sandbox: "nitoriCodex.sandbox"
  } as const;

  const cfg = vscode.workspace.getConfiguration("nitoriCodex");
  const configuredCodexPath = cfg.get<string | null>("codexPath") ?? null;

  const client = new CodexAppServerClient({
    onNotification: (msg) => {
      if (msg.method === "thread/tokenUsage/updated") {
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
          postAll({ type: "assistantDone", itemId: item.id, text: String(item.text ?? "") });
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
        return;
      }
    },
    onServerRequest: (req) => {
      const target = pickUiWebview();
      if (req.method === "item/tool/requestUserInput") {
        if (target) {
          postTo(target, { type: "userInputRequest", requestId: req.id, params: req.params });
          return;
        }
        void requestUserInputInVsCode(req);
        return;
      }

      if (req.method === "item/tool/call") {
        client.respond(req.id, { contentItems: [], success: false });
        postAll({ type: "systemMessage", text: "tool/call is not implemented in this webview client yet." });
        return;
      }

      if (target) {
        postTo(target, { type: "approvalRequest", requestId: req.id, method: req.method, params: req.params });
        return;
      }
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
        client.respond(req.id, { contentItems: [], success: false });
        return;
      default:
        client.error(req.id, { code: -32601, message: `Unsupported request: ${req.method}` });
    }
  }

  async function ensureReady() {
    if (client.isRunning()) return;

    connectionStatus = "connecting";
    postAll({ type: "status", status: "connecting" });
    try {
      await ensureClientCodexPath();
      await client.start();
      const settings = getRunSettings();
      const started = await startThread(client, {
        model: settings.model,
        cwd: getWorkspaceCwd(),
        approvalPolicy: settings.approvalPolicy,
        sandbox: settings.sandbox
      });
      (context.workspaceState as any).update(settingsKey.threadId, started.threadId);
      connectionStatus = "ready";
      postAll({ type: "status", status: "ready", message: `thread=${started.threadId}` });
      await refreshState();
    } catch (e: any) {
      connectionStatus = "error";
      postAll({ type: "status", status: "error", message: String(e?.message ?? e) });
      throw e;
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

    let thread: any = null;
    try {
      if (threadId) {
        const readRes = await client.request("thread/read", { threadId, includeTurns: true });
        thread = (readRes as any)?.thread ?? null;
      }
    } catch {
      thread = null;
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
      if (sourceWebview) await refreshState(sourceWebview);
      else await refreshState();
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

        postAll({ type: "userMessage", text });
        const threadId = ((context.workspaceState as any).get(settingsKey.threadId) as string) || "";
        const settings = getRunSettings();
        const res = (await client.request("turn/start", {
          threadId,
          input: userInputs(text ?? "", attachments),
          model: settings.model,
          effort: settings.effort
        })) as any;
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

        switch (method) {
          case "item/commandExecution/requestApproval":
            client.respond(requestId, { decision });
            return;
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
        postAll({ type: "userMessage", text });
        const threadId = ((context.workspaceState as any).get(settingsKey.threadId) as string) || "";
        const settings = getRunSettings();
        const res = (await client.request("turn/start", {
          threadId,
          input: userInputs(text ?? "", attachments),
          model: settings.model,
          effort: settings.effort
        })) as any;
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
        switch (method) {
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
