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
  const uiLocaleSelect = document.getElementById("uiLocaleSelect");
  const baseInstructionsInput = document.getElementById("baseInstructionsInput");
  const saveBaseInstructionsBtn = document.getElementById("saveBaseInstructions");
  const clearBaseInstructionsBtn = document.getElementById("clearBaseInstructions");
  const developerInstructionsInput = document.getElementById("developerInstructionsInput");
  const saveDeveloperInstructionsBtn = document.getElementById("saveDeveloperInstructions");
  const clearDeveloperInstructionsBtn = document.getElementById("clearDeveloperInstructions");
  const collaborationModeSelect = document.getElementById("collaborationModeSelect");
  const personalitySelect = document.getElementById("personalitySelect");
  const saveInstructionModesBtn = document.getElementById("saveInstructionModes");
  const clearInstructionModesBtn = document.getElementById("clearInstructionModes");
  const openAgentsInstructionsBtn = document.getElementById("openAgentsInstructions");
  const createAgentsInstructionsBtn = document.getElementById("createAgentsInstructions");
  const agentsInstructionsStatus = document.getElementById("agentsInstructionsStatus");
  const taskSettingsTitle = document.getElementById("taskSettingsTitle");
  const runSettingsTitle = document.getElementById("runSettingsTitle");
  const projectInstructionsTitle = document.getElementById("projectInstructionsTitle");
  const projectInstructionsHelp = document.getElementById("projectInstructionsHelp");
  const baseInstructionsTitle = document.getElementById("baseInstructionsTitle");
  const baseInstructionsHelp = document.getElementById("baseInstructionsHelp");
  const sessionInstructionsTitle = document.getElementById("sessionInstructionsTitle");
  const sessionInstructionsHelp = document.getElementById("sessionInstructionsHelp");
  const modeInstructionsTitle = document.getElementById("modeInstructionsTitle");
  const modeInstructionsHelp = document.getElementById("modeInstructionsHelp");
  const homeButton = document.getElementById("homeButton");
  const taskPop = document.getElementById("taskPop");
  const chatPage = document.getElementById("chatPage");
  const taskSearch = document.getElementById("taskSearch");
  const taskArchive = document.getElementById("taskArchive");
  const taskList = document.getElementById("taskList");
  const taskTitle = document.getElementById("taskTitle");
  const taskSubtitle = document.getElementById("taskSubtitle");
  const chatEmpty = document.getElementById("chatEmpty");
  const homeStats = document.getElementById("homeStats");
  const homeButtonIconUse = document.getElementById("homeButtonIconUse");
  const taskClose = document.getElementById("taskClose");
  const taskNew = document.getElementById("taskNew");
  const taskListLabel = document.getElementById("taskListLabel");
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
  const noticeStack = document.getElementById("noticeStack");
  const rateFooter = document.getElementById("rateFooter");
  const sendIconUse = document.getElementById("sendIconUse");
  const personaSettingsLocked = true;

  const tplUser = document.getElementById("msg-user");
  const tplAssistant = document.getElementById("msg-assistant");
  const tplSystem = document.getElementById("msg-system");

  function autoResizeInput() {
    if (!input || input.tagName !== "TEXTAREA") return;
    try {
      const style = getComputedStyle(input);
      const minH = Number.parseFloat(style.minHeight);
      const maxH = Number.parseFloat(style.maxHeight);
      const minPx = Number.isFinite(minH) ? minH : 0;
      const maxPx = Number.isFinite(maxH) ? maxH : null;

      input.style.height = "auto";
      const desired = input.scrollHeight;
      const next = Math.max(minPx, maxPx ? Math.min(desired, maxPx) : desired);
      input.style.height = `${next}px`;
      if (maxPx) input.style.overflowY = desired > maxPx ? "auto" : "hidden";
    } catch {
      // ignore
    }
  }

  const assistantByItemId = new Map();
  const assistantHtmlByItemId = new Map();
  const systemByItemId = new Map();
  const systemKindByItemId = new Map();
  const commandUIByItemId = new Map();
  let openCommandGroup = null;
  let lastTurnDiff = "";
  let state = null;
  let lastRendered = { threadId: null, updatedAt: null, historySignature: null };
  let lastTaskSummarySignature = "";
  let currentPage = "home";
  let showArchivedTasks = false;
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
  let liveAssistantPreview = null; // { itemId, text, html, pending }
  let liveAssistantRow = null;
  let stickyActivity = null; // { kind, kindLabel, detailText, untilMs }
  let lastActivityKey = "";
  let uiLocale = "ja";
  const DEFAULT_VISIBLE_HISTORY_COUNT = Number.MAX_SAFE_INTEGER;
  let visibleHistoryCount = DEFAULT_VISIBLE_HISTORY_COUNT;
  let currentHistoryItems = [];
  let historyRenderJob = null;
  let pendingAccessSettings = null;
  let optimisticUserMessagesByThreadId = {};
  let optimisticUserRowsByThreadId = {};
  let queuedFollowUpsByThreadId = {};
  let persisted = vscode.getState() || {};
  let draftsByThreadId =
    persisted && typeof persisted === "object" && persisted.draftsByThreadId && typeof persisted.draftsByThreadId === "object"
      ? persisted.draftsByThreadId
      : {};
  let draftSaveTimer = null;
  let shikiStyleEl = null;
  let noticeSeq = 1;
  const cspNonce = (() => {
    try {
      const s = document.querySelector("script[nonce]");
      return s && s.nonce ? String(s.nonce) : "";
    } catch {
      return "";
    }
  })();
  const threadHistory = window.__NITORI_THREAD_HISTORY__ || {
    flattenThreadItems(thread) {
      const turns = Array.isArray(thread && thread.turns) ? thread.turns : [];
      const items = [];
      for (const turn of turns) {
        if (!turn || !Array.isArray(turn.items)) continue;
        for (const item of turn.items) items.push(item);
      }
      return items;
    },
    getHistorySignature(thread) {
      const items = this.flattenThreadItems(thread);
      if (!items.length) return "0";
      const last = items[items.length - 1];
      return `${items.length}:${String(last && last.type ? last.type : "")}:${String(last && last.id ? last.id : "")}`;
    },
    createHistoryWindow(items, count) {
      const safe = Array.isArray(items) ? items : [];
      const start = Math.max(0, safe.length - Math.max(0, Number(count) || 0));
      return { totalItems: safe.length, hiddenCount: start, items: safe.slice(start) };
    }
  };

  function flattenHistoryItems(thread) {
    if (threadHistory && typeof threadHistory.flattenThreadItems === "function") {
      try {
        const items = threadHistory.flattenThreadItems(thread);
        return Array.isArray(items) ? items : [];
      } catch (error) {
        console.warn("threadHistory.flattenThreadItems failed", error);
      }
    }

    const turns = Array.isArray(thread && thread.turns) ? thread.turns : [];
    const items = [];
    for (const turn of turns) {
      if (!turn || !Array.isArray(turn.items)) continue;
      for (const item of turn.items) items.push(item);
    }
    return items;
  }

  function getThreadHistorySignature(thread) {
    const items = flattenHistoryItems(thread);
    if (!items.length) return "0";
    let hash = 2166136261;
    function push(part) {
      const text = String(part || "");
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
    }
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const content = normalizeAssistantText(item.text || item.message || "");
      const aggregatedOutput = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
      const changes = Array.isArray(item.changes) ? item.changes.length : 0;
      push(item.id || "");
      push(item.type || "");
      push(item.status || "");
      push(content.length);
      push(aggregatedOutput.length);
      push(changes);
    }
    return `${items.length}:${hash >>> 0}`;
  }

  function createThreadHistoryWindow(items, count) {
    if (threadHistory && typeof threadHistory.createHistoryWindow === "function") {
      try {
        const windowed = threadHistory.createHistoryWindow(items, count);
        if (windowed && typeof windowed === "object") return windowed;
      } catch (error) {
        console.warn("threadHistory.createHistoryWindow failed", error);
      }
    }

    const safe = Array.isArray(items) ? items : [];
    const start = Math.max(0, safe.length - Math.max(0, Number(count) || 0));
    return { totalItems: safe.length, hiddenCount: start, items: safe.slice(start) };
  }

  function getRenderableTurns(thread) {
    if (threadHistory && typeof threadHistory.getRenderableTurns === "function") {
      try {
        const turns = threadHistory.getRenderableTurns(thread);
        return Array.isArray(turns) ? turns : [];
      } catch (error) {
        console.warn("threadHistory.getRenderableTurns failed", error);
      }
    }

    const items = flattenHistoryItems(thread);
    if (!items.length) return [];
    return [
      {
        preUserItems: [],
        userItems: [],
        agentItems: items,
        assistantItem: null,
        postAssistantItems: []
      }
    ];
  }
  const renderQueue = window.__NITORI_RENDER_QUEUE__ || {
    createRenderQueue(items, renderItem, options) {
      const list = Array.isArray(items) ? items.slice() : [];
      const chunkSize = Math.max(1, Number((options && options.chunkSize) || 24));
      let cancelled = false;
      return {
        start() {
          let index = 0;
          function run() {
            if (cancelled) return;
            const end = Math.min(index + chunkSize, list.length);
            while (index < end) {
              renderItem(list[index], index);
              index += 1;
            }
            if (index < list.length) {
              setTimeout(run, 16);
              return;
            }
            if (typeof options?.onDone === "function") options.onDone();
          }
          setTimeout(run, 0);
        },
        cancel() {
          cancelled = true;
        }
      };
    }
  };

  const localeMessages = {
    ja: {
      task: "タスク",
      taskPickerTitle: "タスク一覧",
      taskPickerButton: "タスクを開く",
      settings: "設定",
      searchTasks: "タスクを検索",
      close: "閉じる",
      taskSettingsTitle: "タスク",
      runSettingsTitle: "実行",
      projectInstructionsTitle: "プロジェクト指示",
      projectInstructionsHelp: "AGENTS.md には、リポジトリ全体で共有し commit したい恒久ルールを書きます。",
      baseInstructionsTitle: "Base Instructions",
      baseInstructionsHelp: "AGENTS.md の上に重ねる、ワークスペース向けの継続ルールを書きます。まだ repo に commit しない個人設定向けです。",
      sessionInstructionsTitle: "Session Instructions",
      sessionInstructionsHelp: "今回の作業だけに効かせたい追加指示を書きます。thread の start・resume・fork 時に developerInstructions として送ります。",
      modeInstructionsTitle: "組み込みモード",
      modeInstructionsHelp: "このビルドでは口調と人格は固定です。Collaboration Mode と Personality は変更できません。",
      saveBaseInstructions: "Base Instructions を保存",
      clearBaseInstructions: "Base Instructions をクリア",
      saveSessionInstructions: "Session Instructions を保存",
      clearSessionInstructions: "Session Instructions をクリア",
      saveModeSettings: "モード設定を保存",
      clearModeSettings: "モード設定をクリア",
      personaLockedHelp: "このビルドでは、にとり口調はロジックに固定されており変更できません。",
      personaLockedLabel: "固定口調",
      newThread: "新規タスク",
      forkThread: "タスクを Fork",
      rollbackTurn: "1ターン戻す",
      archiveThread: "タスクをアーカイブ",
      unarchiveThread: "タスクのアーカイブ解除",
      openAgents: "AGENTS.md を開く",
      createAgents: "AGENTS.md を作成",
      attachFiles: "ファイルを添付",
      typeMessage: "メッセージを入力",
      send: "送信",
      stop: "停止",
      toggleFullAccess: "フルアクセスを切り替え",
      toggleApproval: "承認ポリシーを切り替え",
      default: "デフォルト",
      fullAccess: "フルアクセス",
      approvalOn: "承認: あり",
      approvalOff: "承認: なし",
      openWorkspaceForAgents: "AGENTS.md を管理するにはワークスペースを開いてください。",
      usingInheritedAgents: "継承された AGENTS.md を使用中:",
      usingProjectAgents: "このプロジェクトの AGENTS.md を使用中:",
      noAgentsFound: "AGENTS.md が見つかりません。次の場所に作成できます:",
      openAgentsDisabled: "AGENTS.md が見つかりません",
      openWorkspaceFirst: "先にワークスペースを開いてください",
      taskArchiveConfirm: "このタスクをアーカイブしますか？",
      taskFallback: "タスク",
      taskFallbackUntitled: "無題タスク",
      taskSectionToday: "今日",
      taskSectionYesterday: "昨日",
      taskSectionEarlier: "それ以前",
      taskSectionUndated: "日付不明",
      pastMessages: "件の過去のメッセージ",
      finalMessage: "最終メッセージ",
      exploredSteps: "件の実装過程",
      thinking: "思考中",
      exploring: "調査中",
      planning: "計画中",
      editingFiles: "ファイル編集中",
      runningCommand: "コマンド実行中",
      noWorkspaceFolder: "(ワークスペースなし)",
      rate5h: "5時間",
      rateWeek: "週",
      rateRemaining: "残り",
      rateLoading: "取得中",
      modelLoading: "読み込み中...",
      effortDefault: "effort: デフォルト",
      approvalDefault: "approval: デフォルト",
      sandboxDefault: "sandbox: デフォルト",
      localeDefault: "表示言語",
      collaborationDefault: "collaboration: デフォルト",
      personalityDefault: "personality: デフォルト",
      uiLocaleJa: "日本語",
      uiLocaleEn: "English",
      personalityFriendly: "friendly",
      personalityPragmatic: "pragmatic",
      personalityNone: "none",
      effortTitle: "Reasoning effort",
      approvalTitle: "Approval policy",
      sandboxTitle: "Sandbox mode",
      localeTitle: "表示言語",
      collaborationTitle: "Collaboration Mode",
      personalityTitle: "Personality",
      baseInstructionsPlaceholder: "AGENTS.md の上に重ねる継続ルールを書きます。",
      sessionInstructionsPlaceholder: "今回の作業だけに効かせたい追加指示を書きます。"
    },
    en: {
      task: "Task",
      taskPickerTitle: "Tasks",
      taskPickerButton: "Open task picker",
      settings: "Settings",
      searchTasks: "Search tasks",
      close: "Close",
      taskSettingsTitle: "Task",
      runSettingsTitle: "Run",
      projectInstructionsTitle: "Project Instructions",
      projectInstructionsHelp: "Use AGENTS.md for repository rules that should be shared and committed with the project.",
      baseInstructionsTitle: "Base Instructions",
      baseInstructionsHelp: "Use this for durable workspace-level rules on top of AGENTS.md, especially personal rules that should not be committed yet.",
      sessionInstructionsTitle: "Session Instructions",
      sessionInstructionsHelp: "Use this for temporary guidance for the current task. It is sent as developerInstructions when a thread starts, resumes, or forks.",
      modeInstructionsTitle: "Built-in Modes",
      modeInstructionsHelp: "This build locks the assistant voice. Collaboration Mode and Personality cannot be changed.",
      saveBaseInstructions: "Save base instructions",
      clearBaseInstructions: "Clear base instructions",
      saveSessionInstructions: "Save session instructions",
      clearSessionInstructions: "Clear session instructions",
      saveModeSettings: "Save mode settings",
      clearModeSettings: "Clear mode settings",
      personaLockedHelp: "This build hard-locks the Nitori persona in logic, so these settings cannot be changed.",
      personaLockedLabel: "Locked persona",
      newThread: "New task",
      forkThread: "Fork task",
      rollbackTurn: "Rollback one turn",
      archiveThread: "Archive task",
      unarchiveThread: "Unarchive task",
      openAgents: "Open AGENTS.md",
      createAgents: "Create AGENTS.md",
      attachFiles: "Attach files",
      typeMessage: "Type a message",
      send: "Send",
      stop: "Stop",
      toggleFullAccess: "Toggle full access",
      toggleApproval: "Toggle approval policy",
      default: "Default",
      fullAccess: "Full access",
      approvalOn: "Approval: on",
      approvalOff: "Approval: off",
      openWorkspaceForAgents: "Open a workspace folder to manage AGENTS.md.",
      usingInheritedAgents: "Using inherited AGENTS.md:",
      usingProjectAgents: "Using project AGENTS.md:",
      noAgentsFound: "No AGENTS.md found. You can create one at:",
      openAgentsDisabled: "AGENTS.md not found",
      openWorkspaceFirst: "Open a workspace first",
      taskArchiveConfirm: "Archive this task?",
      taskFallback: "Task",
      taskFallbackUntitled: "Untitled task",
      taskSectionToday: "Today",
      taskSectionYesterday: "Yesterday",
      taskSectionEarlier: "Earlier",
      taskSectionUndated: "No date",
      pastMessages: "past messages",
      finalMessage: "Final message",
      exploredSteps: "process steps",
      thinking: "Thinking",
      exploring: "Exploring",
      planning: "Planning",
      editingFiles: "Editing files",
      runningCommand: "Running command",
      noWorkspaceFolder: "(no workspace folder)",
      rate5h: "5hour",
      rateWeek: "Weekly",
      rateRemaining: "remaining",
      rateLoading: "loading",
      modelLoading: "loading...",
      effortDefault: "effort: default",
      approvalDefault: "approval: default",
      sandboxDefault: "sandbox: default",
      localeDefault: "UI language",
      collaborationDefault: "collaboration: default",
      personalityDefault: "personality: default",
      uiLocaleJa: "Japanese",
      uiLocaleEn: "English",
      personalityFriendly: "friendly",
      personalityPragmatic: "pragmatic",
      personalityNone: "none",
      effortTitle: "Reasoning effort",
      approvalTitle: "Approval policy",
      sandboxTitle: "Sandbox mode",
      localeTitle: "UI language",
      collaborationTitle: "Collaboration Mode",
      personalityTitle: "Personality",
      baseInstructionsPlaceholder: "Set durable local rules that should apply on top of AGENTS.md.",
      sessionInstructionsPlaceholder: "Add temporary instructions on top of AGENTS.md."
    }
  };

  function t(key) {
    const dict = localeMessages[uiLocale] || localeMessages.ja;
    return dict[key] || localeMessages.ja[key] || key;
  }

  function setButtonLabel(el, label, title) {
    if (!el) return;
    const text = title || label;
    el.title = text;
    el.setAttribute("aria-label", text);
    if (el.textContent && !el.querySelector("svg")) el.textContent = label;
  }

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
    bindShikiCopyButtons(el);
  }

  function decodeBase64Utf8(value) {
    try {
      const binary = atob(String(value || ""));
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  }

  async function copyTextToClipboard(text) {
    const content = String(text || "");
    if (!content) return false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(content);
        return true;
      }
    } catch {
      // fallback below
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = content;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  function bindShikiCopyButtons(rootEl) {
    if (!rootEl || typeof rootEl.querySelectorAll !== "function") return;
    const buttons = rootEl.querySelectorAll(".shiki-copy-button");
    for (const button of buttons) {
      if (button.dataset.copyBound === "true") continue;
      button.dataset.copyBound = "true";
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const code = decodeBase64Utf8(button.dataset.codeB64 || "");
        const ok = await copyTextToClipboard(code);
        if (ok) {
          showUiNotice("コードをコピーした", { kind: "notice", ttlMs: 1800 });
          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = "Copy";
          }, 1200);
        } else {
          showUiNotice("コードのコピーに失敗", { kind: "error", ttlMs: 2600 });
        }
      });
    }
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
    showUiNotice(`添付が大きすぎる（最大 ${maxBytes} bytes）: ${file.name || "file"}`, { kind: "error", ttlMs: 4200 });
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
    showUiNotice(`添付の読み込みに失敗: ${file.name || "file"}`, { kind: "error", ttlMs: 4200 });
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
    autoResizeInput();
  }

  function setSettingsOpen(open) {
    if (!settingsPop) return;
    settingsPop.hidden = !open;
  }

  function isSettingsOpen() {
    return settingsPop && !settingsPop.hidden;
  }

  function setCurrentPage(page, options) {
    const nextPage = page === "chat" ? "chat" : "home";
    currentPage = nextPage;
    document.body.classList.toggle("is-home", nextPage === "home");
    document.body.classList.toggle("is-chat", nextPage === "chat");
    if (taskPop) taskPop.hidden = nextPage !== "home";
    if (chatPage) chatPage.hidden = nextPage !== "chat";
    const canReturnToChat = Boolean(state && state.threadId);
    if (taskClose) {
      taskClose.hidden = !canReturnToChat;
      taskClose.disabled = !canReturnToChat;
    }
    if (homeButton) {
      homeButton.hidden = nextPage !== "chat";
      homeButton.title = t("close");
      homeButton.setAttribute("aria-label", t("close"));
    }
    if (homeButtonIconUse) {
      homeButtonIconUse.setAttribute("href", "#ico-back");
    }
    if (nextPage === "home") {
      renderTaskPicker();
      if (!(options && options.skipFocus) && taskSearch) {
        taskSearch.value = taskQuery;
        taskSearch.focus();
        taskSearch.select();
      }
    }
    if (chatEmpty) chatEmpty.hidden = !(nextPage === "chat" && !(state && state.threadId));
    refreshHeaderCopy();
  }

  function refreshHeaderCopy() {
    if (!taskTitle) return;
    const tasks = Array.isArray(state && state.tasks) ? state.tasks : Array.isArray(state && state.threads) ? state.threads : [];
    const current = tasks.find((thread) => getThreadId(thread) === (state && state.threadId ? state.threadId : "")) || null;
    taskTitle.textContent = currentPage === "home" ? "Tasks" : current ? taskDisplayTitle(current) : t("taskFallback");
    if (!taskSubtitle) return;
    if (currentPage === "home") {
      taskSubtitle.textContent = showArchivedTasks ? "Recent + archived tasks" : "Recent tasks";
      return;
    }
    taskSubtitle.textContent = "";
  }

  function formatStatusText(statusValue, messageValue) {
    const base = String(statusValue || "ready").trim() || "ready";
    const extra = String(messageValue || "")
      .replace(/\bthread=[^\s]+/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return extra ? `${base}: ${extra}` : base;
  }

  function isTaskPickerOpen() {
    return currentPage === "home";
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

  function normalizeDeveloperInstructions(value) {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\r\n/g, "\n").trim();
    return normalized ? normalized : null;
  }

  function normalizeBaseInstructions(value) {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\r\n/g, "\n").trim();
    return normalized ? normalized : null;
  }

  function syncBaseInstructionsEditor(nextValue) {
    if (!baseInstructionsInput) return;
    if (document.activeElement === baseInstructionsInput) return;
    baseInstructionsInput.value = typeof nextValue === "string" ? nextValue : "";
  }

  function syncDeveloperInstructionsEditor(nextValue) {
    if (!developerInstructionsInput) return;
    if (document.activeElement === developerInstructionsInput) return;
    developerInstructionsInput.value = typeof nextValue === "string" ? nextValue : "";
  }

  function submitInstructionSettings(overrides) {
    if (personaSettingsLocked) return;
    const rawBaseValue =
      overrides && Object.prototype.hasOwnProperty.call(overrides, "baseInstructions")
        ? overrides.baseInstructions
        : baseInstructionsInput
          ? baseInstructionsInput.value
          : "";
    const rawDeveloperValue =
      overrides && Object.prototype.hasOwnProperty.call(overrides, "developerInstructions")
        ? overrides.developerInstructions
        : developerInstructionsInput
          ? developerInstructionsInput.value
          : "";
    const rawPersonality =
      overrides && Object.prototype.hasOwnProperty.call(overrides, "personality")
        ? overrides.personality
        : personalitySelect
          ? personalitySelect.value
          : "";
    const rawCollaborationMode =
      overrides && Object.prototype.hasOwnProperty.call(overrides, "collaborationMode")
        ? overrides.collaborationMode
        : collaborationModeSelect
          ? collaborationModeSelect.value
          : "";

    const baseInstructions = normalizeBaseInstructions(rawBaseValue);
    const developerInstructions = normalizeDeveloperInstructions(rawDeveloperValue);
    const personality = rawPersonality ? String(rawPersonality) : null;
    const collaborationMode = rawCollaborationMode ? String(rawCollaborationMode) : null;

    if (!state) state = { settings: {} };
    state.settings = Object.assign({}, state.settings || {}, {
      baseInstructions,
      developerInstructions,
      personality,
      collaborationMode
    });
    syncBaseInstructionsEditor(baseInstructions);
    syncDeveloperInstructionsEditor(developerInstructions);
    if (personalitySelect && document.activeElement !== personalitySelect) personalitySelect.value = personality || "";
    if (collaborationModeSelect && document.activeElement !== collaborationModeSelect) {
      collaborationModeSelect.value = collaborationMode || "";
    }
    vscode.postMessage({
      type: "setInstructionSettings",
      baseInstructions,
      developerInstructions,
      personality,
      collaborationMode
    });
  }

  function renderAgentsInstructionsState(s) {
    const agentsFile = s && s.agentsFile ? s.agentsFile : null;
    const exists = Boolean(agentsFile && agentsFile.exists);
    const resolvedPath = agentsFile && typeof agentsFile.resolvedPath === "string" ? agentsFile.resolvedPath : "";
    const workspacePath = agentsFile && typeof agentsFile.workspacePath === "string" ? agentsFile.workspacePath : "";
    const scope = agentsFile && typeof agentsFile.scope === "string" ? agentsFile.scope : "none";

    if (agentsInstructionsStatus) {
      if (!workspacePath) {
        agentsInstructionsStatus.textContent = t("openWorkspaceForAgents");
      } else if (exists) {
        const prefix = scope === "ancestor" ? t("usingInheritedAgents") : t("usingProjectAgents");
        agentsInstructionsStatus.textContent = `${prefix} ${resolvedPath}`;
      } else {
        agentsInstructionsStatus.textContent = `${t("noAgentsFound")} ${resolvedPath}`;
      }
    }

    if (openAgentsInstructionsBtn) {
      openAgentsInstructionsBtn.disabled = !exists;
      const title = exists ? t("openAgents") : t("openAgentsDisabled");
      openAgentsInstructionsBtn.title = title;
      openAgentsInstructionsBtn.setAttribute("aria-label", title);
    }

    if (createAgentsInstructionsBtn) {
      createAgentsInstructionsBtn.disabled = !workspacePath;
      const title = workspacePath ? t("createAgents") : t("openWorkspaceFirst");
      createAgentsInstructionsBtn.title = title;
      createAgentsInstructionsBtn.setAttribute("aria-label", title);
    }
  }

  function normalizeTimestamp(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n > 1_000_000_000_000 ? n : n * 1000;
  }

  function getTasks() {
    if (!state || typeof state !== "object") return [];
    const tasks = Array.isArray(state.tasks) ? state.tasks : null;
    if (tasks) return tasks;
    return Array.isArray(state.threads) ? state.threads : [];
  }

  function getThreadId(thread) {
    if (!thread || typeof thread !== "object") return "";
    const candidates = [thread.id, thread.threadId, thread.thread_id];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return "";
  }

  function getThreadPreview(thread) {
    if (!thread || typeof thread !== "object") return "";
    const candidates = [thread.preview, thread.title, thread.summary, thread.label];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.replace(/\s+/g, " ").trim();
    }
    return "";
  }

  function stripMarkdownLinks(text) {
    return String(text || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  }

  function extractTaskTitleFromPrompt(text) {
    const normalized = stripMarkdownLinks(String(text || "")).replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    const firstSentence = normalized.split(/(?<=[.!?。！？])\s+/)[0] || normalized;
    const compact = firstSentence.trim() || normalized;
    return compact.length > 80 ? compact.slice(0, 79).trimEnd() + "…" : compact;
  }

  function collectTextInputParts(value, out, seen) {
    if (value == null) return;
    if (typeof value === "string") {
      if (value.trim()) out.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) collectTextInputParts(entry, out, seen);
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    const type = String(value.type || "")
      .trim()
      .toLowerCase();
    if ((type === "text" || type === "input_text") && typeof value.text === "string" && value.text.trim()) {
      out.push(value.text);
    }
    if (typeof value.message === "string" && value.message.trim()) out.push(value.message);
    if (typeof value.content === "string" && value.content.trim()) out.push(value.content);
    collectTextInputParts(value.input, out, seen);
    collectTextInputParts(value.content, out, seen);
    collectTextInputParts(value.items, out, seen);
  }

  function getThreadPromptTitle(thread) {
    if (!thread || typeof thread !== "object") return "";
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    const firstTurn = turns[0];
    if (!firstTurn || typeof firstTurn !== "object") return "";
    const parts = [];
    const seen = new Set();
    collectTextInputParts(firstTurn.input, parts, seen);
    collectTextInputParts(firstTurn.inputMessage, parts, seen);
    collectTextInputParts(firstTurn.input_message, parts, seen);
    collectTextInputParts(firstTurn.userInput, parts, seen);
    collectTextInputParts(firstTurn.user_input, parts, seen);
    collectTextInputParts(firstTurn.content, parts, seen);
    const prompt = parts.join(" ").trim();
    return extractTaskTitleFromPrompt(prompt);
  }

  function getThreadCwd(thread) {
    if (!thread || typeof thread !== "object") return "";
    const candidates = [thread.cwd, thread.path, thread.workspacePath];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
    return "";
  }

  function getThreadRepoLabel(thread) {
    const cwd = getThreadCwd(thread);
    if (!cwd) return "";
    const parts = cwd.split(/[\\/]/).filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : cwd;
  }

  function getThreadUpdatedAt(thread) {
    if (!thread || typeof thread !== "object") return null;
    const candidates = [thread.updatedAt, thread.updated_at, thread.lastUpdatedAt, thread.last_updated_at];
    for (const candidate of candidates) {
      const normalized = normalizeTimestamp(candidate);
      if (normalized !== null) return normalized;
    }
    return null;
  }

  function taskDisplayTitle(thread) {
    const explicitTitle = stripMarkdownLinks(
      typeof (thread && (thread.title || thread.label)) === "string" ? String(thread.title || thread.label) : ""
    )
      .replace(/\s+/g, " ")
      .trim();
    const promptTitle = getThreadPromptTitle(thread);
    const preview = getThreadPreview(thread);
    return explicitTitle || promptTitle || preview || getThreadId(thread) || t("taskFallbackUntitled");
  }

  function compareThreadsByUpdatedAtDesc(left, right) {
    const leftUpdatedAt = getThreadUpdatedAt(left) || 0;
    const rightUpdatedAt = getThreadUpdatedAt(right) || 0;
    if (leftUpdatedAt !== rightUpdatedAt) return rightUpdatedAt - leftUpdatedAt;
    return taskDisplayTitle(left).localeCompare(taskDisplayTitle(right), undefined, { sensitivity: "base" });
  }

  function buildTaskSearchCandidate(thread) {
    const title = taskDisplayTitle(thread);
    const cwd = getThreadCwd(thread);
    const preview = getThreadPreview(thread);
    const repoLabel = getThreadRepoLabel(thread) || cwd;
    return {
      thread,
      title,
      cwd,
      preview,
      repoLabel,
      updatedAt: getThreadUpdatedAt(thread) || 0,
      normalizedTitle: title.toLocaleLowerCase(),
      normalizedRepoLabel: String(repoLabel || "").toLocaleLowerCase(),
      normalizedCwd: String(cwd || "").toLocaleLowerCase(),
      normalizedPreview: String(preview || "").toLocaleLowerCase(),
      normalizedSearchText: [title, repoLabel, cwd, preview].join(" ").toLocaleLowerCase()
    };
  }

  function getTaskSearchTokens(query) {
    return String(query || "")
      .toLocaleLowerCase()
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
  }

  function getTokenMatch(value, token) {
    if (!value || !token) return null;
    if (value === token) return { matchKind: 0, gapCount: 0, startIndex: 0 };
    if (value.startsWith(token)) return { matchKind: 1, gapCount: 0, startIndex: 0 };
    const substringIndex = value.indexOf(token);
    if (substringIndex !== -1) return { matchKind: 2, gapCount: 0, startIndex: substringIndex };

    let valueIndex = 0;
    let startIndex = -1;
    let previousMatchIndex = -1;
    let gapCount = 0;
    for (const character of token) {
      const nextIndex = value.indexOf(character, valueIndex);
      if (nextIndex === -1) return null;
      if (startIndex === -1) startIndex = nextIndex;
      if (previousMatchIndex !== -1) gapCount += nextIndex - previousMatchIndex - 1;
      previousMatchIndex = nextIndex;
      valueIndex = nextIndex + 1;
    }
    return { matchKind: 3, gapCount, startIndex };
  }

  function getFieldMatch(value, searchTokens, fieldPriority) {
    if (!value || searchTokens.length === 0) return null;
    let worstMatchKind = 0;
    let totalGapCount = 0;
    let firstStartIndex = Number.POSITIVE_INFINITY;

    for (const token of searchTokens) {
      const match = getTokenMatch(value, token);
      if (!match) return null;
      worstMatchKind = Math.max(worstMatchKind, match.matchKind);
      totalGapCount += match.gapCount;
      firstStartIndex = Math.min(firstStartIndex, match.startIndex);
    }

    return {
      fieldPriority,
      matchKind: worstMatchKind,
      gapCount: totalGapCount,
      startIndex: firstStartIndex
    };
  }

  function compareTaskSearchMatch(left, right) {
    const fieldPriorityDiff = left.fieldPriority - right.fieldPriority;
    if (fieldPriorityDiff !== 0) return fieldPriorityDiff;
    const matchKindDiff = left.matchKind - right.matchKind;
    if (matchKindDiff !== 0) return matchKindDiff;
    const gapCountDiff = left.gapCount - right.gapCount;
    if (gapCountDiff !== 0) return gapCountDiff;
    return left.startIndex - right.startIndex;
  }

  function rankThreadsForTaskQuery(threads, query) {
    const searchTokens = getTaskSearchTokens(query);
    if (searchTokens.length === 0) return Array.isArray(threads) ? threads.slice().sort(compareThreadsByUpdatedAtDesc) : [];

    return (Array.isArray(threads) ? threads : [])
      .map((thread) => buildTaskSearchCandidate(thread))
      .map((candidate) => {
        const fields = [
          candidate.normalizedTitle,
          candidate.normalizedRepoLabel,
          candidate.normalizedCwd,
          candidate.normalizedPreview,
          candidate.normalizedSearchText
        ];
        let bestMatch = null;
        for (let index = 0; index < fields.length; index += 1) {
          const match = getFieldMatch(fields[index], searchTokens, index);
          if (!match) continue;
          if (!bestMatch || compareTaskSearchMatch(match, bestMatch) < 0) bestMatch = match;
        }
        return { candidate, match: bestMatch };
      })
      .filter((entry) => entry.match)
      .sort((left, right) => {
        const matchDiff = compareTaskSearchMatch(left.match, right.match);
        if (matchDiff !== 0) return matchDiff;
        return right.candidate.updatedAt - left.candidate.updatedAt;
      })
      .map((entry) => entry.candidate.thread);
  }

  function taskSectionKey(updatedAt) {
    if (!updatedAt) return "undated";
    const date = new Date(updatedAt);
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startOfTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const dayDiff = Math.round((startOfToday - startOfTarget) / 86400000);
    if (dayDiff <= 0) return "today";
    if (dayDiff === 1) return "yesterday";
    return "earlier";
  }

  function taskSectionLabel(sectionKey) {
    switch (sectionKey) {
      case "today":
        return t("taskSectionToday");
      case "yesterday":
        return t("taskSectionYesterday");
      case "earlier":
        return t("taskSectionEarlier");
      default:
        return t("taskSectionUndated");
    }
  }

  function renderTaskPicker() {
    if (!taskList || !state) return;
    taskList.textContent = "";

    const q = String(taskQuery || "").trim();
    const tasks = getTasks()
      .filter((thread) => showArchivedTasks || !Boolean(thread && thread.archived))
      .slice()
      .sort(compareThreadsByUpdatedAtDesc);
    const filtered = rankThreadsForTaskQuery(tasks, q);
    if (homeStats) {
      const allTasks = getTasks();
      const archivedCount = allTasks.filter((thread) => Boolean(thread && thread.archived)).length;
      const activeCount = Math.max(0, allTasks.length - archivedCount);
      homeStats.textContent = `${activeCount} active · ${archivedCount} archived`;
    }
    const isSearchMode = q.length > 0;

    function renderTaskRow(thread) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "task-item";
        if (state.threadId && getThreadId(thread) === state.threadId) btn.classList.add("is-active");
        btn.title = taskDisplayTitle(thread);

        const left = document.createElement("div");
        left.className = "task-item-main";

        const title = document.createElement("div");
        title.className = "task-item-title";
        title.textContent = taskDisplayTitle(thread);

        const sub = document.createElement("div");
        sub.className = "task-item-sub";
        const repoLabel = getThreadRepoLabel(thread);
        const cwd = getThreadCwd(thread);
        sub.textContent = repoLabel && cwd && repoLabel !== cwd ? `${repoLabel} · ${cwd}` : repoLabel || cwd;
        if (cwd) sub.title = cwd;

        left.appendChild(title);
        left.appendChild(sub);

        const time = document.createElement("div");
        time.className = "task-item-time";
        const updatedAt = getThreadUpdatedAt(thread);
        time.textContent = updatedAt ? relTime(updatedAt) : "";

        const right = document.createElement("div");
        right.className = "task-item-side";
        if (state.threadId && getThreadId(thread) === state.threadId) {
          const marker = document.createElement("div");
          marker.className = "task-item-active";
          marker.textContent = "OPEN";
          right.appendChild(marker);
        }
        right.appendChild(time);

        btn.appendChild(left);
        btn.appendChild(right);

        btn.addEventListener("click", () => {
          const threadId = getThreadId(thread);
          if (!threadId) return;
          vscode.postMessage({ type: "resumeThread", threadId });
          setCurrentPage("chat", { skipFocus: true });
        });

        taskList.appendChild(btn);
    }

    for (const thread of filtered) renderTaskRow(thread);
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

  function activeThreadId() {
    return state && state.threadId ? String(state.threadId) : "";
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
      send.title = isBusy ? t("stop") : t("send");
      send.setAttribute("aria-label", isBusy ? t("stop") : t("send"));
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
    const currentTurn = getCurrentRenderableTurn();

    let kind = currentTurn && currentTurn.progressIndicator ? String(currentTurn.progressIndicator) : "thinking";
    let kindLabel =
      kind === "exploring" ? t("exploring") : kind === "planning" ? t("planning") : t("thinking");
    let detailText = "";

    if (kind === "none") {
      activityIndicator.hidden = true;
      activityIndicator.classList.remove("is-active");
      lastActivityKey = "";
      return;
    }

    if (activeFileChange && kind !== "exploring" && kind !== "planning") {
      kind = "file";
      kindLabel = t("editingFiles");
    } else if (activeCommand && kind !== "exploring" && kind !== "planning") {
      kind = "command";
      kindLabel = t("runningCommand");
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
    if (activityCwd) activityCwd.textContent = cwd || t("noWorkspaceFolder");
    if (activityDetail) activityDetail.textContent = detailText ? ` · ${detailText}` : "";
  }

  function addRowFromTemplate(tpl) {
    const frag = tpl.content.cloneNode(true);
    const row = frag.firstElementChild;
    chat.appendChild(frag);
    scrollToBottom();
    return row;
  }

  function findPendingAssistantAnchor() {
    const pendingBubble = chat.querySelector(".row-assistant .bubble.pending");
    return pendingBubble && pendingBubble.closest ? pendingBubble.closest(".row") : null;
  }

  function insertRowFromTemplateBeforePendingAssistant(tpl) {
    const anchor = findPendingAssistantAnchor();
    if (!anchor) return addRowFromTemplate(tpl);
    const frag = tpl.content.cloneNode(true);
    const row = frag.firstElementChild;
    chat.insertBefore(frag, anchor);
    scrollToBottom();
    return row;
  }

  function addUserMessage(text) {
    const row = addRowFromTemplate(tplUser);
    const options = arguments.length >= 3 && arguments[2] && typeof arguments[2] === "object" ? arguments[2] : null;
    const bubble = row.querySelector(".bubble");
    bubble.textContent = "";
    if (options && options.optimistic && row && row.dataset) row.dataset.optimistic = "true";

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

    return row;
  }

  function normalizeAttachmentRef(att) {
    if (!att || typeof att !== "object") return "";
    if (typeof att.path === "string" && att.path) return `path:${att.path}`;
    if (typeof att.url === "string" && att.url) return `url:${att.url}`;
    return "";
  }

  function normalizeAttachmentRefs(list) {
    if (!Array.isArray(list)) return [];
    return list.map((att) => normalizeAttachmentRef(att)).filter(Boolean);
  }

  function getOptimisticUserMessages(threadId) {
    const activeThreadId = String(threadId || "");
    if (!activeThreadId) return [];
    const entries = optimisticUserMessagesByThreadId[activeThreadId];
    return Array.isArray(entries) ? entries : [];
  }

  function setOptimisticUserMessages(threadId, entries) {
    const activeThreadId = String(threadId || "");
    if (!activeThreadId) return;
    if (!Array.isArray(entries) || entries.length === 0) {
      delete optimisticUserMessagesByThreadId[activeThreadId];
      return;
    }
    optimisticUserMessagesByThreadId[activeThreadId] = entries;
  }

  function getOptimisticUserRows(threadId) {
    const activeThreadId = String(threadId || "");
    if (!activeThreadId) return [];
    const entries = optimisticUserRowsByThreadId[activeThreadId];
    return Array.isArray(entries) ? entries : [];
  }

  function setOptimisticUserRows(threadId, entries) {
    const activeThreadId = String(threadId || "");
    if (!activeThreadId) return;
    if (!Array.isArray(entries) || entries.length === 0) {
      delete optimisticUserRowsByThreadId[activeThreadId];
      return;
    }
    optimisticUserRowsByThreadId[activeThreadId] = entries;
  }

  function addOptimisticUserMessage(threadId, text, attachments) {
    const activeThreadId = String(threadId || "");
    if (!activeThreadId) return;
    const nextEntries = getOptimisticUserMessages(activeThreadId).concat([
      {
        threadId: activeThreadId,
        text: String(text || ""),
        attachments: Array.isArray(attachments) ? attachments.slice() : []
      }
    ]);
    setOptimisticUserMessages(activeThreadId, nextEntries);
  }

  function sameOptimisticUserMessage(left, right) {
    if (!left || !right) return false;
    if (String(left.text || "") !== String(right.text || "")) return false;
    const leftAtts = normalizeAttachmentRefs(left.attachments);
    const rightAtts = normalizeAttachmentRefs(right.attachments);
    if (leftAtts.length !== rightAtts.length) return false;
    for (let i = 0; i < leftAtts.length; i++) {
      if (leftAtts[i] !== rightAtts[i]) return false;
    }
    return true;
  }

  function reconcileOptimisticUserMessages(threadId, items) {
    const activeThreadId = String(threadId || "");
    const optimisticEntries = getOptimisticUserMessages(activeThreadId);
    if (!activeThreadId) return;

    const seenUserMessages = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || item.type !== "userMessage") continue;
      const parsed = parseUserContent(item.content);
      seenUserMessages.push({ text: parsed.text, attachments: parsed.attachments });
    }

    const remainingEntries = optimisticEntries.filter((entry) => {
      const matchIndex = seenUserMessages.findIndex((candidate) => sameOptimisticUserMessage(entry, candidate));
      if (matchIndex < 0) return true;
      seenUserMessages.splice(matchIndex, 1);
      return false;
    });
    setOptimisticUserMessages(activeThreadId, remainingEntries);

    const optimisticRows = getOptimisticUserRows(activeThreadId);
    if (optimisticRows.length === 0) return;

    const unmatchedCanonical = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || item.type !== "userMessage") continue;
      const parsed = parseUserContent(item.content);
      unmatchedCanonical.push({ text: parsed.text, attachments: parsed.attachments });
    }

    const remainingRows = optimisticRows.filter((entry) => {
      const matchIndex = unmatchedCanonical.findIndex((candidate) => sameOptimisticUserMessage(entry, candidate));
      if (matchIndex < 0) return true;
      unmatchedCanonical.splice(matchIndex, 1);
      if (entry.row && entry.row.remove) entry.row.remove();
      return false;
    });
    setOptimisticUserRows(activeThreadId, remainingRows);
  }

  function renderOptimisticUserMessages(threadId) {
    const activeThreadId = String(threadId || "");
    if (!activeThreadId) return;
    for (const entry of getOptimisticUserMessages(activeThreadId)) {
      const row = addUserMessage(entry.text, entry.attachments, { optimistic: true });
      const nextRows = getOptimisticUserRows(activeThreadId).concat([
        { text: entry.text, attachments: entry.attachments, row }
      ]);
      setOptimisticUserRows(activeThreadId, nextRows);
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
    const row = insertRowFromTemplateBeforePendingAssistant(tplSystem);
    renderTextWithLinks(row.querySelector(".bubble"), text);
  }

  function showUiNotice(text, options) {
    if (!noticeStack || !text) return;
    const opts = options && typeof options === "object" ? options : {};
    const notice = document.createElement("div");
    notice.className = "notice";
    const kind = String(opts.kind || "notice");
    notice.dataset.kind = kind;
    notice.dataset.noticeId = String(noticeSeq++);
    const label = document.createElement("div");
    label.className = "notice-text";
    label.textContent = String(text);
    notice.appendChild(label);
    noticeStack.appendChild(notice);

    requestAnimationFrame(() => {
      notice.classList.add("is-visible");
    });

    const ttl = Number.isFinite(Number(opts.ttlMs)) ? Number(opts.ttlMs) : kind === "error" ? 5200 : 2600;
    const close = () => {
      notice.classList.remove("is-visible");
      notice.classList.add("is-leaving");
      setTimeout(() => {
        if (notice.parentNode) notice.parentNode.removeChild(notice);
      }, 180);
    };
    setTimeout(close, Math.max(800, ttl));
  }

  function clampPreview(s, maxLen) {
    const t = String(s || "").replace(/\s+/g, " ").trim();
    if (t.length <= maxLen) return t;
    return t.slice(0, maxLen - 1) + "…";
  }

  function ensureSystemRow(itemId) {
    let row = systemByItemId.get(itemId);
    if (!row) {
      row = insertRowFromTemplateBeforePendingAssistant(tplSystem);
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

    const row = insertRowFromTemplateBeforePendingAssistant(tplSystem);
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
    if (historyRenderJob) {
      historyRenderJob.cancel();
      historyRenderJob = null;
    }
    assistantByItemId.clear();
    assistantHtmlByItemId.clear();
    systemByItemId.clear();
    systemKindByItemId.clear();
    commandUIByItemId.clear();
    openCommandGroup = null;
    currentHistoryItems = [];
    liveAssistantRow = null;
    optimisticUserRowsByThreadId = {};
    chat.textContent = "";
  }

  function addHistoryLoadMoreRow(hiddenCount) {
    const row = addRowFromTemplate(tplSystem);
    const bubble = row.querySelector(".bubble");
    bubble.textContent = "";
    bubble.classList.add("muted");

    const btn = document.createElement("button");
    btn.className = "meta-btn";
    btn.type = "button";
    btn.textContent = `${hiddenCount} older items`;
    btn.onclick = () => {
      visibleHistoryCount = Math.min(Number.MAX_SAFE_INTEGER, visibleHistoryCount + 120);
      renderThread(state && state.thread ? state.thread : null);
    };

    bubble.appendChild(btn);
  }

  function renderThreadItem(item) {
    if (!item || typeof item !== "object") return;
    if (item.type === "userMessage") {
      closeCommandGroup();
      const parsed = parseUserContent(item.content);
      addUserMessage(parsed.text, parsed.attachments);
      return;
    }
    if (item.type === "agentMessage") {
      closeCommandGroup();
      const itemId = typeof item.id === "string" ? item.id : "";
      const row = itemId ? ensureAssistantRow(itemId) : addRowFromTemplate(tplAssistant);
      const bubble = row.querySelector(".bubble");
      const renderedHtml =
        item.html && typeof item.html === "string"
          ? item.html
          : itemId && assistantHtmlByItemId.has(itemId)
            ? assistantHtmlByItemId.get(itemId)
            : "";
      if (renderedHtml && typeof renderedHtml === "string") renderHtmlInto(bubble, renderedHtml);
      else renderTextWithLinks(bubble, normalizeAssistantText(item.text || ""));
      return;
    }
    if (item.type === "plan") {
      closeCommandGroup();
      addSystemMessage("plan:\n" + (item.text || ""));
      return;
    }
    if (item.type === "reasoning") {
      closeCommandGroup();
      const s = Array.isArray(item.summary) ? item.summary.join("\n") : "";
      addSystemMessage("reasoning summary:\n" + s);
      return;
    }
    if (item.type === "commandExecution") {
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
      return;
    }
    if (item.type === "fileChange") {
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
      return;
    }
    if (item.type === "webSearch") {
      closeCommandGroup();
      addSystemMessage("web search:\n" + (item.query || ""));
      return;
    }
    closeCommandGroup();
    addSystemMessage("item: " + item.type);
  }

  function countRenderableAgentMessages(entries) {
    let count = 0;
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.kind === "exploration") {
        count += Array.isArray(entry.items) ? entry.items.length : 0;
        continue;
      }
      if (entry.kind === "item" && entry.item) count += 1;
    }
    return count;
  }

  function renderTurnGroup(group) {
    if (!group || typeof group !== "object") return;
    const sections = [group.preUserItems, group.userItems];
    for (const section of sections) {
      if (!Array.isArray(section)) continue;
      for (const item of section) {
        renderThreadItem(item);
      }
    }

    const agentBodyState = renderAgentBodySection(group);

    if (group.assistantItem && agentBodyState && agentBodyState.showDivider) {
      const dividerRow = addFinalMessageDivider(Boolean(agentBodyState.isCollapsed));
      if (agentBodyState.detailsEl && dividerRow) {
        agentBodyState.detailsEl.addEventListener("toggle", () => {
          dividerRow.hidden = !agentBodyState.detailsEl.open;
        });
      }
    }

    if (group.assistantItem) {
      renderThreadItem(group.assistantItem);
    }

    if (Array.isArray(group.postAssistantItems)) {
      for (const item of group.postAssistantItems) {
        renderThreadItem(item);
      }
    }
  }

  function getCurrentRenderableTurn() {
    const thread = state && state.thread ? state.thread : null;
    if (!thread) return null;
    const renderableTurns = getRenderableTurns(thread);
    if (!Array.isArray(renderableTurns) || renderableTurns.length === 0) return null;
    for (let index = renderableTurns.length - 1; index >= 0; index -= 1) {
      const turn = renderableTurns[index];
      if (turn && String(turn.status || "") === "in_progress") return turn;
    }
    return renderableTurns[renderableTurns.length - 1] || null;
  }

  function createInlineItemContainer(target) {
    const row = document.createElement("div");
    row.className = "inline-item";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    row.appendChild(bubble);
    target.appendChild(row);
    return { row, bubble };
  }

  function renderAgentItemInto(target, item) {
    if (!target || !item || typeof item !== "object") return;
    if (item.type === "agentMessage") {
      const { bubble } = createInlineItemContainer(target);
      bubble.classList.add("assistant");
      const itemId = typeof item.id === "string" ? item.id : "";
      const renderedHtml =
        item.html && typeof item.html === "string"
          ? item.html
          : itemId && assistantHtmlByItemId.has(itemId)
            ? assistantHtmlByItemId.get(itemId)
            : "";
      if (renderedHtml && typeof renderedHtml === "string") renderHtmlInto(bubble, renderedHtml);
      else renderTextWithLinks(bubble, normalizeAssistantText(item.text || ""));
      return;
    }
    if (item.type === "commandExecution") {
      const wrap = document.createElement("div");
      wrap.className = "inline-tool-card";
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
      preview.textContent = clampPreview(item.command || "", 80);
      left.appendChild(title);
      left.appendChild(preview);
      const right = document.createElement("div");
      right.className = "fold-right";
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = String(item.status || "");
      right.appendChild(badge);
      summary.appendChild(left);
      summary.appendChild(right);
      const pre = document.createElement("pre");
      pre.className = "codeblock";
      const out = item.aggregatedOutput || "";
      renderTextWithLinks(pre, out ? `$ ${String(item.command || "").trim()}\n\n${out}` : `$ ${String(item.command || "").trim()}`);
      details.appendChild(summary);
      details.appendChild(pre);
      wrap.appendChild(details);
      target.appendChild(wrap);
      return;
    }
    if (item.type === "fileChange") {
      const wrap = document.createElement("div");
      wrap.className = "inline-tool-card";
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
      const changes = Array.isArray(item.changes) ? item.changes : [];
      sub.textContent = `${changes.length} files`;
      left.appendChild(title);
      left.appendChild(sub);
      const right = document.createElement("div");
      right.className = "fold-right";
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = String(changes.length);
      right.appendChild(badge);
      summary.appendChild(left);
      summary.appendChild(right);
      const body = document.createElement("div");
      body.className = "fold-body";
      renderFileChangesInto(
        body,
        changes.map((c) => ({
          kind: String(c && c.kind ? c.kind : ""),
          path: String(c && c.path ? c.path : ""),
          diff: String(c && c.diff ? c.diff : "")
        }))
      );
      details.appendChild(summary);
      details.appendChild(body);
      wrap.appendChild(details);
      target.appendChild(wrap);
      return;
    }
    if (item.type === "reasoning") {
      return;
    }
    if (item.type === "plan") {
      const { bubble } = createInlineItemContainer(target);
      bubble.classList.add("system");
      renderTextWithLinks(bubble, "plan:\n" + (item.text || ""));
      return;
    }
    if (item.type === "webSearch") {
      const { bubble } = createInlineItemContainer(target);
      bubble.classList.add("system");
      renderTextWithLinks(bubble, "web search:\n" + (item.query || ""));
      return;
    }
    const { bubble } = createInlineItemContainer(target);
    bubble.classList.add("system");
    renderTextWithLinks(bubble, "item: " + item.type);
  }

  function renderExplorationEntryInto(target, entry) {
    const wrap = document.createElement("div");
    wrap.className = "inline-tool-card exploration-card";
    const details = document.createElement("details");
    details.className = "fold plain exploration-fold";
    details.open = false;

    const summary = document.createElement("summary");
    summary.className = "fold-summary fold-summary-compact";

    const left = document.createElement("div");
    left.className = "fold-left";
    const title = document.createElement("div");
    title.className = "fold-title";
    title.textContent = entry.status === "exploring" ? t("thinking") : `${entry.items.length} ${t("exploredSteps")}`;
    left.appendChild(title);

    const right = document.createElement("div");
    right.className = "fold-right";
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = String(Array.isArray(entry.items) ? entry.items.length : 0);
    right.appendChild(badge);

    summary.appendChild(left);
    summary.appendChild(right);

    const body = document.createElement("div");
    body.className = "fold-body agent-body-content";
    for (const item of Array.isArray(entry.items) ? entry.items : []) {
      renderAgentItemInto(body, item);
    }

    details.appendChild(summary);
    details.appendChild(body);
    wrap.appendChild(details);
    target.appendChild(wrap);
  }

  function addAgentBodyFold(entries, collapsed, workedForTimeLabel) {
    const row = insertRowFromTemplateBeforePendingAssistant(tplSystem);
    row.classList.add("row-agent-body");
    const bubble = row.querySelector(".bubble");
    bubble.textContent = "";
    bubble.classList.add("agent-body-bubble");

    const details = document.createElement("details");
    details.className = "fold plain fold-agent-body";
    details.open = !collapsed;

    const summary = document.createElement("summary");
    summary.className = "fold-summary fold-summary-compact";

    const left = document.createElement("div");
    left.className = "fold-left";
    const title = document.createElement("div");
    title.className = "fold-title";
    title.textContent = workedForTimeLabel || `${countRenderableAgentMessages(entries)} ${t("pastMessages")}`;
    left.appendChild(title);
    summary.appendChild(left);

    const body = document.createElement("div");
    body.className = "fold-body agent-body-content";

    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry || typeof entry !== "object") continue;
      if (entry.kind === "exploration") {
        renderExplorationEntryInto(body, entry);
        continue;
      }
      if (entry.kind === "item" && entry.item) renderAgentItemInto(body, entry.item);
    }

    details.appendChild(summary);
    details.appendChild(body);
    bubble.appendChild(details);
    return { row, details };
  }

  function addFinalMessageDivider(hidden) {
    const row = addRowFromTemplate(tplSystem);
    row.classList.add("row-final-divider");
    row.hidden = Boolean(hidden);
    const bubble = row.querySelector(".bubble");
    bubble.textContent = "";
    bubble.classList.add("final-divider-bubble");
    const label = document.createElement("div");
    label.className = "final-divider-label";
    label.textContent = t("finalMessage");
    bubble.appendChild(label);
  }

  function renderAgentBodySection(group) {
    const agentEntries = Array.isArray(group && group.renderableAgentEntries) ? group.renderableAgentEntries : [];
    if (agentEntries.length === 0) return null;
    const status = String(group && group.status ? group.status : "");
    const shouldAllowCollapse = status !== "in_progress" && status !== "cancelled";
    const isCollapsed = shouldAllowCollapse;
    const fold = addAgentBodyFold(agentEntries, isCollapsed, group && group.workedForTimeLabel ? String(group.workedForTimeLabel) : "");
    return {
      detailsEl: fold && fold.details ? fold.details : null,
      isCollapsed,
      showDivider: Boolean(group.assistantItem && shouldAllowCollapse)
    };
  }

  function toUserText(content) {
    const parsed = parseUserContent(content);
    return parsed.text;
  }

  function parseUserContent(content) {
    const textParts = [];
    const atts = [];
    const seen = new Set();

    function visit(value) {
      if (value == null) return;
      if (typeof value === "string") {
        if (value.trim()) textParts.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry);
        return;
      }
      if (typeof value !== "object") return;
      if (seen.has(value)) return;
      seen.add(value);

      const t = String(value.type || "")
        .trim()
        .toLowerCase();
      if ((t === "text" || t === "input_text") && typeof value.text === "string") {
        textParts.push(value.text);
        return;
      }
      if (t === "mention") {
        if (typeof value.path === "string" && value.path) {
          atts.push({ path: value.path, name: typeof value.name === "string" ? value.name : baseName(value.path) });
          return;
        }
        if (typeof value.name === "string" && value.name) {
          textParts.push("@" + value.name);
          return;
        }
      }
      if ((t === "localimage" || t === "local_image") && typeof value.path === "string") {
        atts.push({ path: value.path, name: baseName(value.path) });
        return;
      }
      if ((t === "image" || t === "input_image" || t === "inputimage") && (typeof value.url === "string" || typeof value.image_url === "string")) {
        const url = typeof value.url === "string" ? value.url : value.image_url;
        atts.push({ url, name: "image" });
        return;
      }
      if (typeof value.text === "string" && value.text.trim()) {
        textParts.push(value.text);
      }
      if (typeof value.message === "string" && value.message.trim()) {
        textParts.push(value.message);
      }
      if (typeof value.content === "string" && value.content.trim()) {
        textParts.push(value.content);
      }
      visit(value.content);
      visit(value.contentItems);
      visit(value.content_items);
      visit(value.input);
      visit(value.inputItems);
      visit(value.input_items);
    }

    visit(content);
    return { text: textParts.join("\n"), attachments: atts };
  }

  function renderThread(thread) {
    if (!thread) return;
    clearChat();

    const renderableTurns = getRenderableTurns(thread);
    currentHistoryItems = flattenHistoryItems(thread);
    reconcileOptimisticUserMessages(thread && thread.id ? thread.id : state && state.threadId ? state.threadId : "", currentHistoryItems);
    const historyWindow = createThreadHistoryWindow(currentHistoryItems, visibleHistoryCount);
    if (historyWindow.hiddenCount > 0) addHistoryLoadMoreRow(historyWindow.hiddenCount);
    const shouldStickBottom = Math.abs(chat.scrollHeight - chat.scrollTop - chat.clientHeight) < 24;
    historyRenderJob = renderQueue.createRenderQueue(renderableTurns, (turn) => {
      renderTurnGroup(turn);
    }, {
      chunkSize: 8,
      onDone() {
        historyRenderJob = null;
        renderOptimisticUserMessages(thread && thread.id ? thread.id : state && state.threadId ? state.threadId : "");
        if (liveAssistantPreview && serverBusy) renderLiveAssistantPreview();
        if (shouldStickBottom) scrollToBottom();
      }
    });
    historyRenderJob.start();
  }

  function historyItemStableKey(item, index) {
    if (!item || typeof item !== "object") return `unknown:${index}`;
    const type = String(item.type || "");
    const id = typeof item.id === "string" && item.id ? item.id : "";
    if (id) return `${type}:${id}`;
    if (type === "userMessage") {
      const parsed = parseUserContent(item.content);
      return `${type}:${index}:${parsed.text}:${normalizeAttachmentRefs(parsed.attachments).join("|")}`;
    }
    return `${type}:${index}`;
  }

  function canIncrementallySyncHistory(nextItems) {
    if (visibleHistoryCount !== DEFAULT_VISIBLE_HISTORY_COUNT) return false;
    const prevItems = Array.isArray(currentHistoryItems) ? currentHistoryItems : [];
    const nextList = Array.isArray(nextItems) ? nextItems : [];
    if (prevItems.length === 0 || nextList.length < prevItems.length) return false;
    for (let i = 0; i < prevItems.length; i += 1) {
      if (historyItemStableKey(prevItems[i], i) !== historyItemStableKey(nextList[i], i)) return false;
    }
    return true;
  }

  function syncThreadIncrementally(thread, nextItems) {
    const nextList = Array.isArray(nextItems) ? nextItems : [];
    const activeThreadId = thread && thread.id ? thread.id : state && state.threadId ? state.threadId : "";
    reconcileOptimisticUserMessages(activeThreadId, nextList);

    const prevLength = Array.isArray(currentHistoryItems) ? currentHistoryItems.length : 0;
    const sharedLength = Math.min(prevLength, nextList.length);

    for (let i = 0; i < sharedLength; i += 1) {
      const item = nextList[i];
      if (!item || typeof item !== "object") continue;
      if (item.type === "agentMessage" || item.type === "commandExecution" || item.type === "fileChange") {
        renderThreadItem(item);
      }
    }

    for (let i = prevLength; i < nextList.length; i += 1) {
      const item = nextList[i];
      if (!item || typeof item !== "object") continue;
      if (item.type === "userMessage") continue;
      renderThreadItem(item);
    }

    currentHistoryItems = nextList;
    if (liveAssistantPreview && serverBusy) renderLiveAssistantPreview();
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

  function clearLiveAssistantRow() {
    if (liveAssistantRow) {
      const bubble = liveAssistantRow.querySelector ? liveAssistantRow.querySelector(".bubble") : null;
      if (bubble && bubble.classList) bubble.classList.remove("pending");
    }
    liveAssistantRow = null;
  }

  function renderLiveAssistantPreview() {
    if (!liveAssistantPreview || !chat) return;
    const itemId = String(liveAssistantPreview.itemId || "");
    const sameItem =
      liveAssistantRow &&
      liveAssistantRow.dataset &&
      liveAssistantRow.dataset.itemId === itemId;
    const row = sameItem ? liveAssistantRow : ensureAssistantRow(itemId);
    if (row && row.dataset) row.dataset.itemId = itemId;
    const bubble = row.querySelector(".bubble");
    if (liveAssistantPreview.pending) bubble.classList.add("pending");
    else bubble.classList.remove("pending");
    if (liveAssistantPreview.html) renderHtmlInto(bubble, liveAssistantPreview.html);
    else renderTextWithLinks(bubble, normalizeAssistantText(liveAssistantPreview.text || ""));
    liveAssistantRow = row;
  }

  function isMessageForActiveThread(threadId) {
    const activeThreadId = state && state.threadId ? String(state.threadId) : "";
    const incomingThreadId = String(threadId || "");
    if (!incomingThreadId) return true;
    if (!activeThreadId) return false;
    return activeThreadId === incomingThreadId;
  }

  function addApprovalRequest(requestId, method, params) {
    const row = insertRowFromTemplateBeforePendingAssistant(tplSystem);
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
    const row = insertRowFromTemplateBeforePendingAssistant(tplSystem);
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
    const startNewThread = currentPage === "home";
    if (startNewThread) {
      if (state && typeof state === "object") {
        state = Object.assign({}, state, { threadId: null, thread: null, busy: false, turnId: null });
      }
      lastRendered = { threadId: null, updatedAt: null, historySignature: null };
      clearChat();
    }
    if (currentPage === "home") setCurrentPage("chat", { skipFocus: true });
    const threadId = state && state.threadId ? String(state.threadId) : "";
    input.value = "";
    autoResizeInput();
    vscode.postMessage({ type: "send", text, attachments, startNewThread });
    attachments = [];
    renderAttachments();
    if (threadId && !startNewThread) clearDraftForThread(threadId);
  }

  function getQueuedFollowUps(threadId) {
    const activeThreadId = String(threadId || "");
    if (!activeThreadId) return [];
    const entries = queuedFollowUpsByThreadId[activeThreadId];
    return Array.isArray(entries) ? entries : [];
  }

  function setQueuedFollowUps(threadId, entries) {
    const activeThreadId = String(threadId || "");
    if (!activeThreadId) return;
    if (!Array.isArray(entries) || entries.length === 0) {
      delete queuedFollowUpsByThreadId[activeThreadId];
      return;
    }
    queuedFollowUpsByThreadId[activeThreadId] = entries;
  }

  function enqueueFollowUp() {
    const text = input.value.trim();
    const files = Array.isArray(attachments) ? attachments.slice() : [];
    if (!text && files.length === 0) return false;
    const threadId = state && state.threadId ? String(state.threadId) : "";
    if (!threadId) return false;
    const nextQueue = getQueuedFollowUps(threadId).concat([{ text, attachments: files }]);
    setQueuedFollowUps(threadId, nextQueue);
    input.value = "";
    autoResizeInput();
    attachments = [];
    renderAttachments();
    clearDraftForThread(threadId);
    showUiNotice(`follow-up queued (${nextQueue.length})`, { kind: "notice", ttlMs: 2200 });
    return true;
  }

  function flushQueuedFollowUp(threadId) {
    const activeThreadId = String(threadId || "");
    const queue = getQueuedFollowUps(activeThreadId);
    if (!activeThreadId || queue.length === 0 || isBusy || pendingSend) return false;
    const [nextEntry, ...rest] = queue;
    setQueuedFollowUps(activeThreadId, rest);
    pendingSend = true;
    allowBusyUI = true;
    vscode.postMessage({
      type: "send",
      text: String(nextEntry && nextEntry.text ? nextEntry.text : ""),
      attachments: Array.isArray(nextEntry && nextEntry.attachments) ? nextEntry.attachments : []
    });
    return true;
  }

  function handleSendOrStop() {
    if (isBusy) {
      if (enqueueFollowUp()) return;
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

  function fmtThreadLabel(thread) {
    const preview = getThreadPreview(thread).slice(0, 42);
    const updatedAt = getThreadUpdatedAt(thread);
    const updated = updatedAt ? new Date(updatedAt).toLocaleString() : "";
    return `${preview || getThreadId(thread)}${updated ? " · " + updated : ""}`;
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
    return modelId || t("modelLoading");
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
    setOptions(effortSelect, [{ value: "", label: t("effortDefault") }, ...opts], state.settings.effort || "");
  }

  function updateInstructionOptions(s) {
    if (!s) return;
    setOptions(
      uiLocaleSelect,
      [
        { value: "ja", label: t("uiLocaleJa") },
        { value: "en", label: t("uiLocaleEn") }
      ],
      (s.settings && s.settings.uiLocale) || uiLocale
    );
    setOptions(
      collaborationModeSelect,
      [{ value: "", label: t("collaborationDefault") }].concat(
        (Array.isArray(s.collaborationModes) ? s.collaborationModes : []).map((mode) => {
          const name = mode && typeof mode.name === "string" ? mode.name : "";
          const model = mode && typeof mode.model === "string" ? mode.model : "";
          const effort = mode && typeof mode.reasoning_effort === "string" ? mode.reasoning_effort : "";
          const suffix = [model, effort].filter(Boolean).join(" / ");
          return { value: name, label: suffix ? `${name} (${suffix})` : name };
        })
      ),
      (s.settings && s.settings.collaborationMode) || ""
    );
    setOptions(
      personalitySelect,
      [
        { value: "", label: t("personalityDefault") },
        { value: "friendly", label: t("personalityFriendly") },
        { value: "pragmatic", label: t("personalityPragmatic") },
        { value: "none", label: t("personalityNone") }
      ],
      (s.settings && s.settings.personality) || ""
    );
  }

  function applyLocale() {
    document.documentElement.lang = uiLocale;
    if (taskSettingsTitle) taskSettingsTitle.textContent = t("taskSettingsTitle");
    if (runSettingsTitle) runSettingsTitle.textContent = t("runSettingsTitle");
    if (projectInstructionsTitle) projectInstructionsTitle.textContent = t("projectInstructionsTitle");
    if (projectInstructionsHelp) projectInstructionsHelp.textContent = t("projectInstructionsHelp");
    if (baseInstructionsTitle) baseInstructionsTitle.textContent = t("baseInstructionsTitle");
    if (baseInstructionsHelp) baseInstructionsHelp.textContent = t("baseInstructionsHelp");
    if (sessionInstructionsTitle) sessionInstructionsTitle.textContent = t("sessionInstructionsTitle");
    if (sessionInstructionsHelp) sessionInstructionsHelp.textContent = t("sessionInstructionsHelp");
    if (modeInstructionsTitle) modeInstructionsTitle.textContent = t("modeInstructionsTitle");
    if (modeInstructionsHelp) modeInstructionsHelp.textContent = t("modeInstructionsHelp");
    if (taskListLabel) taskListLabel.textContent = t("taskPickerTitle");
    if (taskSearch) taskSearch.placeholder = t("searchTasks");
    if (input) input.placeholder = t("typeMessage");
    if (baseInstructionsInput) baseInstructionsInput.placeholder = t("baseInstructionsPlaceholder");
    if (developerInstructionsInput) developerInstructionsInput.placeholder = t("sessionInstructionsPlaceholder");
    setButtonLabel(homeButton, t("task"), t("taskPickerButton"));
    setButtonLabel(openSettings, t("settings"));
    setButtonLabel(taskClose, t("close"));
    setButtonLabel(taskNew, t("newThread"));
    setButtonLabel(taskArchive, t("archiveThread"));
    setButtonLabel(newThreadBtn, t("newThread"));
    setButtonLabel(forkThreadBtn, t("forkThread"));
    setButtonLabel(rollback1Btn, t("rollbackTurn"));
    setButtonLabel(archiveThreadBtn, t("archiveThread"));
    setButtonLabel(unarchiveThreadBtn, t("unarchiveThread"));
    setButtonLabel(saveBaseInstructionsBtn, t("saveBaseInstructions"));
    setButtonLabel(clearBaseInstructionsBtn, t("clearBaseInstructions"));
    setButtonLabel(saveDeveloperInstructionsBtn, t("saveSessionInstructions"));
    setButtonLabel(clearDeveloperInstructionsBtn, t("clearSessionInstructions"));
    setButtonLabel(saveInstructionModesBtn, t("saveModeSettings"));
    setButtonLabel(clearInstructionModesBtn, t("clearModeSettings"));
    setButtonLabel(openAgentsInstructionsBtn, t("openAgents"));
    setButtonLabel(createAgentsInstructionsBtn, t("createAgents"));
    setButtonLabel(attachFiles, t("attachFiles"));
    if (toggleFullAccess) {
      toggleFullAccess.title = t("toggleFullAccess");
      toggleFullAccess.setAttribute("aria-label", t("toggleFullAccess"));
    }
    if (toggleApproval) {
      toggleApproval.title = t("toggleApproval");
      toggleApproval.setAttribute("aria-label", t("toggleApproval"));
    }
    if (send) {
      const text = isBusy ? t("stop") : t("send");
      send.title = text;
      send.setAttribute("aria-label", text);
    }
    const wrapTitles = [
      [document.getElementById("effortSelectWrap"), t("effortTitle")],
      [document.getElementById("approvalSelectWrap"), t("approvalTitle")],
      [document.getElementById("sandboxSelectWrap"), t("sandboxTitle")],
      [document.getElementById("uiLocaleSelectWrap"), t("localeTitle")],
      [document.getElementById("collaborationModeSelectWrap"), t("collaborationTitle")],
      [document.getElementById("personalitySelectWrap"), t("personalityTitle")]
    ];
    for (const [el, title] of wrapTitles) {
      if (!el) continue;
      el.title = title;
    }
    renderAgentsInstructionsState(state);
  }

  function applyLockedPersonaUiState() {
    if (!personaSettingsLocked) return;
    const textareas = [baseInstructionsInput, developerInstructionsInput];
    for (const el of textareas) {
      if (!el) continue;
      el.readOnly = true;
      el.setAttribute("aria-readonly", "true");
      el.title = t("personaLockedHelp");
    }

    const disabledButtons = [
      saveBaseInstructionsBtn,
      clearBaseInstructionsBtn,
      saveDeveloperInstructionsBtn,
      clearDeveloperInstructionsBtn,
      saveInstructionModesBtn,
      clearInstructionModesBtn
    ];
    for (const el of disabledButtons) {
      if (!el) continue;
      el.disabled = true;
      el.title = t("personaLockedHelp");
      el.setAttribute("aria-label", t("personaLockedHelp"));
    }

    const disabledSelects = [collaborationModeSelect, personalitySelect];
    for (const el of disabledSelects) {
      if (!el) continue;
      el.disabled = true;
      el.title = t("personaLockedHelp");
      el.setAttribute("aria-label", t("personaLockedHelp"));
    }

    if (baseInstructionsHelp) baseInstructionsHelp.textContent = t("personaLockedHelp");
    if (sessionInstructionsHelp) sessionInstructionsHelp.textContent = t("personaLockedHelp");
    if (modeInstructionsHelp) modeInstructionsHelp.textContent = t("personaLockedHelp");
  }

  function getTaskSummarySignature(snapshot) {
    const tasks = Array.isArray(snapshot && snapshot.tasks)
      ? snapshot.tasks
      : Array.isArray(snapshot && snapshot.threads)
        ? snapshot.threads
        : [];
    if (!tasks.length) return `none:${String(snapshot && snapshot.threadId ? snapshot.threadId : "")}`;
    return tasks
      .map((thread, index) => {
        const id = getThreadId(thread) || `#${index}`;
        const updated = getThreadUpdatedAt(thread) || "";
        const archived = thread && thread.archived ? "1" : "0";
        return `${id}:${updated}:${archived}`;
      })
      .join("|");
  }

  function mergeIncomingState(prevState, nextState) {
    const incoming = nextState && typeof nextState === "object" ? Object.assign({}, nextState) : {};
    const previous = prevState && typeof prevState === "object" ? prevState : null;
    if (!previous) return incoming;

    const previousThreadId = previous && previous.threadId ? String(previous.threadId) : "";
    const incomingThreadId = incoming && incoming.threadId ? String(incoming.threadId) : "";
    const sameThread = previousThreadId && incomingThreadId && previousThreadId === incomingThreadId;
    const incomingThread =
      Object.prototype.hasOwnProperty.call(incoming, "thread") && incoming.thread !== undefined ? incoming.thread : undefined;

    if (sameThread && (incomingThread === null || incomingThread === undefined) && previous.thread) {
      incoming.thread = previous.thread;
    }

    return incoming;
  }

  function applyState(s) {
    const prevState = state;
    const prevThreadId = prevState && prevState.threadId ? String(prevState.threadId) : null;
    const mergedState = mergeIncomingState(prevState, s);
    const effectiveSettings = mergeDisplayedAccessSettings(mergedState && mergedState.settings);
    state = mergedState;
    if (state && typeof state === "object") state.settings = effectiveSettings;
    uiLocale = effectiveSettings && effectiveSettings.uiLocale ? String(effectiveSettings.uiLocale) : uiLocale;
    const models = (state.models || []).filter((m) => !m.hidden);
    const effectiveModelId = resolveEffectiveModelId(state, models);
    const effectiveModelLabel = resolveEffectiveModelLabel(models, effectiveModelId);
    setOptions(
      modelSelect,
      [{ value: "", label: `model: ${effectiveModelLabel}` }, ...models.map((m) => ({ value: m.model, label: m.displayName }))],
      (effectiveSettings && effectiveSettings.model) || ""
    );
    applyLocale();
    renderAgentsInstructionsState(state);
    syncBaseInstructionsEditor(effectiveSettings && effectiveSettings.baseInstructions);
    syncDeveloperInstructionsEditor(effectiveSettings && effectiveSettings.developerInstructions);
    updateInstructionOptions(state);
    applyLockedPersonaUiState();

    const nextTaskSummarySignature = getTaskSummarySignature(state);
    const tasksChanged = nextTaskSummarySignature !== lastTaskSummarySignature;
    if (taskTitle && (tasksChanged || state.threadId !== prevThreadId)) refreshHeaderCopy();
    if (isTaskPickerOpen() && tasksChanged) renderTaskPicker();
    lastTaskSummarySignature = nextTaskSummarySignature;

    const nextThreadId = state && state.threadId ? String(state.threadId) : null;
    if (nextThreadId && nextThreadId !== prevThreadId) {
      visibleHistoryCount = DEFAULT_VISIBLE_HISTORY_COUNT;
      if (prevThreadId) {
        persistDraftNow(prevThreadId);
      }
      restoreDraftForThread(nextThreadId);
      setCurrentPage("chat", { skipFocus: true });
    } else if (nextThreadId && !prevThreadId) {
      visibleHistoryCount = DEFAULT_VISIBLE_HISTORY_COUNT;
      restoreDraftForThread(nextThreadId);
      if (currentPage !== "home") setCurrentPage("chat", { skipFocus: true });
    } else if (!nextThreadId) {
      setCurrentPage("home", { skipFocus: true });
    }
    if (chatEmpty) chatEmpty.hidden = Boolean(nextThreadId) || currentPage !== "chat";

    setOptions(
      approvalSelect,
      [
        { value: "", label: t("approvalDefault") },
        { value: "untrusted", label: "untrusted" },
        { value: "on-request", label: "on-request" },
        { value: "never", label: "never" }
      ],
      (effectiveSettings && effectiveSettings.approvalPolicy) || ""
    );
    setOptions(
      sandboxSelect,
      [
        { value: "", label: t("sandboxDefault") },
        { value: "read-only", label: "read-only" },
        { value: "workspace-write", label: "workspace-write" },
        { value: "danger-full-access", label: "danger-full-access" }
      ],
      (effectiveSettings && effectiveSettings.sandbox) || ""
    );

    updateEffortOptions();

    status.textContent = formatStatusText(state.connectionStatus || "ready", "");

    if (fullAccessLabel && toggleFullAccess) {
      const sandbox = (effectiveSettings && effectiveSettings.sandbox) || null;
      const isFull = sandbox === "danger-full-access";
      fullAccessLabel.textContent = isFull ? t("fullAccess") : t("default");
      toggleFullAccess.classList.toggle("is-default", !isFull);
      toggleFullAccess.classList.toggle("is-full", isFull);
      toggleFullAccess.setAttribute("aria-pressed", isFull ? "true" : "false");
    }

    if (approvalLabel && toggleApproval) {
      const approval = (effectiveSettings && effectiveSettings.approvalPolicy) || null;
      const isNever = approval === "never";
      // "never" = no per-action prompts; others = may prompt.
      approvalLabel.textContent = isNever ? t("approvalOff") : t("approvalOn");
      toggleApproval.classList.toggle("is-on", !isNever);
      toggleApproval.classList.toggle("is-never", isNever);
      toggleApproval.setAttribute("aria-pressed", isNever ? "true" : "false");
      toggleApproval.title = `approval: ${approval || "default"}`;
      toggleApproval.setAttribute("aria-label", `approval: ${approval || "default"}`);
    }

    renderRateFooter(state.rateLimits);
    serverBusy = Boolean(state && state.busy);
    setBusy(serverBusy && allowBusyUI);

    const threadData = state.thread || null;
    const nextHistoryItems = threadData ? flattenHistoryItems(threadData) : [];
    const historySignature = threadData ? getThreadHistorySignature(threadData) : null;
    const renderedThreadId = state.threadId || null;
    const threadChanged = renderedThreadId !== lastRendered.threadId;
    const historyChanged = historySignature !== null && historySignature !== lastRendered.historySignature;
    const shouldRerenderThread = Boolean(
      threadData &&
        (threadChanged || (!serverBusy && historyChanged))
    );
    if (shouldRerenderThread) {
      lastRendered = { threadId: renderedThreadId, updatedAt: null, historySignature };
      if (!threadChanged && !serverBusy && canIncrementallySyncHistory(nextHistoryItems)) {
        syncThreadIncrementally(threadData, nextHistoryItems);
      } else {
        renderThread(threadData);
      }
    } else if (!renderedThreadId) {
      lastRendered = { threadId: null, updatedAt: null, historySignature: null };
      clearChat();
    }
  }

  function applyAccessSettingsPatch(patch) {
    if (!state) return;
    const nextSettings = Object.assign({}, state.settings || {}, patch || {});
    pendingAccessSettings = {
      hasApprovalPolicy: Object.prototype.hasOwnProperty.call(patch || {}, "approvalPolicy"),
      approvalPolicy: nextSettings.approvalPolicy || null,
      hasSandbox: Object.prototype.hasOwnProperty.call(patch || {}, "sandbox"),
      sandbox: nextSettings.sandbox || null
    };
    // applyState() updates labels/selects consistently without re-rendering the thread,
    // unless threadId/updatedAt changed (they won't here).
    applyState(Object.assign({}, state, { settings: nextSettings }));
  }

  function mergeDisplayedAccessSettings(settings) {
    const base = Object.assign({}, settings || {});
    if (!pendingAccessSettings) return base;

    const incomingApproval = Object.prototype.hasOwnProperty.call(base, "approvalPolicy") ? base.approvalPolicy || null : null;
    const incomingSandbox = Object.prototype.hasOwnProperty.call(base, "sandbox") ? base.sandbox || null : null;
    const pendingApproval = pendingAccessSettings.approvalPolicy || null;
    const pendingSandbox = pendingAccessSettings.sandbox || null;

    const approvalSettled = !pendingAccessSettings.hasApprovalPolicy || incomingApproval === pendingApproval;
    const sandboxSettled = !pendingAccessSettings.hasSandbox || incomingSandbox === pendingSandbox;
    if (approvalSettled && sandboxSettled) {
      pendingAccessSettings = null;
      return base;
    }

    if (pendingAccessSettings.hasApprovalPolicy) base.approvalPolicy = pendingApproval;
    if (pendingAccessSettings.hasSandbox) base.sandbox = pendingSandbox;
    return base;
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
    if (ordered.length === 0) {
      const b = document.createElement("div");
      b.className = "badge";
      b.textContent = t("rateLoading");
      rateFooter.appendChild(b);
      return;
    }

    for (const it of ordered) {
      const b = document.createElement("div");
      b.className = "badge";
      const label = it.label === "5h" ? t("rate5h") : it.label === "week" ? t("rateWeek") : it.label;
      const shown = fmtPercent(it.remaining);
      b.textContent = `${label} ${t("rateRemaining")} ${shown === null ? "?" : shown}%`;
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
      if (isBusy) {
        enqueueFollowUp();
        return;
      }
      doSend();
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
  input.addEventListener("input", () => {
    autoResizeInput();
    schedulePersistDraft();
  });
  input.addEventListener("blur", () => persistDraftNow());

  window.addEventListener("resize", () => autoResizeInput());
  autoResizeInput();

  if (openSettings) {
    openSettings.addEventListener("click", () => {
      if (currentPage === "home" && state && state.threadId) setCurrentPage("chat", { skipFocus: true });
      setSettingsOpen(!isSettingsOpen());
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      setSettingsOpen(false);
      if (state && state.threadId) setCurrentPage("chat", { skipFocus: true });
    }
  });

  document.addEventListener("click", (e) => {
    if (!isSettingsOpen() && !isTaskPickerOpen()) return;
    const path = typeof e.composedPath === "function" ? e.composedPath() : [];
    if (openSettings && (path.includes(openSettings) || openSettings.contains(e.target))) return;
    if (settingsPop && (path.includes(settingsPop) || settingsPop.contains(e.target))) return;
    if (homeButton && (path.includes(homeButton) || homeButton.contains(e.target))) return;
    if (taskPop && (path.includes(taskPop) || taskPop.contains(e.target))) return;
    if (currentPage === "home") {
      if (input && (path.includes(input) || input.contains(e.target))) return;
      if (send && (path.includes(send) || send.contains(e.target))) return;
      if (attachFiles && (path.includes(attachFiles) || attachFiles.contains(e.target))) return;
      if (attachmentsEl && (path.includes(attachmentsEl) || attachmentsEl.contains(e.target))) return;
    }
    setSettingsOpen(false);
    setCurrentPage("chat", { skipFocus: true });
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

  if (uiLocaleSelect) uiLocaleSelect.addEventListener("change", () => {
    const locale = uiLocaleSelect.value || "ja";
    uiLocale = locale === "en" ? "en" : "ja";
    if (!state) state = { settings: {} };
    state.settings = Object.assign({}, state.settings || {}, { uiLocale });
    applyLocale();
    updateInstructionOptions(state);
    updateEffortOptions();
    vscode.postMessage({ type: "setUiLocale", locale: uiLocale });
  });

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
    applyAccessSettingsPatch({ approvalPolicy, sandbox });
    vscode.postMessage({ type: "setAccessSettings", approvalPolicy, sandbox });
  });

  if (sandboxSelect) sandboxSelect.addEventListener("change", () => {
    const sandbox = sandboxSelect.value || null;
    const approvalPolicy = (approvalSelect.value || null);
    if (!state) state = { settings: {} };
    state.settings = state.settings || {};
    applyAccessSettingsPatch({ approvalPolicy, sandbox });
    vscode.postMessage({ type: "setAccessSettings", approvalPolicy, sandbox });
  });

  if (saveBaseInstructionsBtn) saveBaseInstructionsBtn.addEventListener("click", () => {
    submitInstructionSettings({});
  });

  if (clearBaseInstructionsBtn) clearBaseInstructionsBtn.addEventListener("click", () => {
    submitInstructionSettings({ baseInstructions: null });
  });

  if (saveDeveloperInstructionsBtn) saveDeveloperInstructionsBtn.addEventListener("click", () => {
    submitInstructionSettings({});
  });

  if (clearDeveloperInstructionsBtn) clearDeveloperInstructionsBtn.addEventListener("click", () => {
    submitInstructionSettings({ developerInstructions: null });
  });

  if (saveInstructionModesBtn) saveInstructionModesBtn.addEventListener("click", () => {
    submitInstructionSettings({});
  });

  if (clearInstructionModesBtn) clearInstructionModesBtn.addEventListener("click", () => {
    submitInstructionSettings({ personality: null, collaborationMode: null });
  });

  if (baseInstructionsInput) baseInstructionsInput.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submitInstructionSettings({});
    }
  });

  if (developerInstructionsInput) developerInstructionsInput.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      submitInstructionSettings({});
    }
  });

  if (openAgentsInstructionsBtn) openAgentsInstructionsBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "openAgentsInstructions" });
  });

  if (createAgentsInstructionsBtn) createAgentsInstructionsBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "createAgentsInstructions" });
  });

  if (homeButton) homeButton.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setSettingsOpen(false);
    setCurrentPage("home");
  });

  if (taskClose) taskClose.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCurrentPage("chat", { skipFocus: true });
  });

  if (taskNew) taskNew.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Save draft for the current task, then create and immediately switch to a fresh task.
    persistDraftNow();
    vscode.postMessage({ type: "newThread" });
    // Reset the composer draft so it feels like a clean task switch.
    if (input) input.value = "";
    autoResizeInput();
    attachments = [];
    renderAttachments();
    setCurrentPage("chat", { skipFocus: true });
  });

  if (taskArchive) taskArchive.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentPage === "home") {
      showArchivedTasks = !showArchivedTasks;
      taskArchive.classList.toggle("is-active", showArchivedTasks);
      renderTaskPicker();
      if (taskSubtitle) taskSubtitle.textContent = showArchivedTasks ? "Recent + archived tasks" : "Recent tasks";
      return;
    }
    if (!state || !state.threadId) return;
    const ok = confirm(t("taskArchiveConfirm"));
    if (!ok) return;
    vscode.postMessage({ type: "archiveThread", threadId: state.threadId });
    setCurrentPage("home", { skipFocus: true });
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
      status.textContent = formatStatusText(msg.status, msg.message);
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
      const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
      const threadId = msg.threadId ? String(msg.threadId) : state && state.threadId ? String(state.threadId) : "";
      addOptimisticUserMessage(threadId, msg.text, attachments);
      const row = addUserMessage(msg.text, attachments, { optimistic: true });
      if (threadId) {
        const nextRows = getOptimisticUserRows(threadId).concat([{ text: msg.text, attachments, row }]);
        setOptimisticUserRows(threadId, nextRows);
      }
      return;
    }

    if (msg.type === "filePreview") {
      const path = String(msg.path || "");
      applyPreview(path, msg.dataUrl);
      return;
    }

    if (msg.type === "systemMessage") {
      const kind = msg.kind ? String(msg.kind) : "info";
      if (msg.transient || kind === "notice") showUiNotice(msg.text, { kind });
      else addSystemMessage(msg.text);
      return;
    }

    if (msg.type === "assistantStart") {
      allowBusyUI = true;
      pendingSend = false;
      pendingAssistantItems++;
      if (!isBusy) setBusy(true);
      if (msg.itemId) {
        liveAssistantPreview = { itemId: String(msg.itemId), text: "", html: "", pending: true };
        renderLiveAssistantPreview();
      }
      return;
    }

    if (msg.type === "assistantDelta") {
      allowBusyUI = true;
      pendingSend = false;
      if (!isBusy) setBusy(true);
      if (msg.itemId) {
        const itemId = String(msg.itemId);
        const previousText =
          liveAssistantPreview && liveAssistantPreview.itemId === itemId ? String(liveAssistantPreview.text || "") : "";
        liveAssistantPreview = {
          itemId,
          text: previousText + String(msg.delta || ""),
          html: "",
          pending: true
        };
        renderLiveAssistantPreview();
      }
      return;
    }

    if (msg.type === "assistantDone") {
      if (msg.itemId) {
        const itemId = String(msg.itemId);
        liveAssistantPreview = {
          itemId,
          text:
            String(msg.text || "") ||
            (liveAssistantPreview && liveAssistantPreview.itemId === itemId ? String(liveAssistantPreview.text || "") : ""),
          html: "",
          pending: false
        };
        renderLiveAssistantPreview();
      }
      if (pendingAssistantItems > 0) pendingAssistantItems--;
      scheduleMaybeClearBusy();
      return;
    }

    if (msg.type === "assistantRendered") {
      if (msg.itemId) {
        const itemId = String(msg.itemId);
        assistantHtmlByItemId.set(itemId, String(msg.html || ""));
        if (liveAssistantPreview && liveAssistantPreview.itemId === itemId) {
          liveAssistantPreview = {
            itemId,
            text: String(liveAssistantPreview.text || ""),
            html: String(msg.html || ""),
            pending: false
          };
          renderLiveAssistantPreview();
        }
        const renderedRow = assistantByItemId.get(itemId);
        if (renderedRow) {
          const bubble = renderedRow.querySelector(".bubble");
          if (bubble) renderHtmlInto(bubble, String(msg.html || ""));
        }
      }
      return;
    }

    if (msg.type === "systemDelta") {
      return;
    }

    if (msg.type === "systemDone") {
      scheduleMaybeClearBusy();
      return;
    }

    if (msg.type === "commandExecutionDelta") {
      return;
    }

    if (msg.type === "commandExecutionDone") {
      if (!isMessageForActiveThread(msg.threadId)) return;
      renderThreadItem({
        type: "commandExecution",
        id: String(msg.itemId || ""),
        status: String(msg.status || ""),
        command: String(msg.command || ""),
        aggregatedOutput: String(msg.output || "")
      });
      if (activeCommand && activeCommand.itemId === msg.itemId) activeCommand = null;
      renderActivityIndicator();
      if (pendingCommandItems > 0) pendingCommandItems--;
      scheduleMaybeClearBusy();
      return;
    }

    if (msg.type === "fileChangeDelta") {
      if (!activeFileChange || activeFileChange.itemId !== msg.itemId) {
        activeFileChange = { itemId: msg.itemId };
        renderActivityIndicator();
      }
      return;
    }

    if (msg.type === "fileChangeDone") {
      if (!isMessageForActiveThread(msg.threadId)) return;
      renderThreadItem({
        type: "fileChange",
        id: String(msg.itemId || ""),
        changes: Array.isArray(msg.changes) ? msg.changes : []
      });
      if (activeFileChange && activeFileChange.itemId === msg.itemId) activeFileChange = null;
      renderActivityIndicator();
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
      lastTurnDiff = String(msg.diff || "");
      return;
    }

    if (msg.type === "commandExecutionStart") {
      if (!isMessageForActiveThread(msg.threadId)) return;
      allowBusyUI = true;
      pendingSend = false;
      pendingCommandItems++;
      if (!isBusy) setBusy(true);
      activeCommand = { itemId: msg.itemId, command: String(msg.command || "") };
      renderActivityIndicator();
      return;
    }

    if (msg.type === "fileChangeStart") {
      if (!isMessageForActiveThread(msg.threadId)) return;
      allowBusyUI = true;
      pendingSend = false;
      pendingFileItems++;
      if (!isBusy) setBusy(true);
      activeFileChange = { itemId: msg.itemId };
      renderActivityIndicator();
      return;
    }

    if (msg.type === "turnBusy") {
      if (state && state.threadId && msg.threadId && state.threadId !== msg.threadId) return;
      pendingSend = false;
      if (msg.busy) allowBusyUI = true;
      serverBusy = Boolean(msg.busy);
      setBusy(serverBusy && allowBusyUI);
      if (!msg.busy) {
        clearLiveAssistantRow();
        liveAssistantPreview = null;
        activeCommand = null;
        activeFileChange = null;
        pendingAssistantItems = 0;
        pendingCommandItems = 0;
        pendingFileItems = 0;
        clearBusyToken++;
        setTimeout(() => {
          flushQueuedFollowUp(state && state.threadId ? String(state.threadId) : "");
        }, 0);
      }
      return;
    }
  });

  window.addEventListener("beforeunload", () => persistDraftNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistDraftNow();
  });

  applyLocale();
  applyLockedPersonaUiState();
  setCurrentPage("home", { skipFocus: true });
  vscode.postMessage({ type: "init" });
})();
