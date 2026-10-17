# ビルド・リリース・サイト管理

[English](../en/RELEASING.md) | [简体中文](../zh-CN/RELEASING.md) | [日本語](../ja/RELEASING.md)

リポジトリは `DJ-Huang/ChatToHarness`、既定ブランチは `main` です。Git に含めるのは、ソース、ロックファイル、コンポーネントのチェックサム、アセット、ドキュメントだけです。

## 3 つのワークフロー

- **Application checks**：PR、main のアプリ関連更新、手動実行で動きます。Windows x64 と Mac arm64 で単体チェック、ネイティブパッケージ、独立した設定での画面検証を行います。
- **Desktop installers**：`vX.Y.Z` タグまたは手動実行で動きます。両 OS のインストーラーを生成し、実際の画面とインストールを確認した後、草稿を作成します。ブランチを指定した手動実行は Actions 成果物のみを生成します。Release 草稿を作る場合は既存のバージョンタグを選択します。
- **Website**：main のサイト関連更新、公開 Release の変更、手動実行で動きます。PR はビルドのみでデプロイしません。Release イベントでもサイトのソースは現在の main を使います。

## バージョンの公開手順

1. `package.json`、`package-lock.json` のルートバージョン、ロックファイル内のルートパッケージのバージョンをそろえて更新し、main に統合します。
2. アプリのバージョンと一致する `vX.Y.Z` タグを push します。ワークフローはバージョンの変更やタグの作成を自動では行いません。
3. 両 OS の検証完了を待ちます。草稿には `ChatToHarness-X.Y.Z-windows-x64-setup.exe`、`ChatToHarness-X.Y.Z-macos-arm64.dmg`、`SHA256SUMS.txt` が含まれます。
4. ビルド結果、署名状態、実際の検証記録を確認したうえで、GitHub 上で草稿を正式公開します。
5. Website が公開済み安定版からダウンロードリンクを更新します。公開版がない間は未公開と表示し、草稿とプレリリースは対象にしません。

失敗した場合はソースを修正して再試行できます。公開済みの成果物は上書きせず、新しいバージョンを作成します。アップロード後にサイズと SHA-256 を照合します。GitHub API やダウンロードの失敗は処理を中断し、「リリースが存在しない」として扱ってはいけません。

## 署名設定

既定は Windows が未署名、Mac がアドホック署名のみで Apple 公証なしです。草稿にこの状態を明記します。手動実行の `signed` を有効にする場合、以下が必要です。

- Windows：`WINDOWS_CSC_LINK`、`WINDOWS_CSC_KEY_PASSWORD`。
- Mac：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。

証明書とパスワードはリポジトリの Actions Secrets のみに保存し、ソースには含めません。正式署名モードでは不足する設定があれば失敗させます。Mac の署名と公証も確認します。証明書を追加しただけでは既定のビルド方式は変わりません。

## サイト

Pages Source を GitHub Actions に設定します。デプロイは `github-pages` 環境を使用し、必要最小限の権限で実行します。本番サイトのビルドとデプロイは順番に実行します。Release の公開でサイトを更新できるよう、環境で main とバージョンタグを許可してください。

静的ソースは `site/`、出力先は `dist/site/` です。`node scripts/build-site.cjs` が GitHub の公開済み安定版を読み取り、リポジトリのサブパスに対応し、インストーラーを Releases に直接リンクします。オフライン確認には `--fixture tests/fixtures/no-releases.json` を使います。

アプリのスクリーンショットは検証用の独立した設定で撮影し、実際の Tunnel ID、キー、ユーザー名、プロジェクト内容を隠します。サイトに認証情報の入力・保存機能は設けません。3 言語の文書内容をそろえ、サイトから対応する言語へ案内してください。

CI は模擬トンネルと一時データディレクトリのみを使用します。個人の Tunnel を CI や別の端末で同時実行してはいけません。実際のクライアントを使うエンドツーエンド検証は [VERIFICATION.md](VERIFICATION.md) に別途記録します。
