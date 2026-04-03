import * as vscode from "vscode";

function nonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const n = nonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.js"));
  const historyScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "threadHistory.js"));
  const renderQueueScriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "renderQueue.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.css"));
  const toolkitUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "toolkit.min.js"));
  const avatarUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "nitori.png"));
  const brandUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "nitori-codex.png"));
  const backgroundUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "background.png"));

  const cacheBust = Date.now();
  const avatarSrc = `${avatarUri.toString()}?v=${cacheBust}`;
  const brandSrc = `${brandUri.toString()}?v=${cacheBust}`;
  const backgroundSrc = `${backgroundUri.toString()}?v=${cacheBust}`;

  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: https:`,
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
      <symbol id="ico-cloud" viewBox="0 0 24 24"><path fill="currentColor" d="M19 18a4 4 0 0 0-.6-8A6 6 0 1 0 6.2 17.9A3.5 3.5 0 0 0 7.5 18H19Zm0 2H7.5a5.5 5.5 0 0 1-1.9-10.7A8 8 0 0 1 21.4 9.7A6 6 0 0 1 19 20Z"/></symbol>
      <symbol id="ico-list" viewBox="0 0 24 24"><path fill="currentColor" d="M4 6h2v2H4V6Zm4 0h14v2H8V6ZM4 11h2v2H4v-2Zm4 0h14v2H8v-2ZM4 16h2v2H4v-2Zm4 0h14v2H8v-2Z"/></symbol>
      <symbol id="ico-plus" viewBox="0 0 24 24"><path fill="currentColor" d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z"/></symbol>
      <symbol id="ico-fork" viewBox="0 0 24 24"><path fill="currentColor" d="M7 3a3 3 0 0 0-1 5.8V11a4 4 0 0 0 4 4h2v.2a3 3 0 1 0 2 0V15h2a4 4 0 0 0 4-4V8.8a3 3 0 1 0-2 0V11a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V8.8A3 3 0 0 0 7 3Zm14 0a1 1 0 1 1 0 2a1 1 0 0 1 0-2ZM7 5a1 1 0 1 1 0-2a1 1 0 0 1 0 2Zm7 16a1 1 0 1 1 0-2a1 1 0 0 1 0 2Z"/></symbol>
      <symbol id="ico-undo" viewBox="0 0 24 24"><path fill="currentColor" d="M7.6 7H4V3.4L5.4 4.8A10 10 0 1 1 2 12h2a8 8 0 1 0 2.8-6.1L7.6 7Z"/></symbol>
      <symbol id="ico-archive" viewBox="0 0 24 24"><path fill="currentColor" d="M5 4h14a2 2 0 0 1 2 2v3H3V6a2 2 0 0 1 2-2Zm-2 7h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Zm6 2v2h6v-2H9Z"/></symbol>
      <symbol id="ico-unarchive" viewBox="0 0 24 24"><path fill="currentColor" d="M5 4h14a2 2 0 0 1 2 2v3H3V6a2 2 0 0 1 2-2Zm-2 7h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9Zm9 2v4l2-2l-2-2Zm-3 6v-2h6v2H9Z"/></symbol>
      <symbol id="ico-chip" viewBox="0 0 24 24"><path fill="currentColor" d="M7 7h10v10H7V7Zm-2 0a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7Zm-3 4h2v2H2v-2Zm18 0h2v2h-2v-2ZM11 2h2v2h-2V2Zm0 18h2v2h-2v-2ZM2 7h2v2H2V7Zm18 0h2v2h-2V7ZM2 15h2v2H2v-2Zm18 0h2v2h-2v-2ZM7 2h2v2H7V2Zm8 0h2v2h-2V2ZM7 20h2v2H7v-2Zm8 0h2v2h-2v-2Z"/></symbol>
      <symbol id="ico-gauge" viewBox="0 0 24 24"><path fill="currentColor" d="M12 4a10 10 0 0 0-9.9 11.5A2.5 2.5 0 0 0 4.6 18H19.4a2.5 2.5 0 0 0 2.5-2.5A10 10 0 0 0 12 4Zm-7.4 12a8 8 0 1 1 14.8 0H4.6Zm7.4-7a1 1 0 0 1 1 1v3.6l2.1 2.1l-1.4 1.4L11 14.4V10a1 1 0 0 1 1-1Z"/></symbol>
      <symbol id="ico-shield" viewBox="0 0 24 24"><path fill="currentColor" d="M12 2l8 4v6c0 5-3.4 9.6-8 10c-4.6-.4-8-5-8-10V6l8-4Zm0 2.2L6 7v5c0 4 2.6 7.8 6 8.1c3.4-.3 6-4.1 6-8.1V7l-6-2.8Z"/></symbol>
      <symbol id="ico-lock" viewBox="0 0 24 24"><path fill="currentColor" d="M7 10V8a5 5 0 0 1 10 0v2h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V8a3 3 0 1 0-6 0v2Zm3 4a2 2 0 0 0-1 3.7V19h2v-1.3a2 2 0 0 0-1-3.7Z"/></symbol>
      <symbol id="ico-gear" viewBox="0 0 24 24"><path fill="currentColor" d="M19.4 13a7.7 7.7 0 0 0 0-2l2-1.5-2-3.4-2.3 1a7.2 7.2 0 0 0-1.7-1l-.3-2.5H9l-.3 2.5c-.6.2-1.2.6-1.7 1l-2.3-1-2 3.4L4.6 11a7.7 7.7 0 0 0 0 2L2.6 14.5l2 3.4 2.3-1c.5.4 1.1.8 1.7 1l.3 2.5h6l.3-2.5c.6-.2 1.2-.6 1.7-1l2.3 1 2-3.4L19.4 13ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/></symbol>
      <symbol id="ico-x" viewBox="0 0 24 24"><path fill="currentColor" d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3 1.4 1.4Z"/></symbol>
      <symbol id="ico-send" viewBox="0 0 24 24"><path fill="currentColor" d="M2 21 23 12 2 3v7l15 2-15 2v7Z"/></symbol>
      <symbol id="ico-up" viewBox="0 0 24 24"><path fill="currentColor" d="M12 5 5 12l1.4 1.4L11 8.8V20h2V8.8l4.6 4.6L19 12l-7-7Z"/></symbol>
      <symbol id="ico-back" viewBox="0 0 24 24"><path fill="currentColor" d="m14.7 5.3 1.4 1.4L10.8 12l5.3 5.3-1.4 1.4L8 12l6.7-6.7Z"/></symbol>
      <symbol id="ico-stop" viewBox="0 0 24 24"><path fill="currentColor" d="M7 7h10v10H7V7Z"/></symbol>
      <symbol id="ico-trash" viewBox="0 0 24 24"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2Zm1 6h2v10h-2V9Zm4 0h2v10h-2V9ZM7 9h2v10H7V9Zm-1-1h12l-1 13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Z"/></symbol>
      <symbol id="ico-search" viewBox="0 0 24 24"><path fill="currentColor" d="M10 4a6 6 0 1 1 0 12a6 6 0 0 1 0-12Zm0-2a8 8 0 1 0 4.9 14.3l4.4 4.4l1.4-1.4l-4.4-4.4A8 8 0 0 0 10 2Z"/></symbol>
    </svg>

    <header class="topbar">
      <div class="topbar-row">
        <div class="controls">
          <button class="icon-btn" id="homeButton" type="button" title="Tasks" aria-label="Open task list">
            <svg class="ico"><use id="homeButtonIconUse" href="#ico-list"></use></svg>
          </button>
          <div class="header-copy">
            <div class="header-title" id="taskTitle">Tasks</div>
            <div class="header-subtitle" id="taskSubtitle">Recent tasks</div>
          </div>
        </div>
        <div class="header-brand" aria-hidden="true">
          <img class="header-brand-image" src="${brandSrc}" alt="" />
        </div>
        <div class="controls">
          <div class="status" id="status">disconnected</div>
          <button class="icon-btn" id="openSettings" title="Settings" aria-label="Settings">
            <svg class="ico"><use href="#ico-gear"></use></svg>
          </button>
        </div>
      </div>

    </header>

    <div class="page page-home" id="taskPop">
      <div class="task-pop task-page-shell">
        <div class="task-pop-search">
          <svg class="ico"><use href="#ico-search"></use></svg>
          <input id="taskSearch" type="text" placeholder="Search tasks" />
        </div>
        <div class="task-pop-list" id="taskList" role="listbox" aria-label="Task list"></div>
      </div>
    </div>

    <div class="page page-chat" id="chatPage">
      <div class="chat-empty" id="chatEmpty">
        <img class="chat-empty-avatar" alt="avatar" src="${avatarSrc}" />
        <div class="chat-empty-title">No task open</div>
        <div class="chat-empty-sub">Open a task from the list, or start a new one from the home page.</div>
      </div>
      <main class="chat" id="chat"></main>
    </div>

    <header class="topbar topbar-settings">
      <div class="settings-pop" id="settingsPop" hidden>
        <div class="settings-grid">
          <div class="settings-group">
            <div class="settings-title" id="taskSettingsTitle">Task</div>
            <div class="settings-row">
              <button class="icon-btn" id="newThread" title="New task" aria-label="New task"><svg class="ico"><use href="#ico-plus"></use></svg></button>
              <button class="icon-btn" id="forkThread" title="Fork task" aria-label="Fork task"><svg class="ico"><use href="#ico-fork"></use></svg></button>
              <button class="icon-btn" id="rollback1" title="Rollback one turn" aria-label="Rollback one turn"><svg class="ico"><use href="#ico-undo"></use></svg></button>
              <button class="icon-btn" id="archiveThread" title="Archive task" aria-label="Archive task"><svg class="ico"><use href="#ico-archive"></use></svg></button>
              <button class="icon-btn" id="unarchiveThread" title="Unarchive task" aria-label="Unarchive task"><svg class="ico"><use href="#ico-unarchive"></use></svg></button>
            </div>
          </div>

          <div class="settings-group">
            <div class="settings-title" id="runSettingsTitle">Run</div>
            <div class="settings-col">
              <div class="select-wrap toolkit" id="effortSelectWrap" title="Reasoning effort">
                <vscode-dropdown id="effortSelect" aria-label="Reasoning effort">
                  <svg class="ico" slot="start"><use href="#ico-gauge"></use></svg>
                </vscode-dropdown>
              </div>
              <div class="select-wrap toolkit" id="approvalSelectWrap" title="Approval policy">
                <vscode-dropdown id="approvalSelect" aria-label="Approval policy">
                  <svg class="ico" slot="start"><use href="#ico-shield"></use></svg>
                </vscode-dropdown>
              </div>
              <div class="select-wrap toolkit" id="sandboxSelectWrap" title="Sandbox mode">
                <vscode-dropdown id="sandboxSelect" aria-label="Sandbox mode">
                  <svg class="ico" slot="start"><use href="#ico-lock"></use></svg>
                </vscode-dropdown>
              </div>
              <div class="select-wrap toolkit" id="uiLocaleSelectWrap" title="UI language">
                <vscode-dropdown id="uiLocaleSelect" aria-label="UI language">
                  <svg class="ico" slot="start"><use href="#ico-cloud"></use></svg>
                </vscode-dropdown>
              </div>
            </div>
          </div>

          <div class="settings-group settings-group-wide">
            <div class="settings-title" id="projectInstructionsTitle">Project Instructions</div>
            <div class="settings-col">
              <div class="settings-card">
                <div class="settings-card-head">
                  <div>
                    <div class="settings-card-title">AGENTS.md</div>
                    <div class="settings-help" id="agentsInstructionsStatus">Detecting project instructions...</div>
                  </div>
                  <div class="settings-actions">
                    <button class="icon-btn" id="openAgentsInstructions" type="button" title="Open AGENTS.md" aria-label="Open AGENTS.md">
                      <svg class="ico"><use href="#ico-list"></use></svg>
                    </button>
                    <button class="icon-btn" id="createAgentsInstructions" type="button" title="Create AGENTS.md" aria-label="Create AGENTS.md">
                      <svg class="ico"><use href="#ico-plus"></use></svg>
                    </button>
                  </div>
                </div>
                <div class="settings-help" id="projectInstructionsHelp">Use AGENTS.md for repository rules that should be shared and committed with the project.</div>
              </div>
            </div>
          </div>

          <div class="settings-group settings-group-wide">
            <div class="settings-title" id="baseInstructionsTitle">Base Instructions</div>
            <div class="settings-col">
              <textarea id="baseInstructionsInput" class="settings-textarea" rows="5" placeholder="Set durable local rules that should apply on top of AGENTS.md."></textarea>
              <div class="settings-actions">
                <button class="icon-btn primary" id="saveBaseInstructions" type="button" title="Save base instructions" aria-label="Save base instructions">
                  <svg class="ico"><use href="#ico-send"></use></svg>
                </button>
                <button class="icon-btn" id="clearBaseInstructions" type="button" title="Clear base instructions" aria-label="Clear base instructions">
                  <svg class="ico"><use href="#ico-trash"></use></svg>
                </button>
              </div>
              <div class="settings-help" id="baseInstructionsHelp">Use this for persistent local rules that should ride along with the workspace, but not be committed into AGENTS.md yet.</div>
            </div>
          </div>

          <div class="settings-group settings-group-wide">
            <div class="settings-title" id="sessionInstructionsTitle">Session Instructions</div>
            <div class="settings-col">
              <textarea id="developerInstructionsInput" class="settings-textarea" rows="6" placeholder="Add temporary instructions on top of AGENTS.md."></textarea>
              <div class="settings-actions">
                <button class="icon-btn primary" id="saveDeveloperInstructions" type="button" title="Save session instructions" aria-label="Save session instructions">
                  <svg class="ico"><use href="#ico-send"></use></svg>
                </button>
                <button class="icon-btn" id="clearDeveloperInstructions" type="button" title="Clear session instructions" aria-label="Clear session instructions">
                  <svg class="ico"><use href="#ico-trash"></use></svg>
                </button>
              </div>
              <div class="settings-help" id="sessionInstructionsHelp">Use this for temporary guidance for the current task. It is sent as developerInstructions when a thread starts, resumes, or forks.</div>
            </div>
          </div>

          <div class="settings-group settings-group-wide">
            <div class="settings-title" id="modeInstructionsTitle">Built-in Modes</div>
            <div class="settings-col">
              <div class="select-wrap toolkit" id="collaborationModeSelectWrap" title="Collaboration mode">
                <vscode-dropdown id="collaborationModeSelect" aria-label="Collaboration mode">
                  <svg class="ico" slot="start"><use href="#ico-list"></use></svg>
                </vscode-dropdown>
              </div>
              <div class="select-wrap toolkit" id="personalitySelectWrap" title="Personality">
                <vscode-dropdown id="personalitySelect" aria-label="Personality">
                  <svg class="ico" slot="start"><use href="#ico-cloud"></use></svg>
                </vscode-dropdown>
              </div>
              <div class="settings-actions">
                <button class="icon-btn primary" id="saveInstructionModes" type="button" title="Save mode settings" aria-label="Save mode settings">
                  <svg class="ico"><use href="#ico-send"></use></svg>
                </button>
                <button class="icon-btn" id="clearInstructionModes" type="button" title="Clear mode settings" aria-label="Clear mode settings">
                  <svg class="ico"><use href="#ico-trash"></use></svg>
                </button>
              </div>
              <div class="settings-help" id="modeInstructionsHelp">Collaboration Mode chooses Codex built-in working instructions. Personality adjusts the response tone for the thread and the next turn.</div>
            </div>
          </div>
        </div>
      </div>
    </header>

    <div class="notice-stack" id="noticeStack" aria-live="polite" aria-atomic="false"></div>

    <div class="activity-indicator" id="activityIndicator" hidden aria-live="polite">
      <div class="activity-top">
        <span class="activity-dot" aria-hidden="true"></span>
        <span class="activity-kind" id="activityKind">Thinking</span>
        <span class="activity-detail" id="activityDetail"></span>
      </div>
      <div class="activity-bottom">
        <code class="activity-cwd" id="activityCwd"></code>
      </div>
    </div>

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
          <span class="meta-btn-text" id="fullAccessLabel">Default</span>
        </button>
        <button class="meta-btn" id="toggleApproval" type="button" title="Toggle approval policy" aria-label="Toggle approval policy">
          <svg class="ico"><use href="#ico-shield"></use></svg>
          <span class="meta-btn-text" id="approvalLabel">Approval</span>
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
      window.__NITORI_CODEX__ = { avatarSrc: ${JSON.stringify(String(avatarSrc))} };
    </script>
    <script type="module" nonce="${n}" src="${toolkitUri}"></script>
    <script nonce="${n}" src="${historyScriptUri}"></script>
    <script nonce="${n}" src="${renderQueueScriptUri}"></script>
    <script nonce="${n}" src="${scriptUri}"></script>
  </body>
</html>`;
}
