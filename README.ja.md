# Nitori Codex Webview

ローカルの `codex app-server`（stdio / JSON-RPC）に接続する、軽量な Webview チャット UI を VS Code 上で提供する拡張です。アバター/背景の差し替えや、Codex 風のタスク選択 UI で作業履歴の切り替えができます。

English: `README.md`

## 主な機能

- Codex 風の **タスク選択 UI**（タスク一覧/切り替え）
- メッセージ内で **コマンド実行** や **編集済みファイル / diff** を見やすく表示
- 実行中は送信ボタンが停止ボタンに変わり **中断（Interrupt）** が可能
- **sandbox / approval** の切り替え（安全性と操作性のトレードオフ）
- **モデル選択** と **推論強度（reasoning effort）** の切り替え
- ヘッダーを最小化し、**レート/利用状況** は入力欄まわりに集約

## インストール（VSIX）

1. `.vsix` ファイルを用意します（例: `nitori-codex-webview-0.0.6.vsix`）。
2. インストールします:

```bash
code --install-extension path/to/nitori-codex-webview-0.0.6.vsix
```

## 使い方

- アクティビティバーの `Nitori` → `Nitori Codex` を開く
- もしくはコマンドパレットから `Nitori: Open Codex Webview`（エディタパネルで開く）

## 必要要件

- ローカルに `codex` CLI がインストールされていること
- `codex` が PATH にない場合や、実行ファイルを固定したい場合は、設定 `nitoriCodex.codexPath` でパスを指定できます

## 仕組み（採用担当・レビュー向けに最短で）

- **Extension Host** がローカルの Codex プロセス（`codex app-server`）を起動/制御し、Webview からの要求を中継します
- **Webview** はチャット UI を描画し、VS Code のメッセージング API 経由で拡張側にイベントを送ります
- 基本構成では **外部の専用バックエンド不要**（ローカルの `codex` に接続）

## 安全性 / 権限について（採用担当・レビュー向けの補足も兼ねる）

この拡張は「UI（Webview）でローカルの Codex app-server を操作する」構成です。実際に何ができるかは、選択しているポリシーに依存します。

- **Sandbox**: ローカル環境へのアクセス範囲（安全寄り/強力寄りの調整）
- **Approval**: ツール実行などを都度確認するかどうか
- たとえば強い権限（フルアクセス寄り）を選ぶと、より強力な操作が可能になります。ローカルでスクリプトを実行するのと同程度に、設定と扱いには注意してください。

## 開発者向け（任意）

```bash
npm install
npm run build
```

VS Code 上で `F5`（Extension Development Host）を起動し、`Nitori` → `Nitori Codex` を開いて確認します。
