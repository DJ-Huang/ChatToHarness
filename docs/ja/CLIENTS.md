# クライアント接続

[English](../en/CLIENTS.md) | [简体中文](../zh-CN/CLIENTS.md) | [日本語](../ja/CLIENTS.md)

処理経路は、クライアント → Secure MCP Tunnel → ローカルツールプロキシ → Desktop Commander です。先に ChatToHarness を開き、作業ディレクトリとトンネル設定を保存して「通道就绪」を確認します。同じ Tunnel に対して、ローカル stdio runtime は 1 つだけ動かしてください。別のツールから 2 つ目の runtime を起動しないでください。

## ChatGPT

対応するカスタム MCP 設定画面でアプリを追加し、接続方式に Tunnel を選んで同じ Tunnel ID を関連付けます。対象ワークスペースと Tunnel の関連付け、および利用者の権限を確認してください。ツール検出後、新しいタスクでプロジェクトのパスを伝え、読み取り専用の確認から始め、専用の一時ディレクトリで書き込みと読み取りを試します。

[公式トンネル接続ガイド](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

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
