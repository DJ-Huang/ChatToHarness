# Understand connection status, reconnect and stop

[English](../en/connection-status.md) | [简体中文](../zh-CN/connection-status.md) | [日本語](../ja/connection-status.md)

> For ChatToHarness 0.6.0.

## Your goal

Use Overview to decide what to do next and stop accepting requests when needed.

## Before you start

Open Overview and read the status badge and main connection card.

## Steps

1. Not configured: complete folders or tool services, tunnel details and key.
2. Checking or connecting: wait for checks and connection; respond to any system authorization window.
3. Tunnel ready: verify a real client call. The app does not treat this state as proof of client success.
4. Reconnecting: network failures retry automatically; you may also reconnect manually.
5. Stop: use Stop connection in the app or tray to stop the tunnel and managed tool services.

![Understand connection status, reconnect and stop](../images/help/en/overview.png)

1 Connection state; 2 Feature navigation; 3 First-call checklist. Interface demonstration using the current repository UI and isolated sample data; not evidence of a live tunnel or tool call.

## What success looks like

The stopped state lets you connect again later. Reconnecting does not automatically replay previous tool calls.

## If it does not work

Repeated connection clicks do not safely retry file writes or commands. Persistent tasks may continue and require explicit cancellation. Closing the window hides the app in the background; quitting is a separate action.

## Next steps

- [Fix connection failures or repeated reconnects](connection-problems.md)
- [Start, inspect and cancel background tasks](background-tasks.md)
