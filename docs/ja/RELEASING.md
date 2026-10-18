# ビルド・リリース・サイト管理

[English](../en/RELEASING.md) | [简体中文](../zh-CN/RELEASING.md) | [日本語](../ja/RELEASING.md)

リポジトリは `DJ-Huang/ChatToHarness`、既定ブランチは `main` です。Git に含めるのは、ソース、ロックファイル、コンポーネントのチェックサム、アセット、ドキュメントだけです。

## 3 つのワークフロー

- **Application checks**：PR、main のアプリ関連更新、手動実行で動きます。Windows x64 と Mac arm64 で単体チェック、ネイティブパッケージ、独立した設定での画面検証を行います。
- **Desktop installers**：`vX.Y.Z` タグまたは手動実行で動きます。両 OS のインストーラー、画面、インストールを確認し、アップロード後の検証が成功すると更新情報付きの安定版 Release を自動公開します。ブランチ指定の手動実行は Actions 成果物のみを生成し、一致するバージョンタグ指定では正式公開します。
- **Website**：main のサイト関連更新、公開 Release の変更、手動実行で動きます。PR はビルドのみでデプロイしません。Release イベントでもサイトのソースは現在の main を使います。

## バージョンの公開手順

タグを作成する前に[PR #6 のマージ監査と v0.6.0 の準備確認](../implementation/2026-10-18-pr6-release-audit.md)を確認し、記録済みの P2 課題の扱いを判断し、準備ブランチを審査して `main` にマージしてください。**準備ブランチの push や PR だけではインストーラーを公開しません**。検証済みの main に一致するバージョンタグを付けて初めてネイティブ Release ワークフローが実行されます。監査記録は公開済み成果物の証拠ではありません。



1. `package.json`、`package-lock.json` のルートバージョン、ロックファイル内のルートパッケージのバージョンをそろえて更新し、main に統合します。
2. アプリのバージョンと一致する `vX.Y.Z` タグを push します。ワークフローはバージョンの変更やタグの作成を自動では行いません。
3. 両 OS の検証完了を待ちます。公開 Release には `ChatToHarness-X.Y.Z-windows-x64-setup.exe`、`ChatToHarness-X.Y.Z-macos-arm64.dmg`、`SHA256SUMS.txt` が含まれます。
4. ファイルサイズと SHA-256 の確認後に自動公開します。ビルドやアップロードの失敗時は、不完全な版を公開しません。
5. Website が公開済み安定版からダウンロードリンクを更新します。公開版がない間は未公開と表示し、草稿とプレリリースは対象にしません。

失敗した場合はソースを修正して再試行できます。公開済みの成果物は上書きせず、新しいバージョンを作成します。アップロード後にサイズと SHA-256 を照合します。GitHub API やダウンロードの失敗は処理を中断し、「リリースが存在しない」として扱ってはいけません。

## 署名設定

既定は Windows が未署名、Mac がアドホック署名のみで Apple 公証なしです。Release Notes にこの状態を明記します。手動実行の `signed` を有効にする場合、以下が必要です。

- Windows：`WINDOWS_CSC_LINK`、`WINDOWS_CSC_KEY_PASSWORD`。
- Mac：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。

証明書とパスワードはリポジトリの Actions Secrets のみに保存し、ソースには含めません。正式署名モードでは不足する設定があれば失敗させます。Mac の署名と公証も確認します。証明書を追加しただけでは既定のビルド方式は変わりません。

## サイト

Pages Source を GitHub Actions に設定します。デプロイは `github-pages` 環境を使用し、必要最小限の権限で実行します。本番サイトのビルドとデプロイは順番に実行します。Release の公開でサイトを更新できるよう、環境で main とバージョンタグを許可してください。

静的ソースは `site/`、出力先は `dist/site/` です。`node scripts/build-site.cjs` が GitHub の公開済み安定版を読み取り、リポジトリのサブパスに対応し、インストーラーを Releases に直接リンクします。オフライン確認には `--fixture tests/fixtures/no-releases.json` を使います。

アプリのスクリーンショットは検証用の独立した設定で撮影し、実際の Tunnel ID、キー、ユーザー名、プロジェクト内容を隠します。サイトに認証情報の入力・保存機能は設けません。3 言語の文書内容をそろえ、サイトから対応する言語へ案内してください。

CI は模擬トンネルと一時データディレクトリのみを使用します。個人の Tunnel を CI や別の端末で同時実行してはいけません。実際のクライアントを使うエンドツーエンド検証は [VERIFICATION.md](VERIFICATION.md) に別途記録します。

アプリとサイトの翻訳は同時に保守してください。表示変更後は、独立した認証情報と模擬トンネルで3言語の画像を撮り直します。画面確認ではページ・言語ごとに画像を出力します。

Release Notes は GitHub が生成する変更一覧と、任意の `release-notes/vX.Y.Z.md` を組み合わせます。手書きの説明は3言語で用意してください。草稿は非公開アップロード段階だけに使用し、検証後は自動公開します。`GITHUB_TOKEN` によるイベントは通常の release ワークフローを起動しないため、公開後に Website を直接呼び出します。[GitHub の説明](https://docs.github.com/en/actions/concepts/security/github_token)を参照してください。個人トークンは不要です。
