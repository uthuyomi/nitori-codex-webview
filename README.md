# Nitori Codex Webview

A VS Code extension that provides a lightweight Webview chat UI for the local `codex app-server` (stdio JSON-RPC), with a customizable avatar/background and a Codex-like task picker.

Japanese: `README.ja.md`

## Key features

- Codex-like **task picker** (task list / selection UI)
- Rich message blocks for **command execution** and **edited files / diffs**
- **Interrupt** in-progress work (stop button while the agent is running)
- Quick controls for **sandbox** and **approval** policies
- **Model selection** and **reasoning effort** selection
- Displays **usage / rate** status in the composer area (so the header stays minimal)

## Install (VSIX)

1. Get the `.vsix` file (for example: `nitori-codex-webview-0.0.6.vsix`).
2. Install it:

```bash
code --install-extension path/to/nitori-codex-webview-0.0.6.vsix
```

## Usage

- Open the Activity Bar container: `Nitori` → `Nitori Codex`
- Or open an editor panel from Command Palette: `Nitori: Open Codex Webview`

## Requirements

- Local `codex` CLI available on your machine
- Optional: set `nitoriCodex.codexPath` (Settings) if `codex` is not on PATH, or if you want to pin a specific executable.

## Architecture (quick review)

- **Extension Host**: starts/controls a local Codex process (`codex app-server`) and proxies requests.
- **Webview**: renders the chat UI and sends UI events to the extension via VS Code messaging APIs.
- **No hosted backend required**: the default setup talks to your local `codex` installation.

## Security notes (for users & reviewers)

This extension is a UI wrapper around the local Codex app-server. The actual capabilities depend on your selected policies:

- **Sandbox mode** controls how commands/tools are allowed to interact with your environment.
- **Approval policy** controls whether tool/actions require confirmation.
- If you choose an unsafe configuration (for example a full-access mode), treat it like running local scripts with that level of privilege.

## Development (optional)

```bash
npm install
npm run build
```

Then press `F5` in VS Code to launch an Extension Development Host and open `Nitori` → `Nitori Codex`.
