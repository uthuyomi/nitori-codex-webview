(function () {
  function normalizeType(value) {
    return String(value || "")
      .trim()
      .replace(/[_\s-]+/g, "")
      .toLowerCase();
  }

  function normalizeRole(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  }

  function looksLikeItem(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return (
      value.type !== undefined ||
      value.role !== undefined ||
      value.author !== undefined ||
      value.sender !== undefined ||
      value.command !== undefined ||
      value.changes !== undefined ||
      value.summary !== undefined ||
      value.plan !== undefined
    );
  }

  function normalizeContentPart(part) {
    if (typeof part === "string") return { type: "text", text: part };
    if (!part || typeof part !== "object") return null;
    const rawType = String(part.type || "");
    const normalizedType = normalizeType(rawType);
    if ((normalizedType === "text" || normalizedType === "inputtext") && typeof part.text === "string") {
      return { type: "text", text: part.text };
    }
    if (normalizedType === "mention") {
      if (typeof part.path === "string" && part.path) return { type: "mention", path: part.path, name: part.name };
      if (typeof part.name === "string" && part.name) return { type: "mention", name: part.name };
    }
    if ((normalizedType === "localimage" || normalizedType === "local_image") && typeof part.path === "string") {
      return { type: "local_image", path: part.path };
    }
    if ((normalizedType === "image" || normalizedType === "inputimage") && (typeof part.url === "string" || typeof part.image_url === "string")) {
      return { type: "input_image", image_url: typeof part.image_url === "string" ? part.image_url : part.url };
    }
    if (typeof part.content === "string" && part.content) return { type: "text", text: part.content };
    if (typeof part.text === "string" && part.text) return { type: "text", text: part.text };
    return null;
  }

  function normalizeContent(parts) {
    if (typeof parts === "string") return [{ type: "text", text: parts }];
    const objectValue = asObject(parts);
    if (objectValue) {
      const nested =
        normalizeContent(objectValue.content).concat(
          normalizeContent(objectValue.contentItems),
          normalizeContent(objectValue.content_items),
          normalizeContent(objectValue.input),
          normalizeContent(objectValue.inputItems),
          normalizeContent(objectValue.input_items),
          normalizeContent(objectValue.message),
          normalizeContent(objectValue.text)
        );
      if (nested.length > 0) return nested;
    }
    const normalized = [];
    for (const part of asArray(parts)) {
      const next = normalizeContentPart(part);
      if (next) normalized.push(next);
    }
    return normalized;
  }

  function textContent(text) {
    return typeof text === "string" && text ? [{ type: "text", text }] : [];
  }

  function normalizeUserItem(item) {
    const fromContent = normalizeContent(item && item.content);
    const fromInput = normalizeContent(item && item.input);
    const fromContentItems = normalizeContent(item && item.contentItems);
    const fromSnakeContentItems = normalizeContent(item && item.content_items);
    const fallbackText =
      typeof (item && item.text) === "string"
        ? item.text
        : typeof (item && item.message) === "string"
          ? item.message
          : typeof (item && item.inputText) === "string"
            ? item.inputText
            : "";
    const finalContent =
      fromContent.length > 0
        ? fromContent
        : fromInput.length > 0
          ? fromInput
          : fromContentItems.length > 0
            ? fromContentItems
            : fromSnakeContentItems.length > 0
              ? fromSnakeContentItems
              : textContent(fallbackText);
    return {
      id: typeof (item && item.id) === "string" ? item.id : "",
      type: "userMessage",
      content: finalContent
    };
  }

  function normalizeAgentItem(item) {
    let text = "";
    if (typeof (item && item.text) === "string") text = item.text;
    else if (typeof (item && item.message) === "string") text = item.message;
    else if (typeof (item && item.content) === "string") text = item.content;
    else {
      const content = normalizeContent(item && item.content).concat(
        normalizeContent(item && item.contentItems),
        normalizeContent(item && item.content_items)
      );
      text = content
        .filter((part) => part && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
    }
    return {
      id: typeof (item && item.id) === "string" ? item.id : "",
      type: "agentMessage",
      text,
      html: typeof (item && item.html) === "string" ? item.html : "",
      phase: typeof (item && item.phase) === "string" ? item.phase : "",
      completed: item && item.completed === false ? false : true
    };
  }

  function normalizeItem(item) {
    if (!item || typeof item !== "object") return null;
    const type = normalizeType(item.type);
    const role = normalizeRole(item.role || item.author || item.sender);

    if (
      type === "usermessage" ||
      type === "usermsg" ||
      type === "inputmessage" ||
      type === "inputmsg" ||
      role === "user"
    ) {
      return normalizeUserItem(item);
    }

    if (
      type === "agentmessage" ||
      type === "assistantmessage" ||
      type === "assistantresponse" ||
      role === "assistant"
    ) {
      return normalizeAgentItem(item);
    }

    if (type === "commandexecution") {
      return {
        id: typeof item.id === "string" ? item.id : "",
        type: "commandExecution",
        command: typeof item.command === "string" ? item.command : "",
        status: typeof item.status === "string" ? item.status : "",
        commandActions: asArray(item.commandActions),
        aggregatedOutput:
          typeof item.aggregatedOutput === "string"
            ? item.aggregatedOutput
            : typeof item.output === "string"
              ? item.output
              : ""
      };
    }

    if (type === "filechange") {
      return {
        id: typeof item.id === "string" ? item.id : "",
        type: "fileChange",
        changes: asArray(item.changes)
      };
    }

    if (type === "reasoning") {
      return {
        type: "reasoning",
        summary: asArray(item.summary)
      };
    }

    if (type === "plan") {
      return {
        type: "plan",
        text:
          typeof item.text === "string"
            ? item.text
            : typeof item.plan === "string"
              ? item.plan
              : ""
      };
    }

    if (type === "websearch") {
      return {
        type: "webSearch",
        query:
          typeof item.query === "string"
            ? item.query
            : typeof item.text === "string"
              ? item.text
              : ""
      };
    }

    return item;
  }

  function collectTurnItems(turn) {
    const out = [];
    const seenObjects = new Set();

    function collectFrom(value) {
      if (value == null) return;
      if (Array.isArray(value)) {
        for (const entry of value) collectFrom(entry);
        return;
      }
      if (typeof value !== "object") return;
      if (seenObjects.has(value)) return;
      seenObjects.add(value);

      if (looksLikeItem(value)) {
        const normalized = normalizeItem(value);
        if (normalized) out.push(normalized);
      }

      const record = value;
      const likelyCollections = [
        record.items,
        record.messages,
        record.history,
        record.entries,
        record.events,
        record.steps,
        record.responses,
        record.outputs
      ];
      for (const collection of likelyCollections) collectFrom(collection);
    }

    collectFrom(turn && turn.items);
    collectFrom(turn && turn.messages);
    collectFrom(turn && turn.history);
    collectFrom(turn && turn.entries);
    collectFrom(turn && turn.events);
    collectFrom(turn && turn.steps);
    const hasExplicitUserItem = out.some((item) => item && item.type === "userMessage");
    if (!hasExplicitUserItem) {
      const rawUserInput =
        (turn && turn.input) ||
        (turn && turn.inputMessage) ||
        (turn && turn.input_message) ||
        (turn && turn.userInput) ||
        (turn && turn.user_input) ||
        (turn && turn.content) ||
        (turn && turn.prompt) ||
        (turn && turn.userMessage) ||
        null;
      if (rawUserInput) {
        const syntheticUser =
          Array.isArray(rawUserInput) ? normalizeUserItem({ content: rawUserInput }) : normalizeUserItem(rawUserInput);
        if (syntheticUser.content.length > 0) out.unshift(syntheticUser);
      }
    }
    return out;
  }

  function flattenThreadItems(thread) {
    const out = [];
    const turns = Array.isArray(thread && thread.turns) ? thread.turns : [];
    for (const turn of turns) {
      const items = collectTurnItems(turn);
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        out.push(item);
      }
    }
    if (out.length === 0) {
      const seenObjects = new Set();
      function collectTopLevel(value) {
        if (value == null) return;
        if (Array.isArray(value)) {
          for (const entry of value) collectTopLevel(entry);
          return;
        }
        if (typeof value !== "object") return;
        if (seenObjects.has(value)) return;
        seenObjects.add(value);

        if (looksLikeItem(value)) {
          const normalized = normalizeItem(value);
          if (normalized) out.push(normalized);
        }

        const record = value;
        const likelyCollections = [
          record.items,
          record.messages,
          record.inputMessages,
          record.input_messages,
          record.history,
          record.entries,
          record.events,
          record.steps,
          record.responses,
          record.outputs
        ];
        for (const collection of likelyCollections) collectTopLevel(collection);
      }
      collectTopLevel(thread && thread.items);
      collectTopLevel(thread && thread.messages);
      collectTopLevel(thread && thread.inputMessages);
      collectTopLevel(thread && thread.input_messages);
      collectTopLevel(thread && thread.history);
      collectTopLevel(thread && thread.entries);
      collectTopLevel(thread && thread.events);
      collectTopLevel(thread && thread.steps);
    }
    return out;
  }

  function normalizeStatus(value) {
    const normalized = normalizeType(value);
    if (normalized === "inprogress") return "in_progress";
    if (normalized === "interrupted" || normalized === "cancelled" || normalized === "canceled") return "cancelled";
    return "complete";
  }

  function isItemStillRunning(item, turnStatus) {
    if (!item || typeof item !== "object") return false;
    const itemStatus = normalizeStatus(item.status || turnStatus);
    if (itemStatus !== "in_progress") return false;
    if (item.completed === false) return true;
    switch (item.type) {
      case "agentMessage":
      case "commandExecution":
      case "fileChange":
      case "plan":
      case "webSearch":
      case "reasoning":
        return true;
      default:
        return false;
    }
  }

  function isAgentBodyItem(item) {
    if (!item || typeof item !== "object") return false;
    switch (item.type) {
      case "agentMessage":
      case "commandExecution":
      case "fileChange":
      case "reasoning":
      case "plan":
      case "webSearch":
        return true;
      default:
        return false;
    }
  }

  function splitItemsIntoRenderGroups(items, status) {
    const list = Array.isArray(items) ? items : [];
    const preUserItems = [];
    const userItems = [];
    const agentItems = [];
    const postAssistantItems = [];
    let foundNonUserMessage = false;

    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      if (!item || typeof item !== "object") continue;

      if (!foundNonUserMessage && item.type === "userMessage") {
        userItems.push(item);
        continue;
      }
      if (!foundNonUserMessage && item.type === "hook") {
        preUserItems.push(item);
        continue;
      }

      foundNonUserMessage = true;

      if (item.type === "hook") {
        const hasLaterChronologicalContent = list.slice(index + 1).some((laterItem) => {
          return laterItem && (laterItem.type === "userMessage" || isAgentBodyItem(laterItem));
        });
        if (hasLaterChronologicalContent) {
          agentItems.push(item);
        } else {
          postAssistantItems.push(item);
        }
        continue;
      }

      if (item.type === "userMessage" || isAgentBodyItem(item)) {
        agentItems.push(item);
        continue;
      }

      postAssistantItems.push(item);
    }

    let assistantItem = null;
    let assistantIndex = -1;
    for (let index = agentItems.length - 1; index >= 0; index -= 1) {
      const candidate = agentItems[index];
      if (!candidate || candidate.type !== "agentMessage") continue;
      if (String(candidate.phase || "").toLowerCase() === "final_answer") {
        assistantItem = candidate;
        assistantIndex = index;
        break;
      }
      if (!assistantItem) {
        assistantItem = candidate;
        assistantIndex = index;
      }
    }
    if (assistantItem && assistantIndex >= 0) {
      agentItems.splice(assistantIndex, 1);
    }

    return {
      status: normalizeStatus(status),
      preUserItems,
      userItems,
      agentItems,
      assistantItem,
      postAssistantItems
    };
  }

  function formatWorkedForTimeLabel(turn) {
    const startedAt = Number(turn && turn.turnStartedAtMs);
    const finalAssistantStartedAt = Number(turn && turn.finalAssistantStartedAtMs);
    if (!Number.isFinite(startedAt) || !Number.isFinite(finalAssistantStartedAt) || finalAssistantStartedAt <= startedAt) {
      return null;
    }
    const elapsedMs = finalAssistantStartedAt - startedAt;
    const seconds = Math.max(1, Math.round(elapsedMs / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    if (minutes < 60) return remainSeconds > 0 ? `${minutes}m ${remainSeconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainMinutes = minutes % 60;
    return remainMinutes > 0 ? `${hours}h ${remainMinutes}m` : `${hours}h`;
  }

  function inferCommandKind(item) {
    const actions = asArray(item && item.commandActions);
    const firstAction = actions.length > 0 ? actions[0] : null;
    const actionType = normalizeType(firstAction && firstAction.type);
    if (actionType === "listfiles") return "list_files";
    if (actionType === "search") return "search";
    if (actionType === "read") return "read";

    const command = String((item && item.command) || "").trim().toLowerCase();
    if (!command) return "other";
    if (
      command.startsWith("rg ") ||
      command.includes(" select-string ") ||
      command.startsWith("grep ") ||
      command.includes(" findstr ")
    ) {
      return "search";
    }
    if (
      command.startsWith("ls") ||
      command.startsWith("dir") ||
      command.startsWith("find ") ||
      command.includes("get-childitem")
    ) {
      return "list_files";
    }
    if (
      command.startsWith("cat ") ||
      command.startsWith("type ") ||
      command.startsWith("sed ") ||
      command.includes("get-content")
    ) {
      return "read";
    }
    return "other";
  }

  function segmentAgentEntries(agentItems, status) {
    const entries = [];
    let currentExplorationGroup = null;
    let isExploring = false;
    let isAnyNonExploringAgentItemInProgress = false;

    function pushExplorationGroup() {
      if (currentExplorationGroup && currentExplorationGroup.items.length > 0) {
        entries.push(currentExplorationGroup);
      }
      currentExplorationGroup = null;
    }

    for (const item of asArray(agentItems)) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "reasoning") {
        if (currentExplorationGroup) currentExplorationGroup.items.push(item);
        continue;
      }
      if (item.type === "commandExecution") {
        const commandKind = inferCommandKind(item);
        if (commandKind === "read" || commandKind === "search" || commandKind === "list_files") {
          if (!currentExplorationGroup) {
            currentExplorationGroup = {
              kind: "exploration",
              status: isItemStillRunning(item, status) ? "exploring" : "explored",
              items: []
            };
          }
          if (isItemStillRunning(item, status)) isExploring = true;
          currentExplorationGroup.items.push(item);
          continue;
        }
      }
      pushExplorationGroup();
      if (isItemStillRunning(item, status)) isAnyNonExploringAgentItemInProgress = true;
      entries.push({ kind: "item", item });
    }

    pushExplorationGroup();
    return {
      renderableAgentEntries: entries,
      isExploring,
      isAnyNonExploringAgentItemInProgress
    };
  }

  function getTurnProgressIndicator(groups) {
    if (!groups || typeof groups !== "object") return "none";
    if (groups.status !== "in_progress") return "none";
    if (groups.isExploring) return "exploring";
    if (groups.proposedPlanItem && isItemStillRunning(groups.proposedPlanItem, groups.status)) return "planning";
    if (groups.hasWorkedForItem || groups.hasBlockingRequest) return "none";
    if (groups.assistantItem && isItemStillRunning(groups.assistantItem, groups.status)) return "thinking";
    if (groups.isAnyNonExploringAgentItemInProgress) return "none";
    return "thinking";
  }

  function getRenderableTurns(thread) {
    const turns = Array.isArray(thread && thread.turns) ? thread.turns : [];
    if (turns.length === 0) {
      const flatItems = flattenThreadItems(thread);
      if (flatItems.length === 0) return [];
      const groups = splitItemsIntoRenderGroups(flatItems, thread && thread.status);
      const segmented = segmentAgentEntries(groups.agentItems, groups.status);
      groups.renderableAgentEntries = segmented.renderableAgentEntries;
      groups.isExploring = segmented.isExploring;
      groups.isAnyNonExploringAgentItemInProgress = segmented.isAnyNonExploringAgentItemInProgress;
      groups.workedForTimeLabel = null;
      groups.hasWorkedForItem = false;
      groups.proposedPlanItem = asArray(groups.agentItems).find((item) => item && item.type === "plan") || null;
      groups.hasBlockingRequest = false;
      groups.progressIndicator = getTurnProgressIndicator(groups);
      return [groups];
    }

    return turns.map((turn) => {
      const items = collectTurnItems(turn);
      const groups = splitItemsIntoRenderGroups(items, turn && turn.status);
      const segmented = segmentAgentEntries(groups.agentItems, groups.status);
      groups.renderableAgentEntries = segmented.renderableAgentEntries;
      groups.isExploring = segmented.isExploring;
      groups.isAnyNonExploringAgentItemInProgress = segmented.isAnyNonExploringAgentItemInProgress;
      groups.workedForTimeLabel = formatWorkedForTimeLabel(turn);
      groups.hasWorkedForItem = Boolean(groups.workedForTimeLabel);
      groups.proposedPlanItem = asArray(groups.agentItems).find((item) => item && item.type === "plan") || null;
      groups.hasBlockingRequest = false;
      groups.progressIndicator = getTurnProgressIndicator(groups);
      return groups;
    });
  }

  function getHistorySignature(thread) {
    const items = flattenThreadItems(thread);
    if (items.length === 0) return "0";
    const last = items[items.length - 1];
    const lastKey = [
      String(last.type || ""),
      typeof last.id === "string" ? last.id : "",
      typeof last.text === "string" ? last.text.length : Array.isArray(last.content) ? last.content.length : 0
    ].join(":");
    return `${items.length}:${lastKey}`;
  }

  function createHistoryWindow(items, visibleCount) {
    const list = Array.isArray(items) ? items : [];
    const count = Number.isFinite(visibleCount) ? Math.max(0, Math.floor(visibleCount)) : list.length;
    const startIndex = Math.max(0, list.length - count);
    return {
      totalItems: list.length,
      hiddenCount: startIndex,
      items: list.slice(startIndex)
    };
  }

  window.__NITORI_THREAD_HISTORY__ = {
    flattenThreadItems,
    getRenderableTurns,
    createHistoryWindow,
    getHistorySignature
  };
})();
