# クライアント接続

[English](../en/CLIENTS.md) | [简体中文](../zh-CN/CLIENTS.md) | [日本語](../ja/CLIENTS.md)

処理経路は、クライアント → Secure MCP Tunnel → ChatToHarness MCP ゲートウェイ → 組み込みツールプロキシまたは許可済み外部 MCP サービスです。先に ChatToHarness でトンネル設定を保存し、「トンネル準備完了」を確認します。組み込みファイルツールを使う場合は作業ディレクトリも選びます。同じ Tunnel のローカル stdio runtime は 1 つだけ動かし、別のツールから 2 つ目を起動しないでください。

## アプリで共有するツール

ChatToHarness の **MCP Servers** 画面で下流サービスを追加し、コマンド／URL を信頼して各ツールを許可します。Unity やブラウザーを個別 Agent に別途設定する必要はありません。アプリが接続を管理し、同じ Tunnel の呼び出し元は同じ許可済みツール一覧を使います。外部ツールは `serverId__toolName`、組み込みツールは従来の名前です。通信方式、秘密情報、インポート／エクスポートは [MCP Servers ガイド](GUIDE.md#mcp-servers)を参照してください。

接続追加とリスト変更通知はゲートウェイを更新しますが、既存チャットが直ちに再検出する保証はありません。必要に応じてクライアント側のツール一覧を更新してください。追加・変更ツールはローカル許可を待ちます。毎回のローカル承認とクライアント独自の確認規則は別々に適用し、ゲートウェイの期限（既定 60 秒、最大 90 秒）内に完了する必要があります。再接続で呼び出しを再実行しません。送信後に応答を失った場合、対象の状態を確認してから再試行を判断してください。メッセージの上限は 8 MiB です。

### ネイティブ MCP Resources／Prompts とフォールバック（v0.6.0）

対応クライアントが機能をネゴシエートすると、`resources/list`、`resources/templates/list`、`resources/read`、`prompts/list`、`prompts/get` で**有効かつ信頼済み**の下流サービスのコンテンツを利用できます。URI はサービス単位に名前空間を分離し、プロンプト名には `server::name` を使用します。ツールのみのクライアントでは `mcp_list_resources`、`mcp_read_resource`、`mcp_list_prompts`、`mcp_get_prompt` を利用します。

リソース購読、completion、sampling、elicitation、完全な MCP Apps／GUI ホスト機能は提供しません。任意のツール結果内のリソースリンクが自動で書き換えられる保証はなく、カタログ変更後にクライアント側の手動更新が必要な場合があります。外部リソースとプロンプトは信頼済みの上位指示ではなく参照データです。コンテンツ読み取りの有効／信頼判定は、個々のツール承認とは別です。

## ChatGPT

対応するカスタム MCP 設定画面でアプリを追加し、接続方式に Tunnel を選んで同じ Tunnel ID を関連付けます。対象ワークスペースと Tunnel の関連付け、および利用者の権限を確認してください。ツール検出後、新しいタスクでプロジェクトのパスを伝え、読み取り専用の確認から始め、専用の一時ディレクトリで書き込みと読み取りを試します。

[公式トンネル接続ガイド](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

ツールの有効化、呼び出し確認、不審な説明の検査は別の事項です。不審な指示の警告が出た場合は、指摘されたメタデータと実際の引数を確認します。旧版 Harness は規約読み込みとトークン送信を繰り返し要求していました。本変更では客観的なインターフェース説明に置き換え、サーバーの検証は維持します。任意のターミナルは、その回のコマンドが読み取り専用でも、書き込み・ネットワーク利用が可能なツールとして表示します。サーバーから ChatGPT の安全検査を無効化したり、すべての確認が消えることを保証したりはできません。

実行中の Harness を更新した後、プラグインの詳細でツールを更新し、新しい説明・スキーマ・サーバー説明を取得します。ソースの編集だけでは実行中のプロセスやクライアントのツール一覧は更新されません。更新後は読み取り専用タスクで確認します。OpenAI の説明では、記憶した確認は会話内に限られる場合があり、新しい会話や再読み込み後に再確認される場合があります。[ツール管理と確認](https://developers.openai.com/api/docs/guides/custom-mcp-server)

## Codex

公式ドキュメントでは、Codex がトンネルの呼び出しに対応する製品として記載されています。使用中の製品バージョンが提供するトンネル接続またはプラグイン設定を利用し、Platform 組織の関連付けと利用権限を確認します。ChatToHarness が管理する Tunnel を再利用でき、新しい Tunnel の作成や別 runtime の起動は不要です。

Codex の製品画面、アカウント、バージョンにより設定方法は異なります。本ガイドは未検証のローカル MCP 設定を生成せず、ホストされたトンネルのアドレスを通常の公開サーバー URL として扱いません。ツール検出と実際の呼び出しが成功するまでは、「公式対応」と「この端末で検証済み」を区別してください。

[公式トンネルガイド](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) · [Codex ドキュメント](https://developers.openai.com/codex/)

## Responses API

MCP ツール定義には `tunnel_id` を使い、ホストされたトンネルのアドレスを `server_url` に指定しないでください。

```json
{
  "type": "mcp",
  "server_label": "chat_to_harness",
  "tunnel_id": "アプリに保存した Tunnel ID に置き換えてください"
}
```

この定義を Responses リクエストの `tools` 配列に入れます。モデル、入力、承認処理は呼び出し側で設定します。API 認証情報も呼び出し側で管理し、ローカルの Runtime API Key で代用しないでください。アプリのヘルプには保存済み Tunnel ID を含む定義を表示しますが、キーは含みません。

[Responses API の接続例](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#connect-from-the-responses-api)

## AgentKit

公式リリース情報では AgentKit の安全なトンネルへの対応が記載されています。アカウントと製品が実際に提供するトンネル選択画面から設定し、同じ Tunnel runtime を起動したままにします。本バージョンでは公式資料への案内を提供し、根拠のない専用設定は生成しません。

[公式リリース情報](https://developers.openai.com/api/docs/changelog) · [トンネルガイド](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

他社クライアントは現在、この製品の互換性一覧に含めていません。公式対応、アカウントでの利用可否、ツール検出成功、実際の呼び出し成功は別々の状態です。記録済みの結果は[検証記録](VERIFICATION.md)を参照してください。
