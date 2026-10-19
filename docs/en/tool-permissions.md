# Manage tool permissions and local approval

[English](../en/tool-permissions.md) | [简体中文](../zh-CN/tool-permissions.md) | [日本語](../ja/tool-permissions.md)

> For ChatToHarness 0.6.0.

## Your goal

Choose which external tools can run and when your computer asks for confirmation.

## Before you start

Connect and trust the service, then expand Tools and permissions.

## Steps

1. Set each tool to Disabled, Allow calls or Confirm every call locally. New or changed tools are disabled by default.
2. For a pending client call, inspect the approval card at the top of the app and expand its arguments.
3. Choose this call only, remember within this project when available, or remember this tool, then allow; deny unexpected requests.
4. To revoke remembered access, restore per-call approval. Use Clear project permissions for saved project scopes.
5. The optional Allow all tools switch enables every tool of enabled, trusted services, including future tools. Turning it off restores individual policies.

![Manage tool permissions and local approval](../images/help/en/mcp-approval.png)

1 Inspect arguments; 2 Remembered scope; 3 Deny or allow. Interface demonstration using the current repository UI and isolated sample data; not evidence of a live tunnel or tool call.

## What success looks like

Only appropriately authorized tools are available. Local approval must finish within the call deadline. Closing the window does not approve a request.

## If it does not work

Configuration, definitions or project changes can invalidate remembered access. Project approval is not process isolation. Local permission does not remove ChatGPT confirmation. Changing Allow all tools can cancel affected pending requests or calls.

## Next steps

- [Trust a service and test its connection](service-trust.md)
- [Resolve folder, credential or tool permission errors](permission-problems.md)
- [Understand access, credentials and local records](privacy.md)
