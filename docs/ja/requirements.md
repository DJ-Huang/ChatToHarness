# 使い始める前の準備

[English](../en/requirements.md) | [简体中文](../zh-CN/requirements.md) | [日本語](../ja/requirements.md)

> ChatToHarness 0.6.0 対象。

## 目的

インストール前に、パソコン・アカウント・接続情報を確認します。

## 始める前に

macOS 14 以降の Apple シリコン Mac、または Windows 11 x64 のパソコンを用意します。

## 操作手順

1. アカウントに Tunnel 接続の入口があるか確認し、見当たらない場合は管理者に相談します。
2. OpenAI Platform の Tunnels でトンネルを作成または選択し、対象の組織と ChatGPT ワークスペースを関連付けます。
3. 作成・変更には Tunnels Read + Manage、実行・利用には Read + Use が必要です。
4. Tunnel ID と Runtime API Key、試用する空のフォルダーを用意します。

![使い始める前の準備](../images/help/ja/connection.png)

1 トンネル ID、2 本機の実行用キー、3 保存して接続。 現在のリポジトリの画面と隔離サンプルによる操作例です。実際の接続やツール実行の成功を示していません。

## 完了時の状態

接続先と必要な権限を確認できた状態になります。実行に必要な構成要素はインストーラーに含まれます。

## うまくいかない場合

アプリを入れるだけでアカウントの権限は増えません。Runtime API Key は本機のアプリだけに入力し、チャットには送らないでください。外部ツールには別途インストールやアカウントが必要な場合があります。

[OpenAI 公式接続ガイド](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#permissions-and-access)

## 次のステップ

- [ChatToHarness をインストールする](installation.md)
- [ChatGPT に接続する](chatgpt.md)
