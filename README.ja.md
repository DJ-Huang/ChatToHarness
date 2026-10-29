<p align="center">
  <a href="https://dj-huang.github.io/ChatToHarness/ja/"><img src="site/assets/logo.png" alt="ChatToHarness ロゴ" width="160" height="160" /></a>
</p>
<h1 align="center">ChatToHarness</h1>
<p align="center">
  <a href="https://dj-huang.github.io/ChatToHarness/ja/">公式サイト・ダウンロード</a> · <a href="https://github.com/DJ-Huang/ChatToHarness/releases">GitHub Releases</a>
</p>
<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a>
</p>
<p align="center"><strong>AI チャットをローカルの実行環境へ。</strong></p>

安全なトンネルを通じて、対応する AI クライアントからローカルのファイル、ターミナル、Git、開発ツールを利用できます。ツール操作の前に、適用されるプロジェクト規約を届けます。

![ChatToHarness — どこからでも作業。チャットするだけ。](docs/images/chatharness-work-anywhere.webp)

## スクリーンショット

### アプリの概要

![アプリの概要](docs/images/help/ja/overview.png)

### 接続設定：デモ用 Tunnel ID を使用し、実際の認証情報は含みません。

![接続設定：デモ用 Tunnel ID を使用し、実際の認証情報は含みません。](docs/images/help/ja/connection.png)

### Computer Use — 実験的機能

![Computer Use の管理：操作スイッチと macOS のシステム権限](docs/images/help/ja/computer-use.png)

