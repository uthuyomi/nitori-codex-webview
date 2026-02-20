"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));

// src/codexAppServer.ts
var import_node_child_process = require("node:child_process");
var import_node_readline = require("node:readline");
var import_promises = require("node:fs/promises");
var import_node_fs = require("node:fs");
var path = __toESM(require("node:path"));
var CodexAppServerClient = class {
  proc = null;
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  onNotification;
  onServerRequest;
  codexPath;
  constructor(opts) {
    this.onNotification = opts.onNotification;
    this.onServerRequest = opts.onServerRequest;
    this.codexPath = opts.codexPath ?? "codex";
  }
  getCodexPath() {
    return this.codexPath;
  }
  setCodexPath(codexPath) {
    if (this.proc) throw new Error("cannot change codexPath while running");
    this.codexPath = codexPath;
  }
  isRunning() {
    return this.proc !== null;
  }
  async start() {
    if (this.proc) return;
    const proc = (0, import_node_child_process.spawn)(this.codexPath, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.proc = proc;
    const spawnError = new Promise((_, reject) => {
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
      console.warn(String(chunk));
    });
    const rl = (0, import_node_readline.createInterface)({ input: proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => this.handleLine(line));
    await Promise.race([
      spawnError,
      this.request(
        "initialize",
        {
          clientInfo: { name: "nitori-codex-webview", title: "Nitori Codex Webview", version: "0.0.1" },
          // Needed for some thread/start fields (e.g. full/extended history persistence).
          capabilities: { experimentalApi: true }
        },
        { timeoutMs: 15e3 }
      )
    ]);
    this.notify("initialized");
  }
  stop() {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
  }
  async request(method, params, opts) {
    if (!this.proc) throw new Error("codex app-server is not running");
    const id = this.nextId++;
    const req = params === void 0 ? { id, method } : { id, method, params };
    this.write(req);
    return await new Promise((resolve, reject) => {
      const pending = { resolve, reject };
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
  respond(id, result) {
    if (!this.proc) throw new Error("codex app-server is not running");
    this.write({ id, result });
  }
  error(id, error) {
    if (!this.proc) throw new Error("codex app-server is not running");
    this.write({ id, error });
  }
  notify(method, params) {
    if (!this.proc) throw new Error("codex app-server is not running");
    this.write(params === void 0 ? { method } : { method, params });
  }
  write(msg) {
    if (!this.proc) throw new Error("codex app-server is not running");
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }
  handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
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
};
async function startThread(client, opts) {
  const res = await client.request(
    "thread/start",
    {
      model: opts?.model ?? null,
      cwd: opts?.cwd ?? null,
      approvalPolicy: opts?.approvalPolicy ?? null,
      sandbox: opts?.sandbox ?? null,
      experimentalRawEvents: false,
      persistExtendedHistory: true
    },
    { timeoutMs: 15e3 }
  );
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
function userInputs(text, mentionPaths) {
  const out = [];
  if (text.trim().length > 0) out.push({ type: "text", text, text_elements: [] });
  for (const p of mentionPaths) {
    if (!p) continue;
    const name = String(p).split(/[\\/]/).pop() ?? String(p);
    out.push({ type: "mention", name, path: p });
  }
  return out;
}
async function detectCodexExecutable() {
  if (process.platform !== "win32") return "codex";
  const userProfile = process.env.USERPROFILE;
  if (!userProfile) return "codex";
  const extensionsDir = path.join(userProfile, ".vscode", "extensions");
  if (!(0, import_node_fs.existsSync)(extensionsDir)) return "codex";
  let best = null;
  try {
    const entries = await (0, import_promises.readdir)(extensionsDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (!ent.name.startsWith("openai.chatgpt-")) continue;
      if (!ent.name.includes("win32-x64")) continue;
      const exe = path.join(extensionsDir, ent.name, "bin", "windows-x86_64", "codex.exe");
      if (!(0, import_node_fs.existsSync)(exe)) continue;
      const st = await (0, import_promises.stat)(exe);
      const candidate = { exe, mtimeMs: st.mtimeMs };
      if (!best || candidate.mtimeMs > best.mtimeMs) best = candidate;
    }
  } catch {
    return "codex";
  }
  return best?.exe ?? "codex";
}

// src/webviewHtml.ts
var vscode = __toESM(require("vscode"));
function nonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function getWebviewHtml(webview, extensionUri) {
  const n = nonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.css"));
  const toolkitUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "toolkit.min.js"));
  const avatarUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "nitori.png"));
  const backgroundUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "background.png"));
  const cacheBust = Date.now();
  const avatarSrc = `${avatarUri.toString()}?v=${cacheBust}`;
  const backgroundSrc = `${backgroundUri.toString()}?v=${cacheBust}`;
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'nonce-${n}'`,
    `script-src 'nonce-${n}'`
  ].join("; ");
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${styleUri}" />
    <style nonce="${n}">
      :root { --nitori-bg-url: url("${backgroundSrc}"); }
    </style>
    <title>Nitori Codex</title>
  </head>
  <body>
    <svg class="svg-sprite" xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false">
      <symbol id="ico-cloud" viewBox="0 0 24 24">
        <path fill="currentColor" d="M19 18a4 4 0 0 0-.6-8A6 6 0 1 0 6.2 17.9A3.5 3.5 0 0 0 7.5 18H19Zm0 2H7.5a5.5 5.5 0 0 1-1.9-10.7A8 8 0 0 1 21.4 9.7A6 6 0 0 1 19 20Z"/>
      </symbol>
      <symbol id="ico-list" viewBox="0 0 24 24">
        <path fill="currentColor" d="M4 6h2v2H4V6Zm4 0h14v2H8V6ZM4 11h2v2H4v-2Zm4 0h14v2H8v-2ZM4 16h2v2H4v-2Zm4 0h14v2H8v-2Z"/>
      </symbol>
      <symbol id="ico-plus" viewBox="0 0 24 24">
        <path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/>
      </symbol>
      <symbol id="ico-fork" viewBox="0 0 24 24">
        <path fill="currentColor" d="M7 3a3 3 0 0 0-1 5.8V11a4 4 0 0 0 4 4h2v.2a3 3 0 1 0 2 0V15h2a4 4 0 0 0 4-4V8.8a3 3 0 1 0-2 0V11a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V8.8A3 3 0 0 0 7 3Zm14 0a1 1 0 1 1 0 2a1 1 0 0 1 0-2ZM7 5a1 1 0 1 1 0-2a1 1 0 0 1 0 2Zm7 16a1 1 0 1 1 0-2a1 1 0 0 1 0 2Z"/>
      </symbol>
      <symbol id="ico-undo" viewBox="0 0 24 24">
        <path fill="currentColor" d="M7.6 7H4V3.4L5.4 4.8A10 10 0 1 1 2 12h2a8 8 0 1 0 2.8-6.1L7.6 7Z"/>
      </symbol>
      <symbol id="ico-archive" viewBox="0 0 24 24">
        <path fill="currentColor" d="M5 4h14a2 2 0 0 1 2 2v3H3V6a2 2 0 0 1 2-2Zm-2 7h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Zm6 2v2h6v-2H9Z"/>
      </symbol>
      <symbol id="ico-unarchive" viewBox="0 0 24 24">
        <path fill="currentColor" d="M5 4h14a2 2 0 0 1 2 2v3H3V6a2 2 0 0 1 2-2Zm-2 7h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Zm9 2v4l2-2l-2-2Zm-3 6v-2h6v2H9Z"/>
      </symbol>
      <symbol id="ico-chip" viewBox="0 0 24 24">
        <path fill="currentColor" d="M7 7h10v10H7V7Zm-2 0a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7Zm-3 4h2v2H2v-2Zm18 0h2v2h-2v-2ZM11 2h2v2h-2V2Zm0 18h2v2h-2v-2ZM2 7h2v2H2V7Zm18 0h2v2h-2V7ZM2 15h2v2H2v-2Zm18 0h2v2h-2v-2ZM7 2h2v2H7V2Zm8 0h2v2h-2V2ZM7 20h2v2H7v-2Zm8 0h2v2h-2v-2Z"/>
      </symbol>
      <symbol id="ico-gauge" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 4a10 10 0 0 0-9.9 11.5A2.5 2.5 0 0 0 4.6 18H19.4a2.5 2.5 0 0 0 2.5-2.5A10 10 0 0 0 12 4Zm-7.4 12a8 8 0 1 1 14.8 0H4.6Zm7.4-7a1 1 0 0 1 1 1v3.6l2.1 2.1l-1.4 1.4L11 14.4V10a1 1 0 0 1 1-1Z"/>
      </symbol>
      <symbol id="ico-shield" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 2l8 4v6c0 5-3.4 9.6-8 10c-4.6-.4-8-5-8-10V6l8-4Zm0 2.2L6 7v5c0 4 2.6 7.8 6 8.1c3.4-.3 6-4.1 6-8.1V7l-6-2.8Z"/>
      </symbol>
      <symbol id="ico-lock" viewBox="0 0 24 24">
        <path fill="currentColor" d="M7 10V8a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V8a3 3 0 1 0-6 0v2Zm3 4a2 2 0 0 0-1 3.7V19h2v-1.3a2 2 0 0 0-1-3.7Z"/>
      </symbol>
      <symbol id="ico-gear" viewBox="0 0 24 24">
        <path fill="currentColor" d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.2 7.2 0 0 0-1.7-1l-.3-2.5H9l-.3 2.5c-.6.2-1.2.6-1.7 1l-2.3-1-2 3.4L4.6 11a7.7 7.7 0 0 0 0 2L2.6 14.5l2 3.4 2.3-1c.5.4 1.1.8 1.7 1l.3 2.5h6l.3-2.5c.6-.2 1.2-.6 1.7-1l2.3 1 2-3.4L19.4 13ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/>
      </symbol>
      <symbol id="ico-x" viewBox="0 0 24 24">
        <path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3 1.4 1.4Z"/>
      </symbol>
      <symbol id="ico-send" viewBox="0 0 24 24">
        <path fill="currentColor" d="M2 21 23 12 2 3v7l15 2-15 2v7Z"/>
      </symbol>
      <symbol id="ico-up" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 5 5 12l1.4 1.4L11 8.8V20h2V8.8l4.6 4.6L19 12l-7-7Z"/>
      </symbol>
      <symbol id="ico-stop" viewBox="0 0 24 24">
        <path fill="currentColor" d="M7 7h10v10H7V7Z"/>
      </symbol>
      <symbol id="ico-trash" viewBox="0 0 24 24">
        <path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v10h-2V9Zm4 0h2v10h-2V9ZM7 9h2v10H7V9Zm-1-1h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Z"/>
      </symbol>
      <symbol id="ico-search" viewBox="0 0 24 24">
        <path fill="currentColor" d="M10 4a6 6 0 1 1 0 12a6 6 0 0 1 0-12Zm0-2a8 8 0 1 0 4.9 14.3l4.4 4.4l1.4-1.4l-4.4-4.4A8 8 0 0 0 10 2Z"/>
      </symbol>
    </svg>
    <header class="topbar">
      <div class="topbar-row">
        <div class="controls">
          <button class="task-btn" id="taskPickerButton" type="button" title="\u30BF\u30B9\u30AF" aria-label="\u30BF\u30B9\u30AF\u3092\u9078\u629E">
            <svg class="ico"><use href="#ico-list"></use></svg>
            <span class="task-btn-text" id="taskTitle">\u30BF\u30B9\u30AF</span>
            <span class="task-btn-caret" aria-hidden="true"></span>
          </button>
        </div>
        <div class="controls">
          <div class="status" id="status">disconnected</div>
          <button class="icon-btn" id="openSettings" title="Settings" aria-label="Settings">
            <svg class="ico"><use href="#ico-gear"></use></svg>
          </button>
        </div>
      </div>
      <div class="task-pop" id="taskPop" hidden>
        <div class="task-pop-search">
          <svg class="ico"><use href="#ico-search"></use></svg>
          <input id="taskSearch" type="text" placeholder="\u6700\u8FD1\u306E\u30BF\u30B9\u30AF\u3092\u691C\u7D22\u3059\u308B" />
          <button class="icon-btn" id="taskClose" type="button" title="\u9589\u3058\u308B" aria-label="\u9589\u3058\u308B">
            <svg class="ico"><use href="#ico-x"></use></svg>
          </button>
        </div>
        <div class="task-pop-filter">
          <div class="task-pop-filter-left">\u3059\u3079\u3066\u306E\u30BF\u30B9\u30AF</div>
          <button class="icon-btn" id="taskNew" type="button" title="\u65B0\u898F\u30BF\u30B9\u30AF" aria-label="\u65B0\u898F\u30BF\u30B9\u30AF">
            <svg class="ico"><use href="#ico-plus"></use></svg>
          </button>
          <button class="icon-btn" id="taskArchive" type="button" title="\u30BF\u30B9\u30AF\u3092\u9589\u3058\u308B\uFF08\u30A2\u30FC\u30AB\u30A4\u30D6\uFF09" aria-label="\u30BF\u30B9\u30AF\u3092\u9589\u3058\u308B\uFF08\u30A2\u30FC\u30AB\u30A4\u30D6\uFF09">
            <svg class="ico"><use href="#ico-archive"></use></svg>
          </button>
        </div>
        <div class="task-pop-list" id="taskList" role="listbox" aria-label="\u30BF\u30B9\u30AF\u4E00\u89A7"></div>
      </div>
      <div class="settings-pop" id="settingsPop" hidden>
        <div class="settings-grid">
          <div class="settings-group">
            <div class="settings-title">\u30BF\u30B9\u30AF</div>
            <div class="settings-row">
              <button class="icon-btn" id="newThread" title="\u65B0\u898F\u30BF\u30B9\u30AF" aria-label="\u65B0\u898F\u30BF\u30B9\u30AF"><svg class="ico"><use href="#ico-plus"></use></svg></button>
              <button class="icon-btn" id="forkThread" title="\u30BF\u30B9\u30AF\u3092\u30D5\u30A9\u30FC\u30AF" aria-label="\u30BF\u30B9\u30AF\u3092\u30D5\u30A9\u30FC\u30AF"><svg class="ico"><use href="#ico-fork"></use></svg></button>
              <button class="icon-btn" id="rollback1" title="\u76F4\u524D\u30BF\u30FC\u30F3\u3092\u30ED\u30FC\u30EB\u30D0\u30C3\u30AF" aria-label="\u76F4\u524D\u30BF\u30FC\u30F3\u3092\u30ED\u30FC\u30EB\u30D0\u30C3\u30AF"><svg class="ico"><use href="#ico-undo"></use></svg></button>
              <button class="icon-btn" id="archiveThread" title="\u30BF\u30B9\u30AF\u3092\u30A2\u30FC\u30AB\u30A4\u30D6" aria-label="\u30BF\u30B9\u30AF\u3092\u30A2\u30FC\u30AB\u30A4\u30D6"><svg class="ico"><use href="#ico-archive"></use></svg></button>
              <button class="icon-btn" id="unarchiveThread" title="\u30A2\u30FC\u30AB\u30A4\u30D6\u89E3\u9664" aria-label="\u30A2\u30FC\u30AB\u30A4\u30D6\u89E3\u9664"><svg class="ico"><use href="#ico-unarchive"></use></svg></button>
            </div>
          </div>
          <div class="settings-group">
            <div class="settings-title">Run</div>
            <div class="settings-col">
              <div class="select-wrap toolkit" title="Reasoning effort">
                <vscode-dropdown id="effortSelect" aria-label="Reasoning effort">
                  <svg class="ico" slot="start"><use href="#ico-gauge"></use></svg>
                </vscode-dropdown>
              </div>
              <div class="select-wrap toolkit" title="Approval policy">
                <vscode-dropdown id="approvalSelect" aria-label="Approval policy">
                  <svg class="ico" slot="start"><use href="#ico-shield"></use></svg>
                </vscode-dropdown>
              </div>
              <div class="select-wrap toolkit" title="Sandbox mode">
                <vscode-dropdown id="sandboxSelect" aria-label="Sandbox mode">
                  <svg class="ico" slot="start"><use href="#ico-lock"></use></svg>
                </vscode-dropdown>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <main class="chat" id="chat">
    </main>

    <footer class="composer">
      <div class="composer-row">
        <button class="icon-btn" id="attachFiles" title="Attach files" aria-label="Attach files">
          <svg class="ico"><use href="#ico-plus"></use></svg>
        </button>
        <div class="composer-main">
          <div class="attachments" id="attachments" hidden></div>
          <textarea id="input" rows="2" placeholder="Type a message"></textarea>
        </div>
        <button class="icon-btn primary" id="send" title="Send" aria-label="Send">
          <svg class="ico"><use id="sendIconUse" href="#ico-up"></use></svg>
        </button>
      </div>
      <div class="composer-meta">
        <button class="meta-btn" id="toggleFullAccess" type="button" title="Toggle full access" aria-label="Toggle full access">
          <svg class="ico"><use href="#ico-lock"></use></svg>
          <span class="meta-btn-text" id="fullAccessLabel">\u30C7\u30D5\u30A9\u30EB\u30C8</span>
        </button>

        <button class="meta-btn" id="toggleApproval" type="button" title="Toggle approval policy" aria-label="Toggle approval policy">
          <svg class="ico"><use href="#ico-shield"></use></svg>
          <span class="meta-btn-text" id="approvalLabel">\u627F\u8A8D</span>
        </button>

        <div class="meta-item" title="Model">
          <vscode-dropdown id="modelSelect" aria-label="Model">
            <svg class="ico" slot="start"><use href="#ico-chip"></use></svg>
          </vscode-dropdown>
        </div>

        <div class="meta-spacer"></div>
        <div class="rate" id="rateFooter" aria-label="Rate limits"></div>
      </div>
    </footer>

    <template id="msg-user">
      <div class="row row-user">
        <div class="bubble bubble-user"></div>
      </div>
    </template>
    <template id="msg-assistant">
      <div class="row row-assistant">
        <img class="avatar" alt="avatar" src="${avatarSrc}" />
        <div class="bubble bubble-assistant"></div>
      </div>
    </template>
    <template id="msg-system">
      <div class="row row-system">
        <div class="bubble bubble-system"></div>
      </div>
    </template>
    <script nonce="${n}">
      window.__NITORI_CODEX__ = { avatarSrc: ${JSON.stringify(String(avatarUri))} };
    </script>
    <script type="module" nonce="${n}" src="${toolkitUri}"></script>
    <script nonce="${n}" src="${scriptUri}"></script>
  </body>
</html>`;
}

