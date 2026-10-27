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

Open Proxy configuration beside automatic connection to choose direct, system or manual proxy mode. Manual mode supports HTTP, HTTPS and SOCKS5 with separate server and port fields. Bypass addresses accept domains, IPs and CIDR ranges. Defaults include local addresses, common private ranges and the actual subnets of current network adapters. Restore default addresses after changing networks. Save proxy settings, then reconnect; tunnel credentials are not required to save. These settings apply to the secure tunnel and do not modify operating system proxy settings.

The connection modes are radio choices. Manual proxies support optional username/password authentication (Basic for HTTP/HTTPS, username/password for SOCKS5). Proxy passwords are automatically encrypted and saved using operating-system secure storage. Leave the password field untouched to keep an existing credential; to remove it, edit the password field and clear it before saving. Blank preserves an available password; changing the server or username requires a new password. System mode does not inherit saved system passwords. Local and LAN bypass checkboxes add their corresponding address ranges. Test connection uses the draft without saving and requires no Runtime API Key; an HTTP 401/403 from the destination proves connectivity, not business authorization. Save applies the configuration for the next connection; Cancel discards the proxy draft and clears password input.

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
