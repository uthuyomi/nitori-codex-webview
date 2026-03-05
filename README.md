# Nitori Codex Webview

A lightweight VS Code Webview chat UI for the local `codex app-server` (stdio JSON-RPC). It’s designed to feel like Codex, while running everything through your local Codex CLI.

Japanese: `README.ja.md`

## Features

- Codex-like **task picker** (create / select tasks)
- Rich message blocks for **command execution** and **edited files / diffs**
- **Interrupt** in-progress work (stop button while the agent is running)
- Quick controls for **sandbox mode** and **approval policy**
- **Model selection** and **reasoning effort** selection
- Shows **usage / rate** status near the composer

## Install

### From VS Code Marketplace

- Search for: `Nitori Codex Webview`
- Or install by ID:

```bash
code --install-extension kaisei-yasuzaki.nitori-codex-webview
```

### From a VSIX

```bash
code --install-extension path/to/nitori-codex-webview-0.0.35.vsix
```

## Quick start

1. Ensure the `codex` CLI is installed and runnable from a terminal.
2. In VS Code, open the Activity Bar view container: `Nitori` → `Nitori Codex`.
3. Or open an editor panel from Command Palette: `Nitori: Open Codex Webview`.

## Requirements

- VS Code `^1.109.0`
- A local `codex` CLI installation (the extension starts `codex app-server`)

## Configuration

Settings:

- `nitoriCodex.codexPath`: Path to the `codex` executable (use this if `codex` is not in `PATH` or you want to pin a specific build).
- `nitoriCodex.verboseEvents`: Show verbose internal events in the chat (can be noisy/slow).

## How it works (high level)

- **Extension Host** starts/controls a local Codex process (`codex app-server`) and proxies messages.
- **Webview UI** renders the chat and sends UI events to the extension via VS Code messaging APIs.
- No hosted backend is required by this extension itself.

## Security notes

This extension is a UI wrapper around a local agent process. Actual capabilities depend on what you enable in the UI:

- **Sandbox mode** affects what local commands/tools can do.
- **Approval policy** controls whether actions require your confirmation.
- If you choose an unsafe configuration (e.g. full access), treat it like running local scripts with that level of privilege.

## Troubleshooting

- If it stays on `disconnected`, verify `codex` runs in a terminal, or set `nitoriCodex.codexPath`.
- If the UI loads but nothing happens, open **Output** → the extension’s output channel and check logs.

## Development

```bash
npm install
npm run build
```

Press `F5` in VS Code to launch an Extension Development Host, then open `Nitori` → `Nitori Codex`.

## License

MIT (see `LICENSE`).

## Disclaimer

This is an unofficial fan-made project and is not affiliated with or endorsed by Team Shanghai Alice / ZUN.
Touhou Project is a trademark and/or copyrighted work of Team Shanghai Alice / ZUN.
