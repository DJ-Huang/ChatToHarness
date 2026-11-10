# Resolve folder, credential or tool permission errors

[English](../en/permission-problems.md) | [简体中文](../zh-CN/permission-problems.md) | [日本語](../ja/permission-problems.md)

> The plugin navigation below matches the [ChatToHarness v0.8.1](https://github.com/DJ-Huang/ChatToHarness/releases/tag/v0.8.1) interface.

## Your goal

Identify which permission layer blocked an operation and fix it in the right place.

## Before you start

Keep the exact error and distinguish app, operating-system, service and client approvals.

## Steps

1. Folder denied: add the target in Work directories, save and check the absolute path and resolved link target.
2. Saved key unreadable: handle the system authorization prompt or re-enter the key in the app.
3. External authentication failed: open **Plugins**, click **Manage** on the target external MCP service card, then switch to **Connection settings** to check that service’s environment or header credentials.
4. Tool disabled or untrusted: review the service’s source in **Overview & permissions** in the same management panel. Connect only after confirming you trust it, then set individual tool permissions for the current task.
5. Local approval expired: check whether execution started before sending a new reviewed request and approving it promptly.
6. ChatGPT still asks: review the independent client confirmation there.

![Resolve folder, credential or tool permission errors](../images/help/en/mcp-approval.png)

1 Inspect arguments; 2 Remembered scope; 3 Deny or allow. Earlier interface demonstration with isolated sample data; follow the steps above for the v0.8.1 menus and management panel. This image is not evidence of a live tunnel or tool call.

## What success looks like

Adjust only the relevant permission and verify using a suitable read-only call.

## If it does not work

Calls without an applicable project may not offer remembered project approval. Configuration or tool changes may require fresh permission. Do not use chat tools to change the folder allowlist or expose all personal folders to solve one failure.

## Next steps

- [Edit, enable, stop and remove services](manage-services.md)
- [Manage work directories and project instructions](work-directories.md)
- [Manage tool permissions and local approval](tool-permissions.md)
- [Replace or clear connection credentials](credentials.md)