許可したウィンドウの画像を確認し、接続先クライアントからクリック、文字入力、スクロール、ドラッグを実行します。**プラグイン → Computer Use → 管理**で権限を確認し、内蔵機能を有効にしてください。Windows x64 と macOS arm64 に対応し、**Esc / STOP** で操作を終了できます。[設定と使い方](docs/ja/local-services.md#computer-use)

*隔離データによる macOS 画面の操作例です。操作は無効、権限は未確認で、実際のデスクトップ入力は実行していません。*

### ChatGPT

![ChatGPT — @LocalHarness](docs/images/chatgpt-plugin-ja.png)

ChatGPT：`@` で接続済みプラグインを選び、タスクとプロジェクトのパスを入力します。既存のプラグイン名は LocalHarness のままです。この画像は入力例であり、ツール呼び出しの成功を示すものではありません。

アプリの画像は独立したデモ設定で撮影しています。アプリ、サイト、文書は日本語・英語・中国語に対応しています。サイドバーの「表示言語」で即座に切り替え、接続を再起動せずに選択を保存できます。

## はじめに

ダウンロード前に、アカウントで Tunnel 対応の ChatGPT カスタム MCP または Codex の接続機能を使えることを確認してください。Tunnel の作成・編集には **Tunnels Read + Manage**、実行とクライアントでの選択には **Read + Use** が必要です。対象の Platform 組織と ChatGPT ワークスペースを関連付け、ワークスペースのカスタム MCP 権限も確認してください。[権限チェックリスト](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#permissions-and-access)

先に Release の署名情報を確認してください。現在の Windows インストーラーは未署名、Mac アプリはアドホック署名・未公証のため、OS が警告や制限を出す場合があります。ダウンロード後は `SHA256SUMS.txt` と照合してください。

1. 公開済み Release から macOS 14+ Apple Silicon または Windows 11 x64 用のインストーラーを入手します。
2. サービス管理画面で Tunnel ID と Runtime API Key を用意し、アプリに入力して作業フォルダーを選びます。
3. 保存して接続します。トンネルの準備ができたら、クライアントガイドに従って ChatGPT または Codex を接続します。
4. まず読み取り専用のタスクを試し、その後、専用の一時フォルダーでファイルの書き込みを確認します。

最初の読み取り確認では、次のように依頼します。「`get_harness_status` で実行中のバージョンを報告し、`get_project_overview` で `<プロジェクトの絶対パス>` を確認してください。ファイルは変更しないでください。」アプリで許可済みのフォルダーを指定し、クライアントに実際のツール結果が返ってから接続確認済みとします。その後、専用の一時フォルダーに新しい確認用ファイルを作成して読み戻してください。既存のプロジェクトファイルは使わないでください。クライアント側の確認はローカルアプリの権限とは独立しています。

[OpenAI Tunnel](https://platform.openai.com/settings/organization/tunnels) · [クライアント接続](docs/ja/CLIENTS.md)

## 主な機能

- Desktop Commander を介してローカルのファイル、Shell、Git、既存の開発コマンドを使用。
- 任意の AGENTS.md と共有規約の必要時読み込み。規約に問題があっても読み取りと調査は継続。
- 行コンテキスト、ページ分割、キャンセルに対応する上限付き ripgrep 検索。
- アプリ管理 MCP サービス、プロジェクト／ツール単位の承認記憶、有効かつ信頼済みのサービス向け任意の全ツール許可。
- 実行中のビルド／接続情報、Git 読み取り確認、AGENTS／Rules／Skills の索引、冪等な永続タスク、SHA 検証付きテキスト編集と復元。
- 対応クライアント向けネイティブ MCP リソース／プロンプトと読み取り用フォールバックツール。
- Windows x64 と macOS arm64 に実験的な Computer Use を内蔵し、許可したウィンドウの撮影と実際のマウス・キーボード入力に対応します。初回は無効で、保存済みの設定は引き継がれます。有効にする場合は**プラグイン → Computer Use → 管理**で権限を確認してください。macOS では画面収録とアクセシビリティの権限が必要です。ウィンドウ許可、ユーザー操作の検知、STOP / Esc を維持し、GUI の計画機能は接続先クライアントに依存します。[設定と使い方](docs/ja/local-services.md#computer-use)
- 実行結果とローカル送信状態を区別するリアルタイムログ／実行履歴、検索、容量制限、任意の時限診断。

- 手動・自動の更新確認と、整合性を検証するインストーラーのダウンロード。
- メニューバー／トレイ操作、バックグラウンド実行、認証情報の暗号化保存、ツール操作を再実行しない再接続。

フォルダー設定はターミナルのサンドボックスではありません。コマンドは現在のユーザー権限で実行されます。キーはローカルアプリにのみ入力してください。「トンネル準備完了」はクライアント呼び出しの検証完了を意味しません。

## ドキュメント

[使い方ガイド](docs/ja/README.md) · [ヘルプセンター](https://dj-huang.github.io/ChatToHarness/docs/ja/)

[利用ガイド](docs/ja/GUIDE.md) · [クライアント接続](docs/ja/CLIENTS.md) · [アーキテクチャ](docs/ja/ARCHITECTURE.md) · [ビルドとリリース](docs/ja/RELEASING.md) · [検証記録](docs/ja/VERIFICATION.md) · [第三者ソフトウェア](docs/ja/THIRD_PARTY_NOTICES.md) · [ライセンス](docs/ja/LICENSE.md)

[English](docs/en/README.md) · [简体中文](docs/zh-CN/README.md) · [日本語](docs/ja/README.md)

## 開発

Computer Use 開発資料：[Windows ネイティブ設定と検証](docs/windows-computer-use.md) · [共通タスクアーキテクチャ](docs/computer-use-agent-architecture.md)。Windows と macOS のインストーラーに内蔵プラグインを含みます。実験機能の制限は [v0.8.1 リリースノート](release-notes/v0.8.1.md) を参照してください。

[Dev.command](Dev.command)（Mac）または [Dev.cmd](Dev.cmd)（Windows）で現在のソースを直接実行します。再実行時は旧インスタンスを終了してから新コードを読み込みます。依存関係があれば `npm run dev` / `npm start` も使え、パッケージ作成は不要です。[開発ガイド](docs/ja/GUIDE.md#開発時にソースを直接実行)

Node 24.22.0 を使用し、対象と同じ OS・アーキテクチャでビルドします。

```sh
npm ci
npm run dev
npm test
npm run build
npm run dist
```

MIT ライセンス。英語の原文を正式版とし、中国語・日本語の参考訳をドキュメントに掲載しています。
