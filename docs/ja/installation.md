# ChatToHarness をインストールする

[English](../en/installation.md) | [简体中文](../zh-CN/installation.md) | [日本語](../ja/installation.md)

> ChatToHarness 0.6.0 対象。

## 目的

パソコンに合う正式版をインストールし、コンソールを開きます。

## 始める前に

動作条件とアカウントを確認し、公式サイトから GitHub Releases を開きます。

## 操作手順

1. 公式 Release から、利用する OS 向けのインストーラーをダウンロードします。Mac は Apple シリコン用の .dmg、Windows は x64 用の -setup.exe を選びます。
2. インストーラーを開く前に、ダウンロードしたファイルを同じリリースの SHA256SUMS.txt と照合し、署名に関する説明を読みます。
3. 照合後にインストールします。Mac：.dmg を開き、アプリを「アプリケーション」にドラッグします。Windows：-setup.exe を実行し、ウィザードに従います。
4. アプリを開き、概要・接続設定・作業フォルダーなどの項目を確認します。

![ChatToHarness をインストールする](../images/help/ja/install.svg)

操作の順序を示す図です。クライアントが実際に実行した結果ではありません。

## 完了時の状態

コンソールが表示されます。インストールだけではトンネルは接続されないため、続いて接続情報を設定します。

## うまくいかない場合

v0.6.0 の Mac アプリは未公証、Windows 版は未署名のため、OS が起動を止める場合があります。配布元とチェックサムを確認してから OS の安全設定で対処し、保護機能全体は無効にしないでください。

[GitHub Releases](https://github.com/DJ-Huang/ChatToHarness/releases)

## 次のステップ

- [初めて接続する](first-connection.md)
- [インストールや起動の問題を解決する](installation-problems.md)
