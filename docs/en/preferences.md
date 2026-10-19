# Language, automatic connection and background operation

[English](../en/preferences.md) | [简体中文](../zh-CN/preferences.md) | [日本語](../ja/preferences.md)

> For ChatToHarness 0.6.0.

## Your goal

Choose a language and understand launch, window and tray behavior.

## Before you start

Open the app. Its interface language can differ from your client’s language.

## Steps

1. Choose Chinese, English or Japanese in the sidebar language selector; the choice takes effect immediately and is remembered.
2. Set Connect automatically on launch in Connection settings, then save. This does not enable launch at system login.
3. Closing the window leaves the app running. Click its menu-bar or tray icon to reopen it.
4. Right-click the background icon for connection, stop, logs, updates and quit actions.
5. Choose Quit ChatToHarness to end the app. Launching an already running instance normally restores its window.

![Language, automatic connection and background operation](../images/help/en/overview.png)

1 Connection state; 2 Feature navigation; 3 First-call checklist. Interface demonstration using the current repository UI and isolated sample data; not evidence of a live tunnel or tool call.

## What success looks like

Changing language does not reconnect the tunnel. Closing the window does not stop requests; stop and quit are separate actions.

## If it does not work

The first language follows the system, falling back to English; saved choices take precedence afterward. Quitting cleans up managed tool processes, but independent persistent tasks require separate cancellation. Sleep or shutdown affects remote access.

## Next steps

- [Understand connection status, reconnect and stop](connection-status.md)
- [Check for updates and install a new version](updates.md)
- [Start, inspect and cancel background tasks](background-tasks.md)
