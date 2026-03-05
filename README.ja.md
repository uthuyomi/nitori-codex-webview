# Nitori Codex Webview

ローカルの `codex app-server`（stdio / JSON-RPC）と接続して動く、VS Code 用の軽量 Webview チャット UI です。UI は “Codexっぽさ” を意識しつつ、実処理はあなたのマシン上の Codex CLI を使います。

English: `README.md`

## 主な機能

- Codex ライクな **タスクピッカー**（タスク作成 / 選択）
- **コマンド実行**や**編集ファイル / diff**を見やすく表示
- 実行中の処理を **Interrupt（停止）**
- **Sandbox mode** と **Approval policy** をすばやく切り替え
- **モデル選択** / **reasoning effort** の選択
- コンポーザー付近に **usage / rate** の状態表示

## インストール

### VS Code Marketplace から

- Marketplace で `Nitori Codex Webview` を検索
- もしくは拡張IDでインストール:

```bash
code --install-extension kaisei-yasuzaki.nitori-codex-webview
```

### VSIX から

```bash
code --install-extension path/to/nitori-codex-webview-0.0.35.vsix
```

## 使い方（最短）

1. ターミナルで `codex` コマンドが実行できる状態にします。
2. VS Code のアクティビティバーで `Nitori` → `Nitori Codex` を開きます。
3. またはコマンドパレットから `Nitori: Open Codex Webview` を実行します。

## 必要条件

- VS Code `^1.109.0`
- ローカルの `codex` CLI（拡張が `codex app-server` を起動します）

## 設定

- `nitoriCodex.codexPath`: `codex` 実行ファイルへのパス（`PATH` に無い場合や、特定のビルドに固定したい場合）
- `nitoriCodex.verboseEvents`: 内部イベントをチャットに表示（ノイズ/負荷が増えます）

## 仕組み（ざっくり）

- **Extension Host** がローカルで `codex app-server` を起動・制御し、メッセージを仲介します。
- **Webview UI** がチャット表示を行い、VS Code のメッセージングAPI経由で拡張へイベントを送ります。
- この拡張自体はホスト型バックエンドを持ちません。

## セキュリティ上の注意

この拡張は「ローカルのエージェントプロセスを操作するUI」です。実際に何ができるかは UI で選ぶポリシーに依存します。

- **Sandbox mode**: ローカル環境へのアクセス範囲（コマンド/ツールの権限）に影響します。
- **Approval policy**: 実行前に確認を挟むかどうかを制御します。
- 危険な設定（例: フルアクセス）にした場合は、その権限でローカルスクリプトを動かすのと同等だと考えてください。

## トラブルシュート

- `disconnected` のままなら、ターミナルで `codex` が動くか確認し、必要なら `nitoriCodex.codexPath` を設定してください。
- UI は出るのに動かない場合は、VS Code の **出力** から拡張のログを確認してください。

## 開発

```bash
npm install
npm run build
```

VS Code で `F5` を押して Extension Development Host を起動し、`Nitori` → `Nitori Codex` を開きます。

## ライセンス

MIT（`LICENSE` を参照）。

## 免責

本プロジェクトは非公式のファンメイドであり、上海アリス幻樂団 / ZUN 氏とは一切関係ありません。承認・推薦を受けたものでもありません。
東方Projectは上海アリス幻樂団 / ZUN 氏の商標・著作物です。
