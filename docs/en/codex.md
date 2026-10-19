# Connect Codex

[English](../en/codex.md) | [简体中文](../zh-CN/codex.md) | [日本語](../ja/codex.md)

> For ChatToHarness 0.6.0.

## Your goal

Use the same local workspace through the connection flow available in your Codex product.

## Before you start

Keep the desktop app running with a ready tunnel. Associate the tunnel with the organization used by your account.

## Steps

1. Open the supported Tunnel or plugin connection flow in your current Codex product. Its location varies by product, account and version.
2. Choose the same tunnel managed by the desktop app and check organization access.
3. Once tools are discovered, give an absolute project path and request a project overview first.
4. Verify an actual tool result, then follow the first-task guide to test a separate file.

![Connect Codex](../images/help/en/help.png)

1 Client connection guidance; 2 App updates. Interface demonstration using the current repository UI and isolated sample data; not evidence of a live tunnel or tool call.

## What success looks like

Codex calls a local tool and returns its result. Reuse the existing tunnel rather than starting another tunnel runtime.

## If it does not work

If the connection option is absent, consult the official guide and your administrator. Do not treat a hosted tunnel address as an ordinary server address or copy unverified local configuration. Official support alone does not verify your device.

[Official OpenAI setup guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

## Next steps

- [Complete your first task](first-task.md)
- [Find a missing tunnel or tool in your client](missing-tools.md)
