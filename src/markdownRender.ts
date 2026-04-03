import type { TransformerStyleToClass } from "@shikijs/transformers";
import type MarkdownIt from "markdown-it";

type RenderResult = { html: string; shikiCss: string };

type Fence = { lang: string; code: string };

let rendererPromise: Promise<{
  render: (text: string) => Promise<RenderResult>;
}> | null = null;

export async function renderMarkdownWithShiki(text: string): Promise<RenderResult> {
  if (!rendererPromise) rendererPromise = createRenderer();
  const r = await rendererPromise;
  return await r.render(text);
}

async function createRenderer() {
  const [{ default: MarkdownItCtor }, shiki, transformers] = await Promise.all([
    import("markdown-it"),
    import("shiki"),
    import("@shikijs/transformers")
  ]);

  const { transformerStyleToClass } = transformers as unknown as typeof import("@shikijs/transformers");
  const { codeToHtml } = shiki as unknown as typeof import("shiki");

  // Keep this stable and light: major languages only; unknown falls back to plain code.
  const langAliases: Record<string, string> = {
    js: "javascript",
    javascript: "javascript",
    ts: "typescript",
    typescript: "typescript",
    jsx: "jsx",
    tsx: "tsx",
    json: "json",
    jsonc: "jsonc",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    md: "markdown",
    markdown: "markdown",
    mdx: "mdx",
    py: "python",
    python: "python",
    java: "java",
    kt: "kotlin",
    kotlin: "kotlin",
    scala: "scala",
    groovy: "groovy",
    c: "c",
    h: "c",
    cc: "cpp",
    cpp: "cpp",
    cxx: "cpp",
    hpp: "cpp",
    objc: "objective-c",
    "objective-c": "objective-c",
    "objective-cpp": "objective-cpp",
    "c#": "csharp",
    csharp: "csharp",
    go: "go",
    rs: "rust",
    rust: "rust",
    swift: "swift",
    dart: "dart",
    sh: "bash",
    shell: "bash",
    bash: "bash",
    zsh: "bash",
    ps1: "powershell",
    powershell: "powershell",
    rb: "ruby",
    ruby: "ruby",
    php: "php",
    pl: "perl",
    perl: "perl",
    lua: "lua",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    xml: "xml",
    ini: "ini",
    dockerfile: "dockerfile",
    makefile: "make",
    make: "make",
    sql: "sql",
    diff: "diff",
    graphql: "graphql",
    regex: "regex"
  };

  const toClass = transformerStyleToClass({ classPrefix: "__shiki_" }) as TransformerStyleToClass;

  const md = new (MarkdownItCtor as unknown as typeof MarkdownIt)({
    html: false,
    linkify: true,
    breaks: true,
    typographer: false
  });

  // Keep only safe protocols.
  md.validateLink = (url) => {
    const s = String(url || "").trim().toLowerCase();
    if (!s) return false;
    if (s.startsWith("http://") || s.startsWith("https://")) return true;
    return false;
  };

  const originalFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const tok = tokens[idx];
    const info = String(tok.info || "").trim();
    const lang = info.split(/\s+/)[0] || "";
    const code = String(tok.content || "");

    const e = env as any;
    if (!e.__fences) e.__fences = [] as Fence[];
    const fences = e.__fences as Fence[];
    const id = fences.length;
    fences.push({ lang, code });

    return `<div class="shiki-placeholder" data-shiki-id="${id}"></div>`;
  };

  async function render(text: string): Promise<RenderResult> {
    const input = String(text || "");
    if (!input.trim()) return { html: "", shikiCss: "" };

    const env: any = {};
    const html = md.render(input, env);

    const fences: Fence[] = Array.isArray(env.__fences) ? env.__fences : [];
    if (fences.length === 0) {
      const css = (toClass as any).getCSS ? String((toClass as any).getCSS() || "") : "";
      return { html, shikiCss: css };
    }

    let out = html;
    for (let i = 0; i < fences.length; i++) {
      const f = fences[i];
      const langKey = String(f.lang || "").trim().toLowerCase();
      const lang = langAliases[langKey] || langKey || "text";
      let codeHtml = "";
      try {
        codeHtml = await codeToHtml(f.code, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
          transformers: [toClass]
        });
      } catch {
        const escaped = escapeHtml(f.code);
        codeHtml = `<pre class="shiki"><code>${escaped}</code></pre>`;
      }
      codeHtml = wrapCodeBlockHtml(codeHtml, f.code);
      const placeholder = `<div class="shiki-placeholder" data-shiki-id="${i}"></div>`;
      out = out.split(placeholder).join(codeHtml);
    }

    const css = (toClass as any).getCSS ? String((toClass as any).getCSS() || "") : "";
    return { html: out, shikiCss: css };
  }

  return { render };
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapCodeBlockHtml(codeHtml: string, rawCode: string): string {
  const codeB64 = encodeBase64Utf8(rawCode);
  return `<div class="shiki-block"><button class="shiki-copy-button" type="button" data-code-b64="${codeB64}" aria-label="Copy code">Copy</button>${codeHtml}</div>`;
}

function encodeBase64Utf8(text: string): string {
  return Buffer.from(String(text || ""), "utf8").toString("base64");
}
