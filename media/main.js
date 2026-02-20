(function () {
  const vscode = acquireVsCodeApi();
  const chat = document.getElementById("chat");
  const input = document.getElementById("input");
  const send = document.getElementById("send");
  const status = document.getElementById("status");
  const openSettings = document.getElementById("openSettings");
  const settingsPop = document.getElementById("settingsPop");
  const modelSelect = document.getElementById("modelSelect");
  const effortSelect = document.getElementById("effortSelect");
  const approvalSelect = document.getElementById("approvalSelect");
  const sandboxSelect = document.getElementById("sandboxSelect");
  const taskPickerButton = document.getElementById("taskPickerButton");
  const taskPop = document.getElementById("taskPop");
  const taskSearch = document.getElementById("taskSearch");
  const taskArchive = document.getElementById("taskArchive");
  const taskList = document.getElementById("taskList");
  const taskTitle = document.getElementById("taskTitle");
  const taskClose = document.getElementById("taskClose");
  const taskNew = document.getElementById("taskNew");
  const newThreadBtn = document.getElementById("newThread");
  const forkThreadBtn = document.getElementById("forkThread");
  const rollback1Btn = document.getElementById("rollback1");
  const archiveThreadBtn = document.getElementById("archiveThread");
  const unarchiveThreadBtn = document.getElementById("unarchiveThread");
  const attachFiles = document.getElementById("attachFiles");
  const attachmentsEl = document.getElementById("attachments");
  const toggleFullAccess = document.getElementById("toggleFullAccess");
  const fullAccessLabel = document.getElementById("fullAccessLabel");
  const toggleApproval = document.getElementById("toggleApproval");
  const approvalLabel = document.getElementById("approvalLabel");
  const rateFooter = document.getElementById("rateFooter");
  const sendIconUse = document.getElementById("sendIconUse");

  const tplUser = document.getElementById("msg-user");
  const tplAssistant = document.getElementById("msg-assistant");
  const tplSystem = document.getElementById("msg-system");

  const assistantByItemId = new Map();
  const systemByItemId = new Map();
  const systemKindByItemId = new Map();
  const commandUIByItemId = new Map();
  let openCommandGroup = null;
  let lastTurnDiff = "";
  let state = null;
  let lastRendered = { threadId: null, updatedAt: null };
  let attachments = [];
  let isBusy = false;
  let taskQuery = "";
  let persisted = vscode.getState() || {};
  let draftsByThreadId =
    persisted && typeof persisted === "object" && persisted.draftsByThreadId && typeof persisted.draftsByThreadId === "object"
      ? persisted.draftsByThreadId
      : {};
  let draftSaveTimer = null;

  function persistWebviewState() {
    persisted = Object.assign({}, persisted, { draftsByThreadId });
    vscode.setState(persisted);
  }

  function persistDraftNow(threadIdOverride) {
    const threadId = threadIdOverride ? String(threadIdOverride) : state && state.threadId ? String(state.threadId) : "";
    if (!threadId) return;
    if (!input) return;
    draftsByThreadId[threadId] = {
      text: String(input.value || ""),
      attachments: Array.isArray(attachments) ? Array.from(attachments) : []
    };
    persistWebviewState();
  }

  function schedulePersistDraft() {
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = null;
      persistDraftNow();
    }, 200);
  }

  function clearDraftForThread(threadId) {
    const id = String(threadId || "");
    if (!id) return;
    if (Object.prototype.hasOwnProperty.call(draftsByThreadId, id)) {
      delete draftsByThreadId[id];
      persistWebviewState();
    }
  }

  function restoreDraftForThread(threadId) {
    const id = String(threadId || "");
    if (!id || !input) return;
    const d = draftsByThreadId && draftsByThreadId[id] ? draftsByThreadId[id] : null;
    input.value = d && typeof d.text === "string" ? d.text : "";
    attachments = d && Array.isArray(d.attachments) ? d.attachments : [];
    renderAttachments();
  }

  function setSettingsOpen(open) {
    if (!settingsPop) return;
    settingsPop.hidden = !open;
  }

  function isSettingsOpen() {
    return settingsPop && !settingsPop.hidden;
  }

  function setTaskPickerOpen(open) {
    if (!taskPop) return;
    taskPop.hidden = !open;
    if (open) {
      renderTaskPicker();
      if (taskSearch) {
        taskSearch.value = taskQuery;
        taskSearch.focus();
        taskSearch.select();
      }
    }
  }

  function isTaskPickerOpen() {
    return taskPop && !taskPop.hidden;
  }

  function relTime(updatedAtSec) {
    if (!updatedAtSec) return "";
    const now = Date.now() / 1000;
    const d = Math.max(0, Math.floor(now - updatedAtSec));
    const mins = Math.floor(d / 60);
    const hrs = Math.floor(d / 3600);
    const days = Math.floor(d / 86400);
    if (days >= 1) return `${days}日`;
    if (hrs >= 1) return `${hrs}時間`;
    if (mins >= 1) return `${mins}分`;
    return "今";
  }

  function taskDisplayTitle(t) {
    const preview = (t && t.preview ? String(t.preview) : "").replace(/\s+/g, " ").trim();
    return preview || (t && t.id ? String(t.id) : "(task)");
  }

  function renderTaskPicker() {
    if (!taskList || !state) return;
    taskList.textContent = "";

    const q = String(taskQuery || "").toLowerCase().trim();
    const threads = Array.isArray(state.threads) ? state.threads : [];

    const filtered = q
      ? threads.filter((t) => {
          const title = taskDisplayTitle(t).toLowerCase();
          return title.includes(q) || String(t.id || "").toLowerCase().includes(q);
        })
      : threads;

    for (const t of filtered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "task-item";
      if (state.threadId && t.id === state.threadId) btn.classList.add("is-active");

      const left = document.createElement("div");
      left.style.minWidth = "0";

      const title = document.createElement("div");
      title.className = "task-item-title";
      title.textContent = taskDisplayTitle(t);

      const sub = document.createElement("div");
      sub.className = "task-item-sub";
      sub.textContent = (t && t.cwd) ? String(t.cwd) : "";

      left.appendChild(title);
      left.appendChild(sub);

      const time = document.createElement("div");
      time.className = "task-item-time";
      time.textContent = t && t.updatedAt ? relTime(Number(t.updatedAt)) : "";

      btn.appendChild(left);
      btn.appendChild(time);

      btn.addEventListener("click", () => {
        const threadId = String(t.id || "");
        if (!threadId) return;
        vscode.postMessage({ type: "resumeThread", threadId });
        setTaskPickerOpen(false);
      });

      taskList.appendChild(btn);
    }
  }

  function renderAttachments() {
    if (!attachmentsEl) return;
    attachmentsEl.textContent = "";
    if (!attachments || attachments.length === 0) {
      attachmentsEl.hidden = true;
      return;
    }
    attachmentsEl.hidden = false;
    for (const p of attachments) {
      const chip = document.createElement("div");
      chip.className = "chip";

      const text = document.createElement("div");
      text.className = "chip-text";
      text.textContent = String(p).split(/[\\\\/]/).pop();
      chip.appendChild(text);

      const x = document.createElement("button");
      x.className = "chip-x";
      x.textContent = "×";
      x.onclick = () => {
        attachments = attachments.filter((v) => v !== p);
        renderAttachments();
        schedulePersistDraft();
      };
      chip.appendChild(x);

      attachmentsEl.appendChild(chip);
    }
  }

  function scrollToBottom() {
    chat.scrollTop = chat.scrollHeight;
  }

  function setBusy(busy) {
    isBusy = Boolean(busy);
    if (send) {
      send.classList.toggle("is-busy", isBusy);
      send.title = isBusy ? "Stop" : "Send";
      send.setAttribute("aria-label", isBusy ? "Stop" : "Send");
    }
    if (sendIconUse) {
      sendIconUse.setAttribute("href", isBusy ? "#ico-stop" : "#ico-up");
    }
  }

  function addRowFromTemplate(tpl) {
    const frag = tpl.content.cloneNode(true);
    const row = frag.firstElementChild;
    chat.appendChild(frag);
    scrollToBottom();
    return row;
  }

  function addUserMessage(text) {
    const row = addRowFromTemplate(tplUser);
    row.querySelector(".bubble").textContent = text;
  }

  function looksLikeEscapedDocument(text) {
    const s = String(text || "");
    if (s.includes("\n")) return false;
    const nCount = (s.match(/\\n/g) || []).length;
    if (nCount < 3) return false;
    const lower = s.trimStart().toLowerCase();
    if (lower.startsWith("<!doctype") || lower.startsWith("<html")) return true;
    if (lower.includes("<head>") && lower.includes("<body>")) return true;
    return false;
  }

  function unescapeCommonSequences(text) {
    return String(text || "")
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'");
  }

  function normalizeAssistantText(text) {
    const s = String(text || "");
    return looksLikeEscapedDocument(s) ? unescapeCommonSequences(s) : s;
  }

  function addSystemMessage(text) {
    const row = addRowFromTemplate(tplSystem);
    row.querySelector(".bubble").textContent = text;
  }

  function clampPreview(s, maxLen) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen - 1) + "…";
  }

  function ensureSystemRow(itemId) {
    let row = systemByItemId.get(itemId);
    if (!row) {
      row = addRowFromTemplate(tplSystem);
      row.querySelector(".bubble").textContent = "";
      systemByItemId.set(itemId, row);
    }
    return row;
  }

  function closeCommandGroup() {
    openCommandGroup = null;
  }

  function ensureOpenCommandGroup() {
    if (openCommandGroup) return openCommandGroup;

    const row = addRowFromTemplate(tplSystem);
    const bubble = row.querySelector(".bubble");
    bubble.textContent = "";

    const details = document.createElement("details");
    details.className = "fold plain group fold-command-group";

    const summary = document.createElement("summary");
    summary.className = "fold-summary fold-summary-compact";

    const left = document.createElement("div");
    left.className = "fold-left";
    const title = document.createElement("div");
    title.className = "fold-title";
    title.textContent = "実行済みコマンド";
    left.appendChild(title);

    const right = document.createElement("div");
    right.className = "fold-right";
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.setAttribute("data-role", "cmd-count");
    badge.textContent = "0";
    right.appendChild(badge);

    summary.appendChild(left);
    summary.appendChild(right);

    const body = document.createElement("div");
    body.className = "fold-body";
    body.setAttribute("data-role", "cmd-group-body");

    details.appendChild(summary);
    details.appendChild(body);
    bubble.appendChild(details);

    openCommandGroup = {
      row,
      bubble,
      details,
      body,
      countEl: badge,
      count: 0
    };
    return openCommandGroup;
  }

  function ensureCommandExecutionUI(itemId) {
    const existing = commandUIByItemId.get(itemId);
    if (existing) return existing;

    const group = ensureOpenCommandGroup();

    const details = document.createElement("details");
    details.className = "fold plain cmd-item";

    const summary = document.createElement("summary");
    summary.className = "fold-summary fold-summary-compact";

    const left = document.createElement("div");
    left.className = "fold-left";
    const title = document.createElement("div");
    title.className = "fold-title";
    title.textContent = "コマンドを実行";
    const preview = document.createElement("div");
    preview.className = "fold-sub";
    preview.setAttribute("data-role", "cmd-preview");
    left.appendChild(title);
    left.appendChild(preview);

    const right = document.createElement("div");
    right.className = "fold-right";
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.setAttribute("data-role", "cmd-status");
    badge.textContent = "";
    right.appendChild(badge);

    summary.appendChild(left);
    summary.appendChild(right);

    const pre = document.createElement("pre");
    pre.className = "codeblock";
    pre.setAttribute("data-role", "cmd-output");
    pre.textContent = "";

    details.appendChild(summary);
    details.appendChild(pre);
    group.body.appendChild(details);

    group.count++;
    if (group.countEl) group.countEl.textContent = String(group.count);

    const ui = {
      row: group.row,
      bubble: group.bubble,
      detailsEl: details,
      previewEl: details.querySelector('[data-role="cmd-preview"]'),
      statusEl: details.querySelector('[data-role="cmd-status"]'),
      outputEl: details.querySelector('[data-role="cmd-output"]')
    };
    commandUIByItemId.set(itemId, ui);
    return ui;
  }

  function ensureFileChangeUI(itemId) {
    const row = ensureSystemRow(itemId);
    const bubble = row.querySelector(".bubble");
    if (systemKindByItemId.get(itemId) !== "fileChange") {
      systemKindByItemId.set(itemId, "fileChange");
      bubble.textContent = "";

      const details = document.createElement("details");
      details.className = "fold plain fold-file";

      const summary = document.createElement("summary");
      summary.className = "fold-summary";

      const left = document.createElement("div");
      left.className = "fold-left";
      const title = document.createElement("div");
      title.className = "fold-title";
      title.textContent = "編集済みファイル";
      const sub = document.createElement("div");
      sub.className = "fold-sub";
      sub.setAttribute("data-role", "file-sub");
      left.appendChild(title);
      left.appendChild(sub);

      const right = document.createElement("div");
      right.className = "fold-right";
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.setAttribute("data-role", "file-count");
      badge.textContent = "";
      right.appendChild(badge);

      summary.appendChild(left);
      summary.appendChild(right);

      const body = document.createElement("div");
      body.className = "fold-body";
      body.setAttribute("data-role", "file-body");

      details.appendChild(summary);
      details.appendChild(body);
      bubble.appendChild(details);
    }

    return {
      row,
      bubble,
      detailsEl: bubble.querySelector("details"),
      subEl: bubble.querySelector('[data-role="file-sub"]'),
      countEl: bubble.querySelector('[data-role="file-count"]'),
      bodyEl: bubble.querySelector('[data-role="file-body"]')
    };
  }

  function parseDiffStats(diffText) {
    const lines = String(diffText || "").split("\n");
    let add = 0;
    let del = 0;
    for (const ln of lines) {
      if (!ln) continue;
      if (ln.startsWith("+++ ") || ln.startsWith("--- ")) continue;
      if (ln.startsWith("+")) add++;
      else if (ln.startsWith("-")) del++;
    }
    return { add, del };
  }

  function renderDiffLines(pre, diffText) {
    pre.textContent = "";
    const frag = document.createDocumentFragment();
    const lines = String(diffText || "").split("\n");
    for (const ln of lines) {
      const div = document.createElement("div");
      div.className = "diff-line";
      if (ln.startsWith("+") && !ln.startsWith("+++ ")) div.classList.add("add");
      else if (ln.startsWith("-") && !ln.startsWith("--- ")) div.classList.add("del");
      else if (ln.startsWith("@@")) div.classList.add("hunk");
      div.textContent = ln;
      frag.appendChild(div);
    }
    pre.appendChild(frag);
  }

  function renderFileChangesInto(bodyEl, changes) {
    bodyEl.textContent = "";

    if (!Array.isArray(changes) || changes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "変更はありません。";
      bodyEl.appendChild(empty);
      return;
    }

    for (const c of changes) {
      const fileDetails = document.createElement("details");
      fileDetails.className = "fold fold-file-item";

      const fileSummary = document.createElement("summary");
      fileSummary.className = "fold-summary fold-summary-compact";

      const left = document.createElement("div");
      left.className = "fold-left";
      const title = document.createElement("div");
      title.className = "fold-title";
      const kind = String(c && c.kind ? c.kind : "");
      const filePath = String(c && c.path ? c.path : "");
      title.textContent = `${kind ? kind + " " : ""}${filePath || "(unknown)"}`;
      left.appendChild(title);

      const right = document.createElement("div");
      right.className = "fold-right";
      const st = parseDiffStats(c && c.diff ? c.diff : "");
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = `${st.add ? "+" + st.add : "+0"} ${st.del ? "-" + st.del : "-0"}`;
      right.appendChild(badge);

      fileSummary.appendChild(left);
      fileSummary.appendChild(right);

      const pre = document.createElement("pre");
      pre.className = "diff";
      renderDiffLines(pre, c && c.diff ? c.diff : "");

      fileDetails.appendChild(fileSummary);
      fileDetails.appendChild(pre);
      bodyEl.appendChild(fileDetails);
    }
  }

  function parseUnifiedDiffToChanges(diffText) {
    const text = String(diffText || "");
    if (!text.trim()) return [];

    const lines = text.split("\n");
    const changes = [];

    let current = null;
    function flush() {
      if (!current) return;
      current.diff = current.diffLines.join("\n").trimEnd();
      delete current.diffLines;
      changes.push(current);
      current = null;
    }

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(ln);
      if (m) {
        flush();
        current = { kind: "edit", path: m[2], diffLines: [ln] };
        continue;
      }

      if (!current) {
        // Some diffs may start without diff --git; try to detect file headers.
        const mm = /^\+\+\+ b\/(.+)$/.exec(ln);
        if (mm) {
          current = { kind: "edit", path: mm[1], diffLines: [] };
        } else {
          continue;
        }
      }

      current.diffLines.push(ln);

      if (ln.startsWith("new file mode")) current.kind = "add";
      if (ln.startsWith("deleted file mode")) current.kind = "delete";
      if (ln.startsWith("--- /dev/null")) current.kind = "add";
      if (ln.startsWith("+++ /dev/null")) current.kind = "delete";
    }
    flush();

    // Fallback: if we didn't find file boundaries, show as single chunk.
    if (changes.length === 0) {
      return [{ kind: "edit", path: "diff", diff: text.trimEnd() }];
    }
    return changes.filter((c) => c && c.path && typeof c.diff === "string");
  }

  function clearChat() {
    assistantByItemId.clear();
    systemByItemId.clear();
    systemKindByItemId.clear();
    commandUIByItemId.clear();
    openCommandGroup = null;
    chat.textContent = "";
  }

  function toUserText(content) {
    if (!Array.isArray(content)) return "";
    const parts = [];
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
      else if (c.type === "mention" && typeof c.name === "string") parts.push("@" + c.name);
      else if (c.type === "skill" && typeof c.name === "string") parts.push("[skill] " + c.name);
      else if (c.type === "localImage" && typeof c.path === "string") parts.push("[image] " + c.path);
      else if (c.type === "image" && typeof c.url === "string") parts.push("[image] " + c.url);
    }
    return parts.join("\n");
  }

  function renderThread(thread) {
    if (!thread) return;
    clearChat();

    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    for (const turn of turns) {
      const items = (turn && Array.isArray(turn.items) ? turn.items : []) || [];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        if (item.type === "userMessage") {
          closeCommandGroup();
          addUserMessage(toUserText(item.content));
        } else if (item.type === "agentMessage") {
          closeCommandGroup();
          const row = addRowFromTemplate(tplAssistant);
          row.querySelector(".bubble").textContent = normalizeAssistantText(item.text || "");
        } else if (item.type === "plan") {
          closeCommandGroup();
          addSystemMessage("plan:\n" + (item.text || ""));
        } else if (item.type === "reasoning") {
          closeCommandGroup();
          const s = Array.isArray(item.summary) ? item.summary.join("\n") : "";
          addSystemMessage("reasoning summary:\n" + s);
        } else if (item.type === "commandExecution") {
          const id = String(item.id || "");
          if (!id) {
            closeCommandGroup();
            const out = item.aggregatedOutput || "";
            addSystemMessage("command:\n" + (item.command || "") + (out ? "\n\n" + out : ""));
          } else {
            const ui = ensureCommandExecutionUI(id);
            if (ui.previewEl) ui.previewEl.textContent = clampPreview(item.command || "", 80);
            if (ui.statusEl) ui.statusEl.textContent = String(item.status || "");
            if (ui.outputEl) {
              const out = item.aggregatedOutput || "";
              ui.outputEl.textContent = out
                ? `$ ${String(item.command || "").trim()}\n\n${out}`
                : `$ ${String(item.command || "").trim()}`;
            }
          }
        } else if (item.type === "fileChange") {
          closeCommandGroup();
          const id = String(item.id || "");
          const changes = Array.isArray(item.changes) ? item.changes : [];
          if (!id) {
            const header = changes.map((c) => `${c.kind} ${c.path}`).join("\n");
            addSystemMessage("file change:\n" + header);
          } else {
            const ui = ensureFileChangeUI(id);
            if (ui.subEl) ui.subEl.textContent = `${changes.length} files`;
            if (ui.countEl) ui.countEl.textContent = String(changes.length);
            if (ui.bodyEl) {
              renderFileChangesInto(
                ui.bodyEl,
                changes.map((c) => ({
                  kind: String(c && c.kind ? c.kind : ""),
                  path: String(c && c.path ? c.path : ""),
                  diff: String(c && c.diff ? c.diff : "")
                }))
              );
            }
          }
        } else if (item.type === "webSearch") {
          closeCommandGroup();
          addSystemMessage("web search:\n" + (item.query || ""));
        } else {
          closeCommandGroup();
          addSystemMessage("item: " + item.type);
        }
      }
    }
    scrollToBottom();
  }

  function ensureAssistantRow(itemId) {
    let row = assistantByItemId.get(itemId);
    if (!row) {
      row = addRowFromTemplate(tplAssistant);
      row.querySelector(".bubble").textContent = "";
      assistantByItemId.set(itemId, row);
    }
    return row;
  }

  function addApprovalRequest(requestId, method, params) {
    const row = addRowFromTemplate(tplSystem);
    const bubble = row.querySelector(".bubble");
    bubble.classList.add("approval");

    const title = document.createElement("div");
    title.textContent = `Approval requested: ${method}`;
    bubble.appendChild(title);

    const detail = document.createElement("pre");
    detail.style.margin = "0";
    detail.style.whiteSpace = "pre-wrap";
    detail.textContent = JSON.stringify(params ?? {}, null, 2);
    bubble.appendChild(detail);

    const actions = document.createElement("div");
    actions.className = "approval-actions";

    const accept = document.createElement("button");
    accept.textContent = "accept";
    accept.onclick = () => {
      vscode.postMessage({ type: "approvalResponse", requestId, method, decision: "accept" });
      bubble.textContent = "Approved.";
    };

    const decline = document.createElement("button");
    decline.textContent = "decline";
    decline.onclick = () => {
      vscode.postMessage({ type: "approvalResponse", requestId, method, decision: "decline" });
      bubble.textContent = "Declined.";
    };

    actions.appendChild(accept);
    actions.appendChild(decline);
    bubble.appendChild(actions);
  }

  function addUserInputRequest(requestId, params) {
    const row = addRowFromTemplate(tplSystem);
    const bubble = row.querySelector(".bubble");
    bubble.classList.add("approval");

    const title = document.createElement("div");
    title.textContent = "User input requested";
    bubble.appendChild(title);

    const questions = (params && params.questions) || [];
    const inputs = {};

    for (const q of questions) {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "4px";

      const label = document.createElement("div");
      label.textContent = `${q.header || q.id}: ${q.question || ""}`;
      wrap.appendChild(label);

      const field = document.createElement("input");
      field.type = q.isSecret ? "password" : "text";
      field.style.padding = "6px 8px";
      field.style.border = "1px solid var(--border)";
      field.style.borderRadius = "8px";
      field.style.background = "transparent";
      field.style.color = "var(--fg)";
      field.oninput = () => {
        inputs[q.id] = [field.value];
      };
      inputs[q.id] = [""];
      wrap.appendChild(field);
      bubble.appendChild(wrap);
    }

    const actions = document.createElement("div");
    actions.className = "approval-actions";

    const submit = document.createElement("button");
    submit.textContent = "submit";
    submit.onclick = () => {
      vscode.postMessage({ type: "userInputResponse", requestId, answers: inputs });
      bubble.textContent = "Submitted.";
    };
    actions.appendChild(submit);
    bubble.appendChild(actions);
  }

  function doSend() {
    const text = input.value.trim();
    if (!text && attachments.length === 0) return;
    const threadId = state && state.threadId ? String(state.threadId) : "";
    input.value = "";
    vscode.postMessage({ type: "send", text, attachments });
    attachments = [];
    renderAttachments();
    if (threadId) clearDraftForThread(threadId);
  }

  function handleSendOrStop() {
    if (isBusy) {
      vscode.postMessage({ type: "interruptTurn" });
      return;
    }
    doSend();
  }

  function setOptions(select, options, selected) {
    if (!select) return;

    const tag = String(select.tagName || "").toUpperCase();
    const isNative = select instanceof HTMLSelectElement;
    const isToolkitDropdown = tag === "VSCODE-DROPDOWN";

    if (isNative) {
      select.textContent = "";
    } else if (isToolkitDropdown) {
      for (const child of Array.from(select.children)) {
        const childTag = String(child.tagName || "").toUpperCase();
        if (childTag === "VSCODE-OPTION" || childTag === "OPTION") child.remove();
      }
    } else {
      select.textContent = "";
    }

    for (const opt of options) {
      const o = document.createElement(isToolkitDropdown ? "vscode-option" : "option");
      o.setAttribute("value", opt.value);
      o.textContent = opt.label;
      select.appendChild(o);
    }

    try {
      select.value = selected;
    } catch {
      // ignore
    }
  }

  function fmtThreadLabel(t) {
    const preview = (t.preview || "").replace(/\s+/g, " ").slice(0, 42);
    const updated = t.updatedAt ? new Date(t.updatedAt * 1000).toLocaleString() : "";
    return `${preview || t.id}${updated ? " · " + updated : ""}`;
  }

  function updateEffortOptions() {
    if (!state) return;
    const model = (state.models || []).find((m) => m.model === state.settings.model);
    const supported = (model && model.supportedReasoningEfforts) || [];
    const opts = supported.length
      ? supported.map((e) => ({ value: e.reasoningEffort, label: e.reasoningEffort }))
      : [
          "none",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh"
        ].map((v) => ({ value: v, label: v }));
    setOptions(effortSelect, [{ value: "", label: "effort: default" }, ...opts], state.settings.effort || "");
  }

  function applyState(s) {
    const prevThreadId = state && state.threadId ? String(state.threadId) : null;
    state = s;
    const models = (s.models || []).filter((m) => !m.hidden);
    setOptions(
      modelSelect,
      [{ value: "", label: "model: default" }, ...models.map((m) => ({ value: m.model, label: m.displayName }))],
      s.settings.model || ""
    );

    if (taskTitle) {
      const threads = Array.isArray(s.threads) ? s.threads : [];
      const current = threads.find((t) => t && t.id === s.threadId) || threads[0] || null;
      taskTitle.textContent = current ? taskDisplayTitle(current) : "タスク";
    }
    if (isTaskPickerOpen()) renderTaskPicker();

    const nextThreadId = s && s.threadId ? String(s.threadId) : null;
    if (nextThreadId && nextThreadId !== prevThreadId) {
      if (prevThreadId) persistDraftNow(prevThreadId);
      restoreDraftForThread(nextThreadId);
    } else if (nextThreadId && !prevThreadId) {
      restoreDraftForThread(nextThreadId);
    }

    setOptions(
      approvalSelect,
      [
        { value: "", label: "approval: default" },
        { value: "untrusted", label: "untrusted" },
        { value: "on-request", label: "on-request" },
        { value: "never", label: "never" }
      ],
      (s.settings && s.settings.approvalPolicy) || ""
    );
    setOptions(
      sandboxSelect,
      [
        { value: "", label: "sandbox: default" },
        { value: "read-only", label: "read-only" },
        { value: "workspace-write", label: "workspace-write" },
        { value: "danger-full-access", label: "danger-full-access" }
      ],
      (s.settings && s.settings.sandbox) || ""
    );

    updateEffortOptions();

    status.textContent = s.connectionStatus || "ready";

    if (fullAccessLabel && toggleFullAccess) {
      const sandbox = (s.settings && s.settings.sandbox) || null;
      const isFull = sandbox === "danger-full-access";
      fullAccessLabel.textContent = isFull ? "フルアクセス" : "デフォルト";
      toggleFullAccess.classList.toggle("is-full", isFull);
    }

    if (approvalLabel && toggleApproval) {
      const approval = (s.settings && s.settings.approvalPolicy) || null;
      const isNever = approval === "never";
      // "never" = no per-action prompts; others = may prompt.
      approvalLabel.textContent = isNever ? "承認: なし" : "承認: あり";
      toggleApproval.classList.toggle("is-never", isNever);
      toggleApproval.title = `approval: ${approval || "default"}`;
      toggleApproval.setAttribute("aria-label", `approval: ${approval || "default"}`);
    }

    renderRateFooter(s.rateLimits);
    setBusy(Boolean(s && s.busy));

    const t = s.thread || null;
    const updatedAt = t && typeof t.updatedAt === "number" ? t.updatedAt : null;
    if ((s.threadId && s.threadId !== lastRendered.threadId) || (updatedAt && updatedAt !== lastRendered.updatedAt)) {
      lastRendered = { threadId: s.threadId || null, updatedAt };
      renderThread(t);
    }
  }

  function labelForWindow(key, w) {
    const secs = Number(w && (w.windowSeconds ?? w.windowSec ?? w.window ?? w.periodSeconds ?? w.periodSec));
    if (Number.isFinite(secs) && secs > 0) {
      if (secs >= 4 * 3600 && secs <= 6 * 3600) return "5h";
      if (secs >= 6 * 24 * 3600 && secs <= 8 * 24 * 3600) return "week";
    }
    const k = String(key || "").toLowerCase();
    if (k.includes("5h") || k.includes("five")) return "5h";
    if (k.includes("week")) return "week";
    if (k.includes("primary")) return "5h";
    if (k.includes("secondary")) return "week";
    return k || "rate";
  }

  function toRemainingPercent(w) {
    if (!w || typeof w !== "object") return null;
    if (typeof w.remainingPercent === "number") return w.remainingPercent;
    if (typeof w.usedPercent === "number") return Math.max(0, Math.min(100, 100 - w.usedPercent));
    return null;
  }

  function pickRateWindows(rateLimits) {
    if (!rateLimits || typeof rateLimits !== "object") return [];

    const out = [];
    const keys = ["primary", "secondary", "fiveHour", "five_hour", "hour5", "week", "weekly"];
    for (const k of keys) {
      if (rateLimits[k]) out.push({ key: k, window: rateLimits[k] });
    }
    if (Array.isArray(rateLimits.windows)) {
      for (const w of rateLimits.windows) out.push({ key: "window", window: w });
    }

    const seen = new Set();
    const uniq = [];
    for (const it of out) {
      if (seen.has(it.window)) continue;
      seen.add(it.window);
      uniq.push(it);
    }
    return uniq;
  }

  function renderRateFooter(rateLimits) {
    if (!rateFooter) return;

    const wins = pickRateWindows(rateLimits);
    const labeled = [];
    for (const it of wins) {
      const remaining = toRemainingPercent(it.window);
      if (remaining === null) continue;
      labeled.push({ label: labelForWindow(it.key, it.window), remaining });
    }

    const byLabel = new Map();
    for (const it of labeled) if (!byLabel.has(it.label)) byLabel.set(it.label, it);

    const ordered = [];
    if (byLabel.has("5h")) ordered.push(byLabel.get("5h"));
    if (byLabel.has("week")) ordered.push(byLabel.get("week"));
    for (const it of labeled) {
      if (ordered.length >= 2) break;
      if (it.label === "5h" || it.label === "week") continue;
      ordered.push(it);
    }

    rateFooter.textContent = "";
    if (ordered.length === 0) return;

    for (const it of ordered) {
      const b = document.createElement("div");
      b.className = "badge";
      const label = it.label === "5h" ? "5時間" : it.label === "week" ? "週" : it.label;
      b.textContent = `${label} 残り ${Math.round(it.remaining)}%`;
      rateFooter.appendChild(b);
    }
  }

  send.addEventListener("click", handleSendOrStop);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isBusy) doSend();
    }
  });
  input.addEventListener("input", schedulePersistDraft);
  input.addEventListener("blur", () => persistDraftNow());

  if (openSettings) {
    openSettings.addEventListener("click", () => {
      // Settings and Task picker should behave like a single popover at a time.
      setTaskPickerOpen(false);
      setSettingsOpen(!isSettingsOpen());
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setSettingsOpen(false);
      setTaskPickerOpen(false);
    }
  });

  document.addEventListener("click", (e) => {
    if (!isSettingsOpen() && !isTaskPickerOpen()) return;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    if (openSettings && (path.includes(openSettings) || openSettings.contains(e.target))) return;
    if (settingsPop && (path.includes(settingsPop) || settingsPop.contains(e.target))) return;
    if (taskPickerButton && (path.includes(taskPickerButton) || taskPickerButton.contains(e.target))) return;
    if (taskPop && (path.includes(taskPop) || taskPop.contains(e.target))) return;
    setSettingsOpen(false);
    setTaskPickerOpen(false);
  });

  if (attachFiles) {
    attachFiles.addEventListener("click", () => {
      vscode.postMessage({ type: "pickFiles" });
    });
  }

  if (modelSelect) modelSelect.addEventListener("change", () => {
    const model = modelSelect.value || null;
    if (!state) state = { settings: {} };
    state.settings = state.settings || {};
    state.settings.model = model;
    updateEffortOptions();
    vscode.postMessage({ type: "setRunSettings", model, effort: (state.settings.effort || null) });
  });

  if (effortSelect) effortSelect.addEventListener("change", () => {
    const effort = effortSelect.value || null;
    if (!state) state = { settings: {} };
    state.settings = state.settings || {};
    state.settings.effort = effort;
    vscode.postMessage({ type: "setRunSettings", model: (state.settings.model || null), effort });
  });

  if (approvalSelect) approvalSelect.addEventListener("change", () => {
    const approvalPolicy = approvalSelect.value || null;
    const sandbox = (sandboxSelect.value || null);
    if (!state) state = { settings: {} };
    state.settings = state.settings || {};
    state.settings.approvalPolicy = approvalPolicy;
    vscode.postMessage({ type: "setAccessSettings", approvalPolicy, sandbox });
  });

  if (sandboxSelect) sandboxSelect.addEventListener("change", () => {
    const sandbox = sandboxSelect.value || null;
    const approvalPolicy = (approvalSelect.value || null);
    if (!state) state = { settings: {} };
    state.settings = state.settings || {};
    state.settings.sandbox = sandbox;
    vscode.postMessage({ type: "setAccessSettings", approvalPolicy, sandbox });
  });

  if (taskPickerButton) taskPickerButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setSettingsOpen(false);
    setTaskPickerOpen(!isTaskPickerOpen());
  });

  if (taskClose) taskClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setTaskPickerOpen(false);
  });

  if (taskNew) taskNew.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Save draft for the current task, then create and immediately switch to a fresh task.
    persistDraftNow();
    vscode.postMessage({ type: "newThread" });
    // Reset the composer draft so it feels like a clean task switch.
    if (input) input.value = "";
    attachments = [];
    renderAttachments();
    setTaskPickerOpen(false);
  });

  if (taskArchive) taskArchive.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!state || !state.threadId) return;
    const ok = confirm("このタスクを閉じますか？（アーカイブ）");
    if (!ok) return;
    vscode.postMessage({ type: "archiveThread", threadId: state.threadId });
    setTaskPickerOpen(false);
  });

  if (taskSearch) taskSearch.addEventListener("input", () => {
    taskQuery = taskSearch.value || "";
    renderTaskPicker();
  });

  if (toggleFullAccess) toggleFullAccess.addEventListener("click", () => {
    if (!state) return;
    const currentSandbox = (state.settings && state.settings.sandbox) || null;
    const nextSandbox = currentSandbox === "danger-full-access" ? null : "danger-full-access";
    const approvalPolicy = (state.settings && state.settings.approvalPolicy) || null;
    vscode.postMessage({ type: "setAccessSettings", approvalPolicy, sandbox: nextSandbox });
  });

  if (toggleApproval) toggleApproval.addEventListener("click", () => {
    if (!state) return;
    const currentApproval = (state.settings && state.settings.approvalPolicy) || null;
    const nextApproval = currentApproval === "never" ? "on-request" : "never";
    const sandbox = (state.settings && state.settings.sandbox) || null;
    vscode.postMessage({ type: "setAccessSettings", approvalPolicy: nextApproval, sandbox });
  });

  if (newThreadBtn) newThreadBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "newThread" });
    setSettingsOpen(false);
  });

  if (forkThreadBtn) forkThreadBtn.addEventListener("click", () => {
    if (!state || !state.threadId) return;
    vscode.postMessage({ type: "forkThread", threadId: state.threadId });
    setSettingsOpen(false);
  });

  if (rollback1Btn) rollback1Btn.addEventListener("click", () => {
    if (!state || !state.threadId) return;
    vscode.postMessage({ type: "rollbackThread", threadId: state.threadId, numTurns: 1 });
    setSettingsOpen(false);
  });

  if (archiveThreadBtn) archiveThreadBtn.addEventListener("click", () => {
    if (!state || !state.threadId) return;
    vscode.postMessage({ type: "archiveThread", threadId: state.threadId });
    setSettingsOpen(false);
  });

  if (unarchiveThreadBtn) unarchiveThreadBtn.addEventListener("click", () => {
    if (!state || !state.threadId) return;
    vscode.postMessage({ type: "unarchiveThread", threadId: state.threadId });
    setSettingsOpen(false);
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "status") {
      status.textContent = msg.message ? `${msg.status}: ${msg.message}` : msg.status;
      return;
    }

    if (msg.type === "state") {
      applyState(msg.state);
      return;
    }

    if (msg.type === "attachments") {
      attachments = Array.isArray(msg.files) ? msg.files : [];
      renderAttachments();
      schedulePersistDraft();
      return;
    }

    if (msg.type === "userMessage") {
      addUserMessage(msg.text);
      return;
    }

    if (msg.type === "systemMessage") {
      addSystemMessage(msg.text);
      return;
    }

    if (msg.type === "assistantStart") {
      closeCommandGroup();
      const row = ensureAssistantRow(msg.itemId);
      const bubble = row && row.querySelector ? row.querySelector(".bubble") : null;
      if (bubble) bubble.classList.add("pending");
      return;
    }

    if (msg.type === "assistantDelta") {
      closeCommandGroup();
      const row = ensureAssistantRow(msg.itemId);
      const bubble = row.querySelector(".bubble");
      bubble.classList.add("pending");
      bubble.textContent += msg.delta;
      if (looksLikeEscapedDocument(bubble.textContent)) bubble.textContent = unescapeCommonSequences(bubble.textContent);
      scrollToBottom();
      return;
    }

    if (msg.type === "assistantDone") {
      closeCommandGroup();
      const row = ensureAssistantRow(msg.itemId);
      const bubble = row.querySelector(".bubble");
      bubble.classList.remove("pending");
      bubble.textContent = normalizeAssistantText(msg.text);
      scrollToBottom();
      return;
    }

    if (msg.type === "systemDelta") {
      closeCommandGroup();
      const row = ensureSystemRow(msg.itemId);
      row.querySelector(".bubble").textContent += msg.delta;
      scrollToBottom();
      return;
    }

    if (msg.type === "systemDone") {
      closeCommandGroup();
      const row = ensureSystemRow(msg.itemId);
      row.querySelector(".bubble").textContent = msg.text;
      scrollToBottom();
      return;
    }

    if (msg.type === "commandExecutionDelta") {
      const ui = ensureCommandExecutionUI(msg.itemId);
      if (ui.detailsEl) ui.detailsEl.classList.add("pending");
      if (ui.outputEl) ui.outputEl.textContent += msg.delta;
      scrollToBottom();
      return;
    }

    if (msg.type === "commandExecutionDone") {
      const ui = ensureCommandExecutionUI(msg.itemId);
      if (ui.detailsEl) ui.detailsEl.classList.remove("pending");
      if (ui.previewEl) ui.previewEl.textContent = clampPreview(msg.command, 80);
      if (ui.statusEl) ui.statusEl.textContent = String(msg.status || "");
      if (ui.outputEl) {
        if (!ui.outputEl.textContent.trim()) {
          ui.outputEl.textContent = msg.output ? `$ ${String(msg.command || "").trim()}\n\n${msg.output}` : `$ ${String(msg.command || "").trim()}`;
        } else if (msg.output) {
          // Prefer the aggregated output if the stream was empty or truncated.
          // If streaming already filled content, keep it as-is to avoid jumpiness.
        }
      }
      scrollToBottom();
      return;
    }

    if (msg.type === "fileChangeDelta") {
      closeCommandGroup();
      // We can't reliably split per-file while streaming; keep a raw preview until completed.
      const ui = ensureFileChangeUI(msg.itemId);
      if (ui.detailsEl) ui.detailsEl.classList.add("pending");
      if (ui.subEl && !ui.subEl.textContent) ui.subEl.textContent = "streaming…";
      if (ui.bodyEl) {
        let pre = ui.bodyEl.querySelector("pre.codeblock");
        if (!pre) {
          ui.bodyEl.textContent = "";
          pre = document.createElement("pre");
          pre.className = "codeblock";
          ui.bodyEl.appendChild(pre);
        }
        pre.textContent += msg.delta;
      }
      scrollToBottom();
      return;
    }

    if (msg.type === "fileChangeDone") {
      closeCommandGroup();
      const ui = ensureFileChangeUI(msg.itemId);
      if (ui.detailsEl) ui.detailsEl.classList.remove("pending");
      const changes = Array.isArray(msg.changes) ? msg.changes : [];
      if (ui.subEl) ui.subEl.textContent = `${changes.length} files`;
      if (ui.countEl) ui.countEl.textContent = String(changes.length);
      if (ui.bodyEl) renderFileChangesInto(ui.bodyEl, changes);
      scrollToBottom();
      return;
    }

    if (msg.type === "approvalRequest") {
      addApprovalRequest(msg.requestId, msg.method, msg.params);
      return;
    }

    if (msg.type === "userInputRequest") {
      addUserInputRequest(msg.requestId, msg.params);
      return;
    }

    if (msg.type === "diffUpdated") {
      closeCommandGroup();
      lastTurnDiff = String(msg.diff || "");
      const changes = parseUnifiedDiffToChanges(lastTurnDiff);
      const ui = ensureFileChangeUI("__turn_diff__");
      if (ui.detailsEl) ui.detailsEl.classList.add("pending");
      if (ui.subEl) ui.subEl.textContent = `${changes.length} files`;
      if (ui.countEl) ui.countEl.textContent = String(changes.length);
      if (ui.bodyEl) renderFileChangesInto(ui.bodyEl, changes);
      scrollToBottom();
      return;
    }

    if (msg.type === "commandExecutionStart") {
      const ui = ensureCommandExecutionUI(msg.itemId);
      if (ui.detailsEl) ui.detailsEl.classList.add("pending");
      if (ui.previewEl) ui.previewEl.textContent = clampPreview(msg.command || "", 80);
      if (ui.statusEl) ui.statusEl.textContent = "running";
      scrollToBottom();
      return;
    }

    if (msg.type === "fileChangeStart") {
      closeCommandGroup();
      const ui = ensureFileChangeUI(msg.itemId);
      if (ui.detailsEl) ui.detailsEl.classList.add("pending");
      if (ui.subEl) ui.subEl.textContent = "編集中…";
      scrollToBottom();
      return;
    }

    if (msg.type === "turnBusy") {
      if (state && state.threadId && msg.threadId && state.threadId !== msg.threadId) return;
      setBusy(Boolean(msg.busy));
      if (!msg.busy) {
        const ui = ensureFileChangeUI("__turn_diff__");
        if (ui.detailsEl) ui.detailsEl.classList.remove("pending");
      }
      return;
    }
  });

  window.addEventListener("beforeunload", () => persistDraftNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistDraftNow();
  });

  vscode.postMessage({ type: "init" });
})();
