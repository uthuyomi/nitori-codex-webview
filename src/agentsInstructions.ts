import { promises as fs } from "node:fs";
import * as path from "node:path";

export type AgentsFileState = {
  workspacePath: string | null;
  resolvedPath: string | null;
  exists: boolean;
  scope: "workspace" | "ancestor" | "none";
};

const AGENTS_FILENAME = "AGENTS.md";

export async function detectAgentsFile(workspacePath: string | null): Promise<AgentsFileState> {
  if (!workspacePath) {
    return {
      workspacePath: null,
      resolvedPath: null,
      exists: false,
      scope: "none"
    };
  }

  let current = workspacePath;
  while (true) {
    const candidate = path.join(current, AGENTS_FILENAME);
    try {
      const st = await fs.stat(candidate);
      if (st.isFile()) {
        return {
          workspacePath,
          resolvedPath: candidate,
          exists: true,
          scope: current === workspacePath ? "workspace" : "ancestor"
        };
      }
    } catch {
      // ignore and continue ascending
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return {
    workspacePath,
    resolvedPath: path.join(workspacePath, AGENTS_FILENAME),
    exists: false,
    scope: "none"
  };
}

export async function ensureWorkspaceAgentsFile(workspacePath: string): Promise<string> {
  const targetPath = path.join(workspacePath, AGENTS_FILENAME);
  try {
    const st = await fs.stat(targetPath);
    if (st.isFile()) return targetPath;
  } catch {
    // create below
  }

  const template = [
    "# AGENTS.md",
    "",
    "## Project Instructions",
    "",
    "- Describe the project-level implementation rules Codex should follow.",
    "- Keep instructions specific, stable, and repo-scoped.",
    "- Put temporary personal preferences in session instructions instead."
  ].join("\n");

  await fs.writeFile(targetPath, template, { encoding: "utf8" });
  return targetPath;
}
