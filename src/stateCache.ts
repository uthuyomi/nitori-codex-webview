import type { CodexAppServerClient } from "./codexAppServer";

type CachedValue<T> = {
  value: T;
  expiresAt: number;
};

export type AppServerLists = {
  models: unknown[];
  threads: unknown[];
  rateLimits: unknown;
  collaborationModes: unknown[];
  config: unknown;
};

function readArrayResult(response: unknown, keys: string[]): unknown[] {
  if (Array.isArray(response)) return response;
  if (!response || typeof response !== "object") return [];

  const record = response as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

export class AppStateCache {
  private listsCache: CachedValue<AppServerLists> | null = null;
  private threadCache = new Map<string, CachedValue<unknown>>();
  private lastKnownRateLimits: unknown = null;

  constructor(
    private readonly ttlMs: {
      lists: number;
      thread: number;
    } = {
      lists: 5_000,
      thread: 2_000
    }
  ) {}

  invalidateAll(): void {
    this.listsCache = null;
    this.threadCache.clear();
  }

  invalidateLists(): void {
    this.listsCache = null;
  }

  invalidateThread(threadId: string | null | undefined): void {
    const id = String(threadId || "").trim();
    if (!id) return;
    this.threadCache.delete(id);
  }

  updateRateLimits(rateLimits: unknown): void {
    this.lastKnownRateLimits = rateLimits;
    if (!this.listsCache) return;
    this.listsCache = {
      value: { ...this.listsCache.value, rateLimits },
      expiresAt: this.listsCache.expiresAt
    };
  }

  getCachedLists(): AppServerLists | null {
    const now = Date.now();
    if (!this.listsCache || this.listsCache.expiresAt <= now) return null;
    return this.listsCache.value;
  }

  getCachedRateLimits(): unknown {
    return this.getCachedLists()?.rateLimits ?? this.lastKnownRateLimits;
  }

  async getLists(client: CodexAppServerClient, cwd: string | null): Promise<AppServerLists> {
    const now = Date.now();
    if (this.listsCache && this.listsCache.expiresAt > now) return this.listsCache.value;

    const [modelsRes, threadsRes, rateRes, collaborationModesRes, configRes] = await Promise.all([
      client.request("model/list", { limit: 200, includeHidden: false }),
      client.request("thread/list", { limit: 50 }),
      client.request("account/rateLimits/read"),
      client.request("collaborationMode/list").catch(() => ({ data: [] })),
      client.request("config/read", { includeLayers: false, cwd }).catch(() => null)
    ]);

    const value: AppServerLists = {
      models: readArrayResult(modelsRes, ["data", "models", "items"]),
      threads: readArrayResult(threadsRes, ["data", "threads", "items"]),
      rateLimits: (rateRes as { rateLimits?: unknown } | null)?.rateLimits ?? null,
      collaborationModes: readArrayResult(collaborationModesRes, ["data", "collaborationModes", "modes", "items"]),
      config: configRes
    };
    this.lastKnownRateLimits = value.rateLimits;

    this.listsCache = {
      value,
      expiresAt: now + this.ttlMs.lists
    };
    return value;
  }

  async getThread(client: CodexAppServerClient, threadId: string | null): Promise<unknown> {
    const id = String(threadId || "").trim();
    if (!id) return null;

    const now = Date.now();
    const cached = this.threadCache.get(id);
    if (cached && cached.expiresAt > now) return cached.value;

    const readRes = await client.request("thread/read", { threadId: id, includeTurns: true });
    const thread = (readRes as { thread?: unknown } | null)?.thread ?? null;
    this.threadCache.set(id, {
      value: thread,
      expiresAt: now + this.ttlMs.thread
    });
    return thread;
  }
}
