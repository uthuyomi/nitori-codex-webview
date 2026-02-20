import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import type { JsonObject, JsonRpcMessage, JsonRpcRequest } from "./types";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout?: NodeJS.Timeout;
};

export type ServerNotificationHandler = (msg: { method: string; params?: unknown }) => void;
export type ServerRequestHandler = (msg: { id: string | number; method: string; params?: unknown }) => void;

export class CodexAppServerClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<string | number, PendingRequest>();
  private onNotification: ServerNotificationHandler;
  private onServerRequest: ServerRequestHandler;
  private codexPath: string;

  constructor(opts: {
    onNotification: ServerNotificationHandler;
    onServerRequest: ServerRequestHandler;
    codexPath?: string;
  }) {
    this.onNotification = opts.onNotification;
    this.onServerRequest = opts.onServerRequest;
    this.codexPath = opts.codexPath ?? "codex";
  }

  getCodexPath(): string {
    return this.codexPath;
  }

  setCodexPath(codexPath: string): void {
    if (this.proc) throw new Error("cannot change codexPath while running");
    this.codexPath = codexPath;
  }

  isRunning(): boolean {
    return this.proc !== null;
  }

  async start(): Promise<void> {
    if (this.proc) return;

    const proc = spawn(this.codexPath, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.proc = proc;

    const spawnError = new Promise<never>((_, reject) => {
      proc.once("error", (e) => {
        this.proc = null;
        reject(e);
      });
    });

    proc.on("exit", (code, signal) => {
      this.proc = null;
      const err = new Error(`codex app-server exited (code=${code}, signal=${signal})`);
      for (const [, pending] of this.pending) pending.reject(err);
      this.pending.clear();
    });

    proc.stderr.on("data", (chunk) => {
      // Keep stderr for diagnostics; don't treat as protocol.
      // eslint-disable-next-line no-console
      console.warn(String(chunk));
    });

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => this.handleLine(line));

    // Handshake: initialize + initialized notification.
    await Promise.race([
      spawnError,
      this.request(
        "initialize",
        {
          clientInfo: { name: "nitori-codex-webview", title: "Nitori Codex Webview", version: "0.0.1" },
          // Needed for some thread/start fields (e.g. full/extended history persistence).
          capabilities: { experimentalApi: true }
        },
        { timeoutMs: 15000 }
      )
    ]);
    this.notify("initialized");
  }

  stop(): void {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
  }

  async request(method: string, params?: unknown, opts?: { timeoutMs?: number }): Promise<unknown> {
    if (!this.proc) throw new Error("codex app-server is not running");
    const id = this.nextId++;
    const req: JsonRpcRequest = params === undefined ? { id, method } : { id, method, params };
    this.write(req);
    return await new Promise((resolve, reject) => {
      const pending: PendingRequest = { resolve, reject };
      const timeoutMs = opts?.timeoutMs;
      if (timeoutMs && timeoutMs > 0) {
        pending.timeout = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`request timeout: ${method}`));
        }, timeoutMs);
      }
      this.pending.set(id, pending);
    });
  }

  respond(id: string | number, result: unknown): void {
    if (!this.proc) throw new Error("codex app-server is not running");
    this.write({ id, result });
  }

  error(id: string | number, error: { code: number; message: string; data?: unknown }): void {
    if (!this.proc) throw new Error("codex app-server is not running");
    this.write({ id, error });
  }

  notify(method: string, params?: unknown): void {
    if (!this.proc) throw new Error("codex app-server is not running");
    this.write(params === undefined ? { method } : { method, params });
  }

  private write(msg: JsonObject): void {
    if (!this.proc) throw new Error("codex app-server is not running");
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch {
      return;
    }

    if ("id" in msg && "result" in msg) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (pending.timeout) clearTimeout(pending.timeout);
        pending.resolve(msg.result);
      }
      return;
    }

    if ("id" in msg && "error" in msg) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (pending.timeout) clearTimeout(pending.timeout);
        pending.reject(msg.error);
      }
      return;
    }

    if ("method" in msg && "id" in msg) {
      this.onServerRequest({ id: msg.id, method: msg.method, params: msg.params });
      return;
    }

    if ("method" in msg) {
      this.onNotification({ method: msg.method, params: msg.params });
    }
  }
}

export type ThreadStartResult = {
  threadId: string;
  model: string;
  cwd: string;
};

export async function startThread(
  client: CodexAppServerClient,
  opts?: { model?: string | null; cwd?: string | null; approvalPolicy?: string | null; sandbox?: string | null }
): Promise<ThreadStartResult> {
  const res = (await client.request(
    "thread/start",
    {
      model: opts?.model ?? null,
      cwd: opts?.cwd ?? null,
      approvalPolicy: opts?.approvalPolicy ?? null,
      sandbox: opts?.sandbox ?? null,
      experimentalRawEvents: false,
      persistExtendedHistory: true
    },
    { timeoutMs: 15000 }
  )) as any;
  const threadId = res?.thread?.id;
  if (typeof threadId !== "string" || threadId.length === 0) {
    throw new Error("thread/start: missing thread id");
  }
  return {
    threadId,
    model: String(res?.model ?? ""),
    cwd: String(res?.cwd ?? "")
  };
}

export function userTextInput(text: string) {
  return [{ type: "text", text, text_elements: [] }];
}

export function userInputs(text: string, mentionPaths: string[]) {
  const out: any[] = [];
  if (text.trim().length > 0) out.push({ type: "text", text, text_elements: [] });
  for (const p of mentionPaths) {
    if (!p) continue;
    const name = String(p).split(/[\\/]/).pop() ?? String(p);
    out.push({ type: "mention", name, path: p });
  }
  return out;
}

export async function detectCodexExecutable(): Promise<string> {
  if (process.platform !== "win32") return "codex";
  const userProfile = process.env.USERPROFILE;
  if (!userProfile) return "codex";

  const extensionsDir = path.join(userProfile, ".vscode", "extensions");
  if (!existsSync(extensionsDir)) return "codex";

  // Try to locate the VS Code OpenAI extension's bundled codex.exe.
  // Example: ...\openai.chatgpt-0.5.76-win32-x64\bin\windows-x86_64\codex.exe
  let best: { exe: string; mtimeMs: number } | null = null;
  try {
    const entries = await readdir(extensionsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (!ent.name.startsWith("openai.chatgpt-")) continue;
      if (!ent.name.includes("win32-x64")) continue;
      const exe = path.join(extensionsDir, ent.name, "bin", "windows-x86_64", "codex.exe");
      if (!existsSync(exe)) continue;
      const st = await stat(exe);
      const candidate = { exe, mtimeMs: st.mtimeMs };
      if (!best || candidate.mtimeMs > best.mtimeMs) best = candidate;
    }
  } catch {
    return "codex";
  }
  return best?.exe ?? "codex";
}
