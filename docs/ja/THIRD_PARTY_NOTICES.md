# 第三者コンポーネント

[English](../en/THIRD_PARTY_NOTICES.md) | [简体中文](../zh-CN/THIRD_PARTY_NOTICES.md) | [日本語](../ja/THIRD_PARTY_NOTICES.md)

ChatToHarness は正式リリースされた Desktop Commander の npm パッケージを使用し、そのツールを独自に再実装するものではありません。

| コンポーネント | 固定バージョン | 上流プロジェクト | ライセンス |
| --- | --- | --- | --- |
| Node.js | 24.22.0 | https://nodejs.org/ | MIT および同梱依存関係のライセンス |
| OpenAI Tunnel client runtime | 0.0.16 | https://github.com/openai/tunnel-client | 上流リリースのライセンス報告を参照 |
| Desktop Commander | 0.3.0 | https://github.com/wonderwhy-er/DesktopCommanderMCP | MIT および同梱依存関係のライセンス |
| Electron | 44.7.2 | https://www.electronjs.org/ | MIT、Chromium、および同梱依存関係のライセンス |
| electron-builder（ビルド専用） | 26.15.3 | https://github.com/electron-userland/electron-builder | MIT |

パッケージには Electron のライセンスファイルと、`resources/licenses`（Windows）または `Contents/Resources/licenses`（Mac）が含まれます。このディレクトリには Node.js の通知、公式 Tunnel runtime のライセンス報告、Desktop Commander 依存関係の通知を収録します。依存パッケージ内のライセンス原文も保持します。

Desktop Commander には、ChatToHarness 用のビルド時修正が 1 か所あります。`dist/config.js` は設定を `~/.claude-server-commander` に置く代わりに、絶対パスの `LOCALHARNESS_DC_HOME` を要求します。ビルドは修正前に元の式との完全一致を確認します。実際のユーザー `HOME` は変更しません。修正処理はリポジトリの `scripts/prepare-resources.cjs` に記載しています。

リリースの取得対象はバージョンと SHA-256 で固定します。npm 依存関係はコミット済みロックファイルと npm の整合性ハッシュで固定します。Tunnel のチェックサムとライセンス報告は[公式リリース](https://github.com/openai/tunnel-client/releases/tag/v0.0.16)、Node.js のハッシュは[公式チェックサム一覧](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt)に基づきます。第三者ライセンスの原文は保持し、この説明で置き換えません。
