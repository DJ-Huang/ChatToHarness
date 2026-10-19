# Replace or clear connection credentials

[English](../en/credentials.md) | [简体中文](../zh-CN/credentials.md) | [日本語](../ja/credentials.md)

> For ChatToHarness 0.6.0.

## Your goal

Update the runtime key or stop using the saved tunnel credentials.

## Before you start

Work in the desktop app, without putting keys in chat or logs. Check any in-progress operations first.

## Steps

1. Open Connection settings and verify the Tunnel ID.
2. To replace the key, enter a new Runtime API Key and choose Save and connect.
3. After saving, the input clears and the app shows that the key is securely saved. Not being able to reveal the old key is normal.
4. To remove credentials, choose Clear credentials and confirm the connection stops.
5. Enter a valid key and connect again when needed.

![Replace or clear connection credentials](../images/help/en/connection.png)

1 Tunnel ID; 2 Local runtime key; 3 Save and connect. Interface demonstration using the current repository UI and isolated sample data; not evidence of a live tunnel or tool call.

## What success looks like

Replacement uses the new credentials. Clearing them stops the connection while preserving work-directory and project-instruction settings.

## If it does not work

Authorize credential access in the operating system if requested. If an old key cannot be decrypted, enter it again instead of deleting the whole data directory. Runtime and client/API credentials serve different purposes.

## Next steps

- [Fix connection failures or repeated reconnects](connection-problems.md)
- [Understand access, credentials and local records](privacy.md)
