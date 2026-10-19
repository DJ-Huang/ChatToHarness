# Make your first connection

[English](../en/first-connection.md) | [简体中文](../zh-CN/first-connection.md) | [日本語](../ja/first-connection.md)

> For ChatToHarness 0.6.0.

## Your goal

Prepare the desktop app to receive tasks from your client.

## Before you start

Install the app and prepare your Tunnel ID, Runtime API Key and trial folder.

## Steps

1. Open Connection settings and enter the Tunnel ID. Your client will select the same tunnel.
2. Enter the Runtime API Key. After saving, the app shows only that the key is saved.
3. Open Work directories, add the trial folder and save the directory settings.
4. Return to Connection settings and choose Save and connect.
5. If the operating system requests access to saved credentials, authorize it in the system window.
6. Return to Overview and wait for the local check to pass and Tunnel ready to appear.

![Make your first connection](../images/help/en/connection.png)

1 Tunnel ID; 2 Local runtime key; 3 Save and connect. Interface demonstration using the current repository UI and isolated sample data; not evidence of a live tunnel or tool call.

## What success looks like

Tunnel ready means the computer can receive requests. Select the same tunnel in ChatGPT or Codex and make an actual tool call to finish verification.

## If it does not work

If connecting fails, check the organization, Tunnel ID and key permissions, then inspect logs. Keep only one local runtime for a tunnel; do not start a second one from another tool.

## Next steps

- [Connect ChatGPT](chatgpt.md)
- [Connect Codex](codex.md)
- [Complete your first task](first-task.md)
