import MarkdownIt from "markdown-it";
import { codeToHtml } from "shiki";
import { transformerStyleToClass } from "@shikijs/transformers";

const toClass = transformerStyleToClass({ classPrefix: "__shiki_" });
const md = new MarkdownIt({ html: false, breaks: true, linkify: true });
md.renderer.rules.fence = (tokens, idx, options, env) => {
  const tok = tokens[idx];
  const info = String(tok.info || "").trim();
  const lang = info.split(/\s+/)[0] || "";
  const code = String(tok.content || "");
  env.__fences = env.__fences || [];
  const id = env.__fences.length;
  env.__fences.push({ lang, code });
  return `<div class="shiki-placeholder" data-shiki-id="${id}"></div>`;
};

const text = "```js\nfunction x(){return 1}\n```\n";
const env = {};
let html = md.render(text, env);
for (let i = 0; i < env.__fences.length; i++) {
  const f = env.__fences[i];
  const ph = `<div class="shiki-placeholder" data-shiki-id="${i}"></div>`;
  const codeHtml = await codeToHtml(f.code, {
    lang: "javascript",
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    transformers: [toClass]
  });
  html = html.split(ph).join(codeHtml);
}

console.log("HTML snippet:\n" + html.slice(0, 600));
console.log("\nCSS snippet:\n" + String(toClass.getCSS()).slice(0, 600));
