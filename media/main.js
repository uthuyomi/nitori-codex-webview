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
  const activityIndicator = document.getElementById("activityIndicator");
  const activityKind = document.getElementById("activityKind");
  const activityCwd = document.getElementById("activityCwd");
  const activityDetail = document.getElementById("activityDetail");
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
  const previewByPath = new Map(); // path -> dataUrl|null
  const previewReqById = new Map(); // requestId -> path
  const previewPendingByPath = new Set();
  let previewSeq = 1;
  let isBusy = false;
  // `turnBusy` from the extension is the source of truth for whether work is still running.
  // Without this, there are small gaps where pending counts hit 0 and we briefly clear busy,
  // causing the activity indicator to flash.
  let serverBusy = false;
  // Don't surface "busy/thinking" UI until the user actually sends a message in this webview
  // (or we see real streaming activity). This avoids showing "思考中" just by opening the view.
  let allowBusyUI = false;
  let pendingSend = false;
  let pendingAssistantItems = 0;
  let pendingCommandItems = 0;
  let pendingFileItems = 0;
  let clearBusyToken = 0;
  let taskQuery = "";
  let activeCommand = null;
  let activeFileChange = null;
  let stickyActivity = null; // { kind, kindLabel, detailText, untilMs }
  let lastActivityKey = "";
  let persisted = vscode.getState() || {};
  let draftsByThreadId =
    persisted && typeof persisted === "object" && persisted.draftsByThreadId && typeof persisted.draftsByThreadId === "object"
      ? persisted.draftsByThreadId
      : {};
  let draftSaveTimer = null;
  let shikiStyleEl = null;
  const cspNonce = (() => {
    try {
      const s = document.querySelector("script[nonce]");
      return s && s.nonce ? String(s.nonce) : "";
    } catch {
      return "";
    }
  })();

  function baseName(p) {
    return String(p || "").split(/[\\/]/).pop() || String(p || "");
  }

  function renderTextWithLinks(el, text) {
    if (!el) return;
    const raw = String(text || "");
    const maxLinkifyChars = 40000;
    if (raw.length > maxLinkifyChars) {
      el.textContent = raw;
      return;
    }

    // Match (in order): markdown link, autolink, url, windows path, posix/relative path+ext, filename+ext.
    const re =
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|<\s*(https?:\/\/[^>\s]+)\s*>|(https?:\/\/[^\s<>()]+)|\b([A-Za-z]:\\[^\s:*?"<>|]+(?:\\[^\s:*?"<>|]+)*)(?::(\d+))?(?::(\d+))?|(?:(\.\.?[\\/])?[\w@.-]+(?:[\\/][\w@.-]+)+\.[A-Za-z0-9]{1,6})(?:(?::(\d+))?(?::(\d+))?)|\b([\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|txt|css|scss|html|yml|yaml|toml|png|jpg|jpeg|gif|webp|bmp|vsix))(?::(\d+))?(?::(\d+))?|\b((?:\.\.?[\\/])?[\w@.-]+(?:[\\/][\w@.-]+)*\.[A-Za-z0-9]{1,6})#L(\d+)(?:C(\d+))?/g;

    const frag = document.createDocumentFragment();
    let last = 0;

    function appendText(s) {
      if (!s) return;
      frag.appendChild(document.createTextNode(s));
    }

    function trimTrailingPunct(u) {
      // Common trailing punctuation in prose; don't strip ')', since URLs can legitimately contain it.
      return String(u || "").replace(/[\],.;:!?]+$/g, "");
    }

    function makeLink(label, kind, payload) {
      const a = document.createElement("a");
      a.className = "codex-link";
      a.href = "#";
      a.textContent = label;
      a.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (kind === "external") vscode.postMessage({ type: "openExternal", url: payload.url });
        else if (kind === "file") vscode.postMessage(payload);
      };
      return a;
    }

    let m;
    while ((m = re.exec(raw))) {
      const start = m.index;
      const end = re.lastIndex;
      appendText(raw.slice(last, start));

      // Markdown link: [label](url)
      if (m[1] && m[2]) {
        frag.appendChild(makeLink(m[1], "external", { url: m[2] }));
        last = end;
        continue;
      }

      // Autolink: <https://...>
      if (m[3]) {
        const url = trimTrailingPunct(m[3]);
        frag.appendChild(makeLink(url, "external", { url }));
        last = end;
        continue;
      }

      // Raw URL
      if (m[4]) {
        const url = trimTrailingPunct(m[4]);
        frag.appendChild(makeLink(url, "external", { url }));
        last = end;
        continue;
      }

      // Windows absolute path with optional :line:col
      if (m[5]) {
        const p = m[5];
        const line = m[6] ? Number(m[6]) : undefined;
        const column = m[7] ? Number(m[7]) : undefined;
        frag.appendChild(makeLink(m[0], "file", { type: "openFileAt", path: p, line, column }));
        last = end;
        continue;
      }

      // Relative/posix path with extension + optional :line:col
      if (m[8]) {
        const p = m[8];
        const line = m[9] ? Number(m[9]) : undefined;
        const column = m[10] ? Number(m[10]) : undefined;
        frag.appendChild(makeLink(m[0], "file", { type: "openFileAt", path: p, line, column }));
        last = end;
        continue;
      }

      // Filename with extension + optional :line:col
      if (m[11]) {
        const p = m[11];
        const line = m[12] ? Number(m[12]) : undefined;
        const column = m[13] ? Number(m[13]) : undefined;
        frag.appendChild(makeLink(m[0], "file", { type: "openFileAt", path: p, line, column }));
        last = end;
        continue;
      }

      // path#LlineCcol
      if (m[14]) {
        const p = m[14];
        const line = m[15] ? Number(m[15]) : undefined;
        const column = m[16] ? Number(m[16]) : undefined;
        frag.appendChild(makeLink(m[0], "file", { type: "openFileAt", path: p, line, column }));
        last = end;
        continue;
      }

      appendText(raw.slice(start, end));
      last = end;
    }

    appendText(raw.slice(last));
    el.textContent = "";
    el.appendChild(frag);
  }

  function linkifyDom(rootEl) {
    if (!rootEl) return;
    const root = rootEl;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (!n || !n.parentElement) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (p.closest("a, pre, code, textarea, input")) return NodeFilter.FILTER_REJECT;
        const s = String(n.nodeValue || "");
        if (!s.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    let cur = walker.nextNode();
    while (cur) {
      nodes.push(cur);
      cur = walker.nextNode();
    }
    for (const n of nodes) {
      const span = document.createElement("span");
      renderTextWithLinks(span, n.nodeValue || "");
      n.parentNode.replaceChild(span, n);
    }
  }

  function renderHtmlInto(el, html) {
    if (!el) return;
    el.innerHTML = String(html || "");
    linkifyDom(el);
  }

  function isImagePath(p) {
    const ext = String(p || "").trim().toLowerCase().split(".").pop() || "";
    return ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "webp" || ext === "bmp";
  }

  function addAttachmentPath(p) {
    const path = String(p || "").trim();
    if (!path) return;
    if (!attachments.includes(path)) {
      attachments = attachments.concat([path]);
      renderAttachments();
      schedulePersistDraft();
    }
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function uploadFileObject(file) {
    if (!file) return;
    const maxBytes = 6 * 1024 * 1024;
    if (typeof file.size === "number" && file.size > maxBytes) {
      addSystemMessage(`添付が大きすぎます（最大 ${maxBytes} bytes）: ${file.name || "file"}`);
      return;
    }
    try {
      const buf = await file.arrayBuffer();
      const dataBase64 = arrayBufferToBase64(buf);
      vscode.postMessage({
        type: "uploadFiles",
        files: [{ name: file.name || "file", mime: file.type || "", dataBase64 }]
      });
    } catch {
      addSystemMessage(`添付の読み込みに失敗しました: ${file.name || "file"}`);
    }
  }

  function requestPreviewForPath(p) {
    const path = String(p || "").trim();
    if (!path) return;
    if (!isImagePath(path)) return;
    if (previewByPath.has(path)) return;
    if (previewPendingByPath.has(path)) return;
    const requestId = previewSeq++;
    previewPendingByPath.add(path);
    previewReqById.set(requestId, path);
    vscode.postMessage({ type: "getFilePreview", requestId, path });
  }

  function applyPreview(path, dataUrl) {
    const p = String(path || "");
    previewPendingByPath.delete(p);
    previewByPath.set(p, typeof dataUrl === "string" && dataUrl ? dataUrl : null);
    const imgs = document.querySelectorAll('img[data-preview-path]');
    for (const img of imgs) {
      if (!img || !img.dataset) continue;
      if (img.dataset.previewPath !== p) continue;
      if (previewByPath.get(p)) {
        img.src = previewByPath.get(p);
        img.classList.remove("is-loading");
        img.removeAttribute("aria-busy");
      } else {
        img.classList.add("is-missing");
        img.classList.remove("is-loading");
        img.removeAttribute("aria-busy");
      }
    }
  }

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

      const path = String(p || "");
      const imgKind = isImagePath(path);
      if (imgKind) {
        requestPreviewForPath(path);
        const thumb = document.createElement("img");
        thumb.className = "chip-thumb is-loading";
        thumb.alt = "image";
        thumb.dataset.previewPath = path;
        thumb.setAttribute("aria-busy", "true");
        const cached = previewByPath.get(path);
        if (cached) {
          thumb.src = cached;
          thumb.classList.remove("is-loading");
          thumb.removeAttribute("aria-busy");
        } else if (previewByPath.has(path)) {
          thumb.classList.add("is-missing");
          thumb.classList.remove("is-loading");
          thumb.removeAttribute("aria-busy");
        }
        chip.appendChild(thumb);
      }

      if (!imgKind) {
        const text = document.createElement("div");
        text.className = "chip-text";
        text.textContent = baseName(path);
        chip.appendChild(text);
      }

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

  function scheduleMaybeClearBusy() {
    const token = ++clearBusyToken;
    setTimeout(() => {
      if (token !== clearBusyToken) return;
      if (!isBusy) return;
      if (serverBusy) return;
      if (pendingSend) return;
      if (pendingAssistantItems || pendingCommandItems || pendingFileItems) return;
      if (activeCommand || activeFileChange) return;
      setBusy(false);
    }, 250);
  }

  function setBusy(busy) {
    isBusy = Boolean(busy);
    if (!isBusy) {
      activeCommand = null;
      activeFileChange = null;
      stickyActivity = null;
      pendingSend = false;
      pendingAssistantItems = 0;
      pendingCommandItems = 0;
      pendingFileItems = 0;
      clearBusyToken++;
    }
    if (send) {
      send.classList.toggle("is-busy", isBusy);
      send.title = isBusy ? "Stop" : "Send";
      send.setAttribute("aria-label", isBusy ? "Stop" : "Send");
    }
    if (sendIconUse) {
      sendIconUse.setAttribute("href", isBusy ? "#ico-stop" : "#ico-up");
    }
    renderActivityIndicator();
  }

  function renderActivityIndicator() {
    if (!activityIndicator) return;

    // Only show while the Send button is in "Stop" mode (turn busy).
    if (!isBusy) {
      activityIndicator.hidden = true;
      activityIndicator.classList.remove("is-active");
      lastActivityKey = "";
      return;
    }

    const cwd = state && state.cwd ? String(state.cwd) : "";
    const now = Date.now();

    let kind = "thinking";
    let kindLabel = "思考中";
    let detailText = "";

    if (activeFileChange) {
      kind = "file";
      kindLabel = "ファイル編集中";
    } else if (activeCommand) {
      kind = "command";
      kindLabel = "コマンド執行中";
    } else if (stickyActivity && typeof stickyActivity.untilMs === "number" && stickyActivity.untilMs > now) {
      // Keep the last non-thinking activity visible briefly so it doesn't just flash.
      kind = stickyActivity.kind || kind;
      kindLabel = stickyActivity.kindLabel || kindLabel;
      detailText = stickyActivity.detailText || detailText;
    }

    // Refresh stickiness while command/file is active; also keep it briefly after completion.
    if (kind !== "thinking") {
      stickyActivity = { kind, kindLabel, detailText, untilMs: now + 1500 };
    }

    const key = `${kind}\n${cwd}\n${detailText}`;
    if (key === lastActivityKey && !activityIndicator.hidden) return;
    lastActivityKey = key;

    activityIndicator.hidden = false;
    activityIndicator.classList.add("is-active");
    activityIndicator.dataset.kind = kind;

    if (activityKind) activityKind.textContent = kindLabel;
    if (activityCwd) activityCwd.textContent = cwd || "(no workspace folder)";
    if (activityDetail) activityDetail.textContent = detailText ? ` · ${detailText}` : "";
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
    const bubble = row.querySelector(".bubble");
    bubble.textContent = "";

    const msgText = String(text || "");
    if (msgText.trim()) {
      const t = document.createElement("div");
      t.className = "msg-text";
      renderTextWithLinks(t, msgText);
      bubble.appendChild(t);
    }

    const a = arguments.length >= 2 ? arguments[1] : null;
    const list = Array.isArray(a) ? a : [];
    if (list.length) {
      const wrap = document.createElement("div");
      wrap.className = "attachments attachments-msg";

      for (const raw of list) {
        const path = typeof raw === "string" ? raw : raw && typeof raw.path === "string" ? raw.path : "";
        const url = raw && typeof raw === "object" && typeof raw.url === "string" ? raw.url : "";

        const chip = document.createElement("div");
        chip.className = "chip chip-msg";

        const isLocal = Boolean(path);
        const isImg = url ? true : isImagePath(path);
        if (isImg) {
          const img = document.createElement("img");
          img.className = "chip-thumb chip-thumb-msg";
          img.alt = "image";
          if (url) {
            img.src = url;
          } else {
            requestPreviewForPath(path);
            img.dataset.previewPath = path;
            const cached = previewByPath.get(path);
            if (cached) img.src = cached;
            else if (previewByPath.has(path)) {
              img.classList.add("is-missing");
            } else {
              img.classList.add("is-loading");
              img.setAttribute("aria-busy", "true");
            }
          }
          chip.appendChild(img);
        }

        if (!isImg) {
          const name = raw && typeof raw === "object" && typeof raw.name === "string" ? raw.name : baseName(path);
          const t = document.createElement("div");
          t.className = "chip-text";
          t.textContent = name;
          chip.appendChild(t);
        }

        if (isLocal) {
          const openBtn = document.createElement("button");
          openBtn.className = "chip-act";
          openBtn.textContent = "開く";
          openBtn.title = "VS Codeで開く";
          openBtn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            vscode.postMessage({ type: "openLocalFile", path });
          };
          chip.appendChild(openBtn);

          const reBtn = document.createElement("button");
          reBtn.className = "chip-act";
          reBtn.textContent = "再添付";
          reBtn.title = "このファイルを入力欄に再添付";
          reBtn.onclick = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (!attachments.includes(path)) {
              attachments = attachments.concat([path]);
              renderAttachments();
              schedulePersistDraft();
            }
          };
          chip.appendChild(reBtn);
        }

        wrap.appendChild(chip);
      }
      bubble.appendChild(wrap);
    }
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
    renderTextWithLinks(row.querySelector(".bubble"), text);
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
      title.textContent = "";
      if (kind) title.appendChild(document.createTextNode(kind + " "));
      if (filePath) {
        const a = document.createElement("a");
        a.className = "codex-link";
        a.href = "#";
        a.textContent = filePath;
        a.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          vscode.postMessage({ type: "openFileAt", path: filePath });
        };
        title.appendChild(a);
      } else {
        title.appendChild(document.createTextNode("(unknown)"));
      }
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

  function parseUserContent(content) {
    const textParts = [];
    const atts = [];
    if (!Array.isArray(content)) return { text: "", attachments: [] };
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      const t = String(c.type || "");
      if (t === "text" && typeof c.text === "string") textParts.push(c.text);
      else if (t === "mention" && typeof c.path === "string") {
        atts.push({ path: c.path, name: typeof c.name === "string" ? c.name : baseName(c.path) });
      } else if ((t === "localImage" || t === "local_image") && typeof c.path === "string") {
        atts.push({ path: c.path, name: baseName(c.path) });
      } else if ((t === "image" || t === "input_image") && (typeof c.url === "string" || typeof c.image_url === "string")) {
        const url = typeof c.url === "string" ? c.url : c.image_url;
        atts.push({ url, name: "image" });
      }
    }
    return { text: textParts.join("\n"), attachments: atts };
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
          const parsed = parseUserContent(item.content);
          addUserMessage(parsed.text, parsed.attachments);
        } else if (item.type === "agentMessage") {
          closeCommandGroup();
          const row = addRowFromTemplate(tplAssistant);
          const bubble = row.querySelector(".bubble");
          if (item.html && typeof item.html === "string") renderHtmlInto(bubble, item.html);
          else renderTextWithLinks(bubble, normalizeAssistantText(item.text || ""));
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
              const rendered = out ? `$ ${String(item.command || "").trim()}\n\n${out}` : `$ ${String(item.command || "").trim()}`;
              renderTextWithLinks(ui.outputEl, rendered);
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

    function jsonPreview(v, maxChars) {
      const max = typeof maxChars === "number" && maxChars > 0 ? maxChars : 2000;
      try {
        const s = JSON.stringify(v ?? {}, null, 2);
        if (typeof s !== "string") return String(v ?? "");
        if (s.length <= max) return s;
        return s.slice(0, Math.max(0, max - 64)) + `\n… (truncated, ${s.length} chars total)`;
      } catch {
        return String(v ?? "");
      }
    }

    const title = document.createElement("div");
    title.textContent = `Approval requested: ${method}`;
    bubble.appendChild(title);

    const detail = document.createElement("pre");
    detail.style.margin = "0";
    detail.style.whiteSpace = "pre-wrap";
    detail.textContent = jsonPreview(params ?? {}, 2000);
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
    if (pendingSend) return;
    pendingSend = true;
    allowBusyUI = true;
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

  function resolveEffectiveModelId(s, models) {
    const explicit = s && s.settings && typeof s.settings.model === "string" ? s.settings.model : "";
    if (explicit) return explicit;

    const thread = s && s.thread ? s.thread : null;
    const threadCandidates = [
      thread && typeof thread.model === "string" ? thread.model : "",
      thread && thread.settings && typeof thread.settings.model === "string" ? thread.settings.model : "",
      thread && thread.run && typeof thread.run.model === "string" ? thread.run.model : "",
      thread && thread.config && typeof thread.config.model === "string" ? thread.config.model : ""
    ].filter(Boolean);
    if (threadCandidates.length) return threadCandidates[0];

    const cfg = s && s.config ? s.config : null;
    const configCandidates = [
      cfg && typeof cfg.model === "string" ? cfg.model : "",
      cfg && typeof cfg.defaultModel === "string" ? cfg.defaultModel : "",
      cfg && cfg.defaults && typeof cfg.defaults.model === "string" ? cfg.defaults.model : "",
      cfg && cfg.run && typeof cfg.run.model === "string" ? cfg.run.model : ""
    ].filter(Boolean);
    if (configCandidates.length) return configCandidates[0];

    const visible = Array.isArray(models) ? models.filter((m) => m && !m.hidden) : [];
    const flagged =
      visible.find((m) => m && (m.isDefault === true || m.default === true || m.is_default === true)) || null;
    if (flagged && typeof flagged.model === "string" && flagged.model) return flagged.model;

    return visible[0] && typeof visible[0].model === "string" ? visible[0].model : "";
  }

  function resolveEffectiveModelLabel(models, modelId) {
    const list = Array.isArray(models) ? models : [];
    const m = list.find((x) => x && x.model === modelId) || null;
    if (m && typeof m.displayName === "string" && m.displayName) return m.displayName;
    return modelId || "loading...";
  }

  function updateEffortOptions() {
    if (!state) return;
    const effectiveModelId = resolveEffectiveModelId(state, state.models || []);
    const model = (state.models || []).find((m) => m.model === effectiveModelId);
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
    const effectiveModelId = resolveEffectiveModelId(s, models);
    const effectiveModelLabel = resolveEffectiveModelLabel(models, effectiveModelId);
    setOptions(
      modelSelect,
      [{ value: "", label: `model: ${effectiveModelLabel}` }, ...models.map((m) => ({ value: m.model, label: m.displayName }))],
      (s.settings && s.settings.model) || ""
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
    serverBusy = Boolean(s && s.busy);
    setBusy(serverBusy && allowBusyUI);

    const t = s.thread || null;
    const updatedAt = t && typeof t.updatedAt === "number" ? t.updatedAt : null;
    if ((s.threadId && s.threadId !== lastRendered.threadId) || (updatedAt && updatedAt !== lastRendered.updatedAt)) {
      lastRendered = { threadId: s.threadId || null, updatedAt };
      renderThread(t);
    }
  }

  function applyAccessSettingsPatch(patch) {
    if (!state) return;
    const nextSettings = Object.assign({}, state.settings || {}, patch || {});
    // applyState() updates labels/selects consistently without re-rendering the thread,
    // unless threadId/updatedAt changed (they won't here).
    applyState(Object.assign({}, state, { settings: nextSettings }));
  }

  function windowDurationMins(w) {
    const mins = Number(w && (w.windowDurationMins ?? w.windowMins));
    if (Number.isFinite(mins) && mins > 0) return mins;

    const secs = Number(w && (w.windowSeconds ?? w.windowSec ?? w.window ?? w.periodSeconds ?? w.periodSec));
    if (Number.isFinite(secs) && secs > 0) return secs / 60;

    return null;
  }

  function labelForWindow(key, w) {
    const mins = windowDurationMins(w);
    if (mins !== null) {
      if (mins === 300) return "5h";
      if (mins === 10080) return "week";
    }

    const k = String(key || "").toLowerCase();
    if (k === "primary") return "5h";
    if (k === "secondary") return "week";
    if (k.includes("week")) return "week";
    return k || "rate";
  }

  function toRemainingPercent(w) {
    if (!w || typeof w !== "object") return null;
    if (typeof w.remainingPercent === "number") {
      const r = Number(w.remainingPercent);
      if (!Number.isFinite(r)) return null;
      // Heuristic: some servers may return 0..1; prefer treating fractional values as ratios.
      if (r >= 0 && r <= 1 && String(w.remainingPercent).includes(".")) return Math.max(0, Math.min(100, r * 100));
      return Math.max(0, Math.min(100, r));
    }
    if (typeof w.usedPercent === "number") {
      const u = Number(w.usedPercent);
      if (!Number.isFinite(u)) return null;
      // Heuristic: if usedPercent is fractional (0..1 with decimals), treat it as a ratio.
      if (u >= 0 && u <= 1 && String(w.usedPercent).includes(".")) return Math.max(0, Math.min(100, 100 - u * 100));
      return Math.max(0, Math.min(100, 100 - u));
    }
    return null;
  }

  function fmtPercent(p) {
    const n = Number(p);
    if (!Number.isFinite(n)) return null;
    const clamped = Math.max(0, Math.min(100, n));
    const s = clamped.toFixed(2);
    return s.replace(/\.?0+$/g, "");
  }

  function pickRateWindows(rateLimits) {
    if (!rateLimits || typeof rateLimits !== "object") return [];

    const source =
      rateLimits.rateLimits && typeof rateLimits.rateLimits === "object"
        ? rateLimits.rateLimits
        : rateLimits;

    const out = [];
    const baseLimitId = typeof source.limitId === "string" ? source.limitId : "";
    const baseLimitName = typeof source.limitName === "string" ? source.limitName : "";
    if (source.primary) out.push({ key: "primary", window: source.primary, limitId: baseLimitId, limitName: baseLimitName });
    if (source.secondary) out.push({ key: "secondary", window: source.secondary, limitId: baseLimitId, limitName: baseLimitName });

    if (out.length === 0 && Array.isArray(source.windows)) {
      for (const w of source.windows) out.push({ key: "window", window: w, limitId: baseLimitId, limitName: baseLimitName });
    }

    if (out.length === 0 && source.rateLimitsByLimitId && typeof source.rateLimitsByLimitId === "object") {
      for (const entry of Object.values(source.rateLimitsByLimitId)) {
        if (!entry || typeof entry !== "object") continue;
        const limitId = typeof entry.limitId === "string" ? entry.limitId : "";
        const limitName = typeof entry.limitName === "string" ? entry.limitName : "";
        if (entry.primary) out.push({ key: "primary", window: entry.primary, limitId, limitName });
        if (entry.secondary) out.push({ key: "secondary", window: entry.secondary, limitId, limitName });
        if (out.length > 0) break;
      }
    }

    return out;
  }

  function renderRateFooter(rateLimits) {
    if (!rateFooter) return;

    const wins = pickRateWindows(rateLimits);
    const labeled = [];
    for (const it of wins) {
      const remaining = toRemainingPercent(it.window);
      if (remaining === null) continue;
      labeled.push({
        label: labelForWindow(it.key, it.window),
        remaining,
        resetsAt: Number(it.window && it.window.resetsAt),
        usedRaw: it.window && typeof it.window.usedPercent === "number" ? it.window.usedPercent : null,
        remainingRaw: it.window && typeof it.window.remainingPercent === "number" ? it.window.remainingPercent : null,
        windowMins: windowDurationMins(it.window),
        limitId: typeof it.limitId === "string" ? it.limitId : "",
        limitName: typeof it.limitName === "string" ? it.limitName : ""
      });
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
      const label = it.label === "5h" ? "5hour" : it.label === "week" ? "Weekly" : it.label;
      const shown = fmtPercent(it.remaining);
      b.textContent = `${label} 残り ${shown === null ? "?" : shown}%`;
      const parts = [];
      if (it.limitId) parts.push(`limitId=${it.limitId}`);
      if (it.limitName) parts.push(`limitName=${it.limitName}`);
      if (Number.isFinite(it.windowMins) && it.windowMins > 0) parts.push(`window=${it.windowMins}m`);
      if (it.usedRaw !== null) parts.push(`usedRaw=${it.usedRaw}`);
      if (it.remainingRaw !== null) parts.push(`remainingRaw=${it.remainingRaw}`);
      if (shown !== null) parts.push(`remainingShown=${shown}%`);
      if (Number.isFinite(it.resetsAt) && it.resetsAt > 0) parts.push(`resetsAt=${new Date(it.resetsAt * 1000).toLocaleString()}`);
      if (parts.length) b.title = parts.join(" · ");
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
  input.addEventListener("dragover", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
      e.preventDefault();
    }
  });
  input.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (!dt || !dt.files || dt.files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    for (const f of Array.from(dt.files)) {
      if (f && typeof f.path === "string" && f.path) addAttachmentPath(f.path);
      else uploadFileObject(f);
    }
  });
  input.addEventListener("paste", (e) => {
    const cd = e.clipboardData;
    if (!cd || !cd.items) return;
    const files = [];
    for (const item of Array.from(cd.items)) {
      if (!item || item.kind !== "file") continue;
      const f = item.getAsFile ? item.getAsFile() : null;
      if (f) files.push(f);
    }
    if (files.length === 0) return;
    e.preventDefault();
    for (const f of files) uploadFileObject(f);
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

  if (chat) {
    chat.addEventListener("click", (e) => {
      const t = e.target;
      const a = t && typeof t.closest === "function" ? t.closest("a") : null;
      if (!a) return;
      const href = String(a.getAttribute("href") || "");
      if (!href || href === "#") return;

      // Don't let the webview navigate.
      e.preventDefault();
      e.stopPropagation();

      if (/^https?:\/\//i.test(href)) {
        vscode.postMessage({ type: "openExternal", url: href });
        return;
      }

      // file-like: path:line:col or path#LlineCcol
      let path = href;
      let line = undefined;
      let column = undefined;

      const hashMatch = /^(.*)#L(\d+)(?:C(\d+))?$/.exec(href);
      if (hashMatch) {
        path = hashMatch[1];
        line = Number(hashMatch[2]);
        column = hashMatch[3] ? Number(hashMatch[3]) : undefined;
      } else {
        const m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(href);
        if (m) {
          path = m[1];
          line = m[2] ? Number(m[2]) : undefined;
          column = m[3] ? Number(m[3]) : undefined;
        }
      }

      vscode.postMessage({ type: "openFileAt", path, line, column });
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
    applyAccessSettingsPatch({ sandbox: nextSandbox });
    vscode.postMessage({ type: "setAccessSettings", approvalPolicy, sandbox: nextSandbox });
  });

  if (toggleApproval) toggleApproval.addEventListener("click", () => {
    if (!state) return;
    const currentApproval = (state.settings && state.settings.approvalPolicy) || null;
    const nextApproval = currentApproval === "never" ? "on-request" : "never";
    const sandbox = (state.settings && state.settings.sandbox) || null;
    applyAccessSettingsPatch({ approvalPolicy: nextApproval });
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

    if (msg.type === "shikiCss") {
      const css = String(msg.css || "");
      if (!shikiStyleEl) {
        shikiStyleEl = document.createElement("style");
        shikiStyleEl.id = "shiki-style";
        if (cspNonce) shikiStyleEl.setAttribute("nonce", cspNonce);
        document.head.appendChild(shikiStyleEl);
      }
      shikiStyleEl.textContent = css;
      return;
    }

    if (msg.type === "status") {
      status.textContent = msg.message ? `${msg.status}: ${msg.message}` : msg.status;
      return;
    }

    if (msg.type === "state") {
      applyState(msg.state);
      return;
    }

    if (msg.type === "rateLimits") {
      const rateLimits = msg.rateLimits || null;
      if (state && typeof state === "object") state.rateLimits = rateLimits;
      renderRateFooter(rateLimits);
      return;
    }

    if (msg.type === "attachments") {
      attachments = Array.isArray(msg.files) ? msg.files : [];
      renderAttachments();
      schedulePersistDraft();
      return;
    }

    if (msg.type === "attachmentsAdd") {
      const files = Array.isArray(msg.files) ? msg.files : [];
      for (const p of files) addAttachmentPath(p);
      return;
    }

    if (msg.type === "userMessage") {
      addUserMessage(msg.text, Array.isArray(msg.attachments) ? msg.attachments : []);
      return;
    }

    if (msg.type === "filePreview") {
      const path = String(msg.path || "");
      applyPreview(path, msg.dataUrl);
      return;
    }

    if (msg.type === "systemMessage") {
      addSystemMessage(msg.text);
      return;
    }

    if (msg.type === "assistantStart") {
      allowBusyUI = true;
      pendingSend = false;
      pendingAssistantItems++;
      if (!isBusy) setBusy(true);
      closeCommandGroup();
      const row = ensureAssistantRow(msg.itemId);
      const bubble = row && row.querySelector ? row.querySelector(".bubble") : null;
      if (bubble) bubble.classList.add("pending");
      return;
    }

    if (msg.type === "assistantDelta") {
      allowBusyUI = true;
      pendingSend = false;
      if (!isBusy) setBusy(true);
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
      if (typeof msg.html === "string" && msg.html) renderHtmlInto(bubble, msg.html);
      else renderTextWithLinks(bubble, normalizeAssistantText(msg.text));
      scrollToBottom();
      if (pendingAssistantItems > 0) pendingAssistantItems--;
      scheduleMaybeClearBusy();
      return;
    }

    if (msg.type === "assistantRendered") {
      const row = ensureAssistantRow(msg.itemId);
      const bubble = row.querySelector(".bubble");
      renderHtmlInto(bubble, msg.html);
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
      renderTextWithLinks(row.querySelector(".bubble"), msg.text);
      scrollToBottom();
      scheduleMaybeClearBusy();
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
        renderTextWithLinks(ui.outputEl, ui.outputEl.textContent);
      }
      if (activeCommand && activeCommand.itemId === msg.itemId) activeCommand = null;
      renderActivityIndicator();
      scrollToBottom();
      if (pendingCommandItems > 0) pendingCommandItems--;
      scheduleMaybeClearBusy();
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
      if (!activeFileChange || activeFileChange.itemId !== msg.itemId) {
        activeFileChange = { itemId: msg.itemId };
        renderActivityIndicator();
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
      if (activeFileChange && activeFileChange.itemId === msg.itemId) activeFileChange = null;
      renderActivityIndicator();
      scrollToBottom();
      if (pendingFileItems > 0) pendingFileItems--;
      scheduleMaybeClearBusy();
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
      allowBusyUI = true;
      pendingSend = false;
      pendingCommandItems++;
      if (!isBusy) setBusy(true);
      const ui = ensureCommandExecutionUI(msg.itemId);
      if (ui.detailsEl) ui.detailsEl.classList.add("pending");
      if (ui.previewEl) ui.previewEl.textContent = clampPreview(msg.command || "", 80);
      if (ui.statusEl) ui.statusEl.textContent = "running";
      activeCommand = { itemId: msg.itemId, command: String(msg.command || "") };
      renderActivityIndicator();
      scrollToBottom();
      return;
    }

    if (msg.type === "fileChangeStart") {
      allowBusyUI = true;
      pendingSend = false;
      pendingFileItems++;
      if (!isBusy) setBusy(true);
      closeCommandGroup();
      const ui = ensureFileChangeUI(msg.itemId);
      if (ui.detailsEl) ui.detailsEl.classList.add("pending");
      if (ui.subEl) ui.subEl.textContent = "編集中…";
      activeFileChange = { itemId: msg.itemId };
      renderActivityIndicator();
      scrollToBottom();
      return;
    }

    if (msg.type === "turnBusy") {
      if (state && state.threadId && msg.threadId && state.threadId !== msg.threadId) return;
      pendingSend = false;
      if (msg.busy) allowBusyUI = true;
      serverBusy = Boolean(msg.busy);
      setBusy(serverBusy && allowBusyUI);
      if (!msg.busy) {
        activeCommand = null;
        activeFileChange = null;
        pendingAssistantItems = 0;
        pendingCommandItems = 0;
        pendingFileItems = 0;
        clearBusyToken++;
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