// src/sidebarView.ts
var NitoriCodexSidebarViewProvider = class {
  static viewType = "nitoriCodex.sidebarView";
  view = null;
  extensionUri;
  onWebviewReady;
  constructor(extensionUri, onWebviewReady) {
    this.extensionUri = extensionUri;
    this.onWebviewReady = onWebviewReady;
  }
  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.extensionUri);
    this.onWebviewReady(webviewView.webview);
  }
};

// src/extension.ts
function activate(context) {
  let panel = null;
  let connectionStatus = "connecting";
  const webviews = /* @__PURE__ */ new Set();
  let lastInteractiveWebview = null;
  const respondedRequestIds = /* @__PURE__ */ new Set();
  const busyByThreadId = /* @__PURE__ */ new Map();
  const settingsKey = {
    threadId: "nitoriCodex.threadId",
    model: "nitoriCodex.model",
    effort: "nitoriCodex.effort",
    approvalPolicy: "nitoriCodex.approvalPolicy",
    sandbox: "nitoriCodex.sandbox"
  };
  const cfg = vscode2.workspace.getConfiguration("nitoriCodex");
  const configuredCodexPath = cfg.get("codexPath") ?? null;
  const client = new CodexAppServerClient({
    onNotification: (msg) => {
      if (msg.method === "thread/tokenUsage/updated") {
        return;
      }
      if (msg.method === "turn/started") {
        const p = msg.params;
        const threadId = String(p?.threadId ?? "");
        const turnId = String(p?.turn?.id ?? "");
        if (threadId && turnId) {
          busyByThreadId.set(threadId, { turnId, busy: true });
          postAll({ type: "turnBusy", threadId, turnId, busy: true });
        }
        return;
      }
      if (msg.method === "turn/completed") {
        const p = msg.params;
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
        const p = msg.params;
        const diff = String(p?.diff ?? "");
        if (diff) postAll({ type: "diffUpdated", diff });
        return;
      }
      if (msg.method === "item/started") {
        const p = msg.params;
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
        const p = msg.params;
        const itemId = String(p?.itemId ?? "");
        const delta = String(p?.delta ?? "");
        if (itemId) postAll({ type: "assistantDelta", itemId, delta });
        return;
      }
      if (msg.method === "item/commandExecution/outputDelta") {
        const p = msg.params;
        const itemId = String(p?.itemId ?? "");
        const delta = String(p?.delta ?? "");
        if (itemId && delta) postAll({ type: "commandExecutionDelta", itemId, delta });
        return;
      }
      if (msg.method === "item/fileChange/outputDelta") {
        const p = msg.params;
        const itemId = String(p?.itemId ?? "");
        const delta = String(p?.delta ?? "");
        if (itemId && delta) postAll({ type: "fileChangeDelta", itemId, delta });
        return;
      }
      if (msg.method === "item/completed") {
        const p = msg.params;
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
            const summary = `commandExecution: ${String(item.status ?? "")}
${String(item.command ?? "")}`;
            postAll({ type: "systemMessage", text: out ? `${summary}

${out}` : summary });
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
              changes: changes.map((c) => ({
                kind: String(c?.kind ?? ""),
                path: String(c?.path ?? ""),
                diff: String(c?.diff ?? "")
              }))
            });
          } else {
            const text = changes.map((c) => `${String(c.kind ?? "")} ${String(c.path ?? "")}
${String(c.diff ?? "")}`).join("\n");
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
  async function requestApprovalInVsCode(req) {
    const requestId = req.id;
    if (respondedRequestIds.has(requestId)) return;
    const choice = await vscode2.window.showInformationMessage(
      `Approval required: ${req.method}`,
      { modal: true },
      "Accept",
      "Decline",
      "Cancel"
    );
    const decision = choice === "Accept" ? "accept" : choice === "Decline" ? "decline" : "cancel";
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
  async function requestUserInputInVsCode(req) {
    const requestId = req.id;
    if (respondedRequestIds.has(requestId)) return;
    const params = req.params ?? {};
    const questions = Array.isArray(params?.questions) ? params.questions : null;
    const answers = {};
    if (questions && questions.length > 0) {
      for (const q of questions) {
        const id = String(q?.id ?? "input");
        const header = String(q?.header ?? id);
        const question = String(q?.question ?? "");
        const value = await vscode2.window.showInputBox({
          prompt: `${header}${question ? `: ${question}` : ""}`,
          password: Boolean(q?.isSecret)
        });
        answers[id] = { answers: [String(value ?? "")] };
      }
    } else {
      const value = await vscode2.window.showInputBox({ prompt: "Input required" });
      answers["input"] = { answers: [String(value ?? "")] };
    }
    if (respondedRequestIds.has(requestId)) return;
    respondedRequestIds.add(requestId);
    client.respond(requestId, { answers });
  }
  async function ensureClientCodexPath() {
    const detected = await detectCodexExecutable();
    if (client.getCodexPath() !== "codex") return;
    client.setCodexPath(configuredCodexPath ?? detected);
  }
  function postTo(webview, msg) {
    webview.postMessage(msg);
  }
  function postAll(msg) {
    for (const w of webviews) w.postMessage(msg);
  }
  function pickUiWebview() {
    if (lastInteractiveWebview && webviews.has(lastInteractiveWebview)) return lastInteractiveWebview;
    const first = webviews.values().next();
    return first.done ? null : first.value;
  }
  function safeDecline(req) {
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
      context.workspaceState.update(settingsKey.threadId, started.threadId);
      connectionStatus = "ready";
      postAll({ type: "status", status: "ready", message: `thread=${started.threadId}` });
      await refreshState();
    } catch (e) {
      connectionStatus = "error";
      postAll({ type: "status", status: "error", message: String(e?.message ?? e) });
      throw e;
    }
  }
  function getWorkspaceCwd() {
    const f = vscode2.workspace.workspaceFolders?.[0];
    return f?.uri.fsPath ?? null;
  }
  function getRunSettings() {
    const model = context.workspaceState.get(settingsKey.model) ?? null;
    const effort = context.workspaceState.get(settingsKey.effort) ?? null;
    const approvalPolicy = context.workspaceState.get(settingsKey.approvalPolicy) ?? null;
    const sandbox = context.workspaceState.get(settingsKey.sandbox) ?? null;
    return { model, effort, approvalPolicy, sandbox };
  }
  async function refreshState(target) {
    await ensureReady();
    const cwd = getWorkspaceCwd();
    const threadId = context.workspaceState.get(settingsKey.threadId) || "";
    const settings = getRunSettings();
    const busyInfo = threadId ? busyByThreadId.get(threadId) : void 0;
    const [modelsRes, threadsRes, rateRes] = await Promise.all([
      client.request("model/list", { limit: 200, includeHidden: false }),
      client.request("thread/list", { limit: 50 }),
      client.request("account/rateLimits/read")
    ]);
    const models = modelsRes?.data ?? [];
    const threads = threadsRes?.data ?? [];
    const rateLimits = rateRes?.rateLimits ?? null;
    let thread = null;
    try {
      if (threadId) {
        const readRes = await client.request("thread/read", { threadId, includeTurns: true });
        thread = readRes?.thread ?? null;
      }
    } catch {
      thread = null;
    }
    let config = null;
    try {
      config = await client.request("config/read", { includeLayers: false, cwd });
    } catch {
      config = null;
    }
    const msg = {
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
    const res = await client.request("thread/start", {
      model: settings.model,
      cwd,
      approvalPolicy: settings.approvalPolicy,
      sandbox: settings.sandbox,
      experimentalRawEvents: false,
      persistExtendedHistory: true
    });
    const newId = res?.thread?.id;
    if (typeof newId === "string" && newId) {
      context.workspaceState.update(settingsKey.threadId, newId);
      postAll({ type: "systemMessage", text: `New thread: ${newId}` });
      await refreshState();
    }
  }
  async function resumeThread(threadId) {
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
    context.workspaceState.update(settingsKey.threadId, threadId);
    postAll({ type: "systemMessage", text: `Resumed thread: ${threadId}` });
    await refreshState();
  }
  async function onWebviewMessage(msg, sourceWebview) {
    if (msg.type === "init") {
      if (sourceWebview) await refreshState(sourceWebview);
      else await refreshState();
      return;
    }
    if (msg.type === "interruptTurn") {
      await ensureReady();
      const threadId = context.workspaceState.get(settingsKey.threadId) || "";
      const info = threadId ? busyByThreadId.get(threadId) : void 0;
      const turnId = info?.turnId ?? null;
      if (!threadId || !turnId) {
        postAll({ type: "systemMessage", text: "\u4E2D\u65AD\u3067\u304D\u308B\u4F5C\u696D\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093\u3067\u3057\u305F\u3002" });
        return;
      }
      try {
        await client.request("turn/interrupt", { threadId, turnId });
        postAll({ type: "systemMessage", text: "\u4F5C\u696D\u3092\u4E2D\u65AD\u3057\u307E\u3057\u305F\u3002" });
      } catch (e) {
        postAll({ type: "systemMessage", text: `\u4E2D\u65AD\u306B\u5931\u6557: ${String(e?.message ?? e)}` });
      }
      return;
    }
    if (msg.type === "setRunSettings") {
      context.workspaceState.update(settingsKey.model, msg.model);
      context.workspaceState.update(settingsKey.effort, msg.effort);
      await refreshState();
      return;
    }
    if (msg.type === "setAccessSettings") {
      context.workspaceState.update(settingsKey.approvalPolicy, msg.approvalPolicy);
      context.workspaceState.update(settingsKey.sandbox, msg.sandbox);
      const threadId = context.workspaceState.get(settingsKey.threadId) || "";
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
      const res = await client.request("thread/fork", {
        threadId,
        cwd,
        model: settings.model,
        approvalPolicy: settings.approvalPolicy,
        sandbox: settings.sandbox,
        persistExtendedHistory: true
      });
      const newId = res?.thread?.id;
      if (typeof newId === "string" && newId) {
        context.workspaceState.update(settingsKey.threadId, newId);
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
      const picked = await vscode2.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: "Attach"
      });
      postAll({ type: "attachments", files: (picked ?? []).map((u) => u.fsPath) });
      return;
    }
  }
  const cmd = vscode2.commands.registerCommand("nitoriCodex.open", async () => {
    if (panel) {
      panel.reveal();
      lastInteractiveWebview = panel.webview;
      return;
    }
    panel = vscode2.window.createWebviewPanel(
      "nitoriCodex",
      "Nitori Codex",
      vscode2.ViewColumn.Beside,
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
    panel.webview.onDidReceiveMessage(async (msg) => {
      lastInteractiveWebview = panel?.webview ?? lastInteractiveWebview;
      await onWebviewMessage(msg, panel?.webview ?? void 0);
      if (msg.type === "send") {
        const text = msg.text?.trim();
        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        if (!text && attachments.length === 0) return;
        await ensureReady();
        postAll({ type: "userMessage", text });
        const threadId = context.workspaceState.get(settingsKey.threadId) || "";
        const settings = getRunSettings();
        const res = await client.request("turn/start", {
          threadId,
          input: userInputs(text ?? "", attachments),
          model: settings.model,
          effort: settings.effort
        });
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
        const wrapped = {};
        for (const [k, v] of Object.entries(answers ?? {})) wrapped[k] = { answers: v };
        client.respond(requestId, { answers: wrapped });
      }
    });
    await ensureReady();
  });
  const sidebarProvider = new NitoriCodexSidebarViewProvider(context.extensionUri, (webview) => {
    webviews.add(webview);
    lastInteractiveWebview = webview;
    webview.onDidReceiveMessage(async (msg) => {
      lastInteractiveWebview = webview;
      await onWebviewMessage(msg, webview);
      if (msg.type === "send") {
        const text = msg.text?.trim();
        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        if (!text && attachments.length === 0) return;
        await ensureReady();
        postAll({ type: "userMessage", text });
        const threadId = context.workspaceState.get(settingsKey.threadId) || "";
        const settings = getRunSettings();
        const res = await client.request("turn/start", {
          threadId,
          input: userInputs(text ?? "", attachments),
          model: settings.model,
          effort: settings.effort
        });
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
        const wrapped = {};
        for (const [k, v] of Object.entries(answers ?? {})) wrapped[k] = { answers: v };
        client.respond(requestId, { answers: wrapped });
      }
    });
    void ensureReady();
  });
  context.subscriptions.push(
    cmd,
    vscode2.window.registerWebviewViewProvider(NitoriCodexSidebarViewProvider.viewType, sidebarProvider)
  );
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
