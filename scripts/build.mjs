import { build, context } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const watch = process.argv.includes("--watch");

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });

const opts = {
  entryPoints: [fileURLToPath(new URL("../src/extension.ts", import.meta.url))],
  outfile: fileURLToPath(new URL("../dist/extension.js", import.meta.url)),
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: true,
  external: ["vscode"],
  logLevel: "info"
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  await copyWebviewAssets();
  // eslint-disable-next-line no-console
  console.log("watching...");
} else {
  await build(opts);
  await copyWebviewAssets();
}

async function copyWebviewAssets() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const srcToolkit = resolve(root, "node_modules", "@vscode", "webview-ui-toolkit", "dist", "toolkit.min.js");
  const dstToolkit = resolve(root, "media", "toolkit.min.js");
  if (existsSync(srcToolkit)) {
    await copyFile(srcToolkit, dstToolkit);
  }
}
