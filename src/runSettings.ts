export type RunSettings = {
  model: string | null;
  effort: string | null;
  approvalPolicy: string | null;
  sandbox: string | null;
  baseInstructions: string | null;
  developerInstructions: string | null;
  personality: string | null;
  collaborationMode: string | null;
  uiLocale: UiLocale;
};

export type UiLocale = "ja" | "en";

const validPersonalities = new Set(["friendly", "pragmatic", "none"]);

export const runSettingsKey = {
  threadId: "nitoriCodex.threadId",
  model: "nitoriCodex.model",
  effort: "nitoriCodex.effort",
  approvalPolicy: "nitoriCodex.approvalPolicy",
  sandbox: "nitoriCodex.sandbox",
  baseInstructions: "nitoriCodex.baseInstructions",
  developerInstructions: "nitoriCodex.developerInstructions",
  personality: "nitoriCodex.personality",
  collaborationMode: "nitoriCodex.collaborationMode",
  uiLocale: "nitoriCodex.uiLocale"
} as const;

export function normalizeInstructions(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeDeveloperInstructions(value: unknown): string | null {
  return normalizeInstructions(value);
}

export function normalizeBaseInstructions(value: unknown): string | null {
  return normalizeInstructions(value);
}

export function normalizePersonality(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return validPersonalities.has(normalized) ? normalized : null;
}

export function normalizeCollaborationMode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function normalizeUiLocale(value: unknown): UiLocale {
  return value === "en" ? "en" : "ja";
}
