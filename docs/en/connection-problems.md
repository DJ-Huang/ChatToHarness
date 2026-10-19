# Fix connection failures or repeated reconnects

[English](../en/connection-problems.md) | [简体中文](../zh-CN/connection-problems.md) | [日本語](../ja/connection-problems.md)

> For ChatToHarness 0.6.0.

## Your goal

Separate component, credential and network issues and recover in order.

## Before you start

Open Overview and Live logs; note the current state and error time.

## Steps

1. Local check failed: inspect the installer and bundled components and use a matching official release if needed.
2. Waiting for system authorization: allow access to saved credentials in the system window, or re-enter a valid key if reading fails.
3. Authentication or access errors: check Tunnel ID, Runtime API Key, organization association and Read + Use permissions.
4. Tunnel conflict: check for another computer or tool running the same tunnel.
5. Network errors: allow automatic reconnect, then reconnect manually if necessary after recovery. Use Stop to end retries.
6. Once ready, verify a read-only client call.

![Fix connection failures or repeated reconnects](../images/help/en/connection.png)

1 Tunnel ID; 2 Local runtime key; 3 Save and connect. Interface demonstration using the current repository UI and isolated sample data; not evidence of a live tunnel or tool call.

## What success looks like

Logs show recovery, the app becomes ready and a client call returns an actual result.

## If it does not work

Reconnect does not replay operations with lost responses. If a write or command was in progress, inspect records, tasks and artifacts first. Keep keys and complete environment variables out of support reports.

## Next steps

- [Replace or clear connection credentials](credentials.md)
- [View and filter live logs](live-logs.md)
- [Find a missing tunnel or tool in your client](missing-tools.md)
