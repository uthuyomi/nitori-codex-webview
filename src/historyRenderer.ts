import { renderMarkdownWithShiki } from "./markdownRender";

export type AssistantHtmlListener = (itemId: string, html: string) => void;
export type ShikiCssListener = (css: string) => void;

type AgentMessageItem = {
  id?: unknown;
  type?: unknown;
  text?: unknown;
  message?: unknown;
  content?: unknown;
  contentItems?: unknown;
  role?: unknown;
  author?: unknown;
  sender?: unknown;
};

type ThreadLike = {
  turns?: Array<{
    items?: AgentMessageItem[];
    content?: unknown;
    input?: unknown;
    userMessage?: unknown;
  }>;
  items?: AgentMessageItem[];
};

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[_\s-]+/g, "")
    .toLowerCase();
}

function extractTextParts(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      return typeof (part as { text?: unknown }).text === "string" ? String((part as { text?: unknown }).text) : "";
    })
    .filter((part) => part.length > 0)
    .join("\n");
}

function normalizeAgentMessage(item: AgentMessageItem): { id: string; text: string } | null {
  const type = normalizeKey(item.type);
  const role = normalizeKey(item.role ?? item.author ?? item.sender);
  const isAgentLike =
    type === "agentmessage" ||
    type === "assistantmessage" ||
    type === "assistantresponse" ||
    role === "assistant";
  if (!isAgentLike) return null;

  const id = typeof item.id === "string" ? item.id : "";
  const text =
    typeof item.text === "string"
      ? item.text
      : typeof item.message === "string"
        ? item.message
        : extractTextParts(item.content) || extractTextParts(item.contentItems);
  if (!id || !text.trim()) return null;
  return { id, text };
}

function getThreadItems(thread: ThreadLike | null | undefined): AgentMessageItem[] {
  const out: AgentMessageItem[] = [];
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const item of items) {
      if (item && typeof item === "object") out.push(item);
    }
  }
  if (out.length === 0) {
    const items = Array.isArray(thread?.items) ? thread.items : [];
    for (const item of items) {
      if (item && typeof item === "object") out.push(item);
    }
  }
  return out;
}

export class HistoryRenderer {
  private readonly renderedHtmlByItemId = new Map<string, string>();
  private activeRenderToken = 0;

  constructor(
    private readonly onAssistantHtml: AssistantHtmlListener,
    private readonly onShikiCss: ShikiCssListener
  ) {}

  clear(): void {
    this.activeRenderToken++;
  }

  async renderThread(thread: unknown): Promise<void> {
    const token = ++this.activeRenderToken;
    const items = getThreadItems(thread as ThreadLike | null);

    for (const item of items) {
      if (token !== this.activeRenderToken) return;
      const normalized = normalizeAgentMessage(item);
      if (!normalized) continue;

      const itemId = normalized.id;
      const text = normalized.text;
      if (text.length > 200_000) continue;

      const cachedHtml = this.renderedHtmlByItemId.get(itemId);
      if (cachedHtml) {
        this.onAssistantHtml(itemId, cachedHtml);
        continue;
      }

      try {
        const rendered = await renderMarkdownWithShiki(text);
        if (token !== this.activeRenderToken) return;
        this.onShikiCss(rendered.shikiCss);
        if (!rendered.html || !rendered.html.trim()) continue;
        this.renderedHtmlByItemId.set(itemId, rendered.html);
        this.onAssistantHtml(itemId, rendered.html);
      } catch {
        // Ignore background history render failures.
      }
    }
  }
}
