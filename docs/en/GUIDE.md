# ChatToHarness User Guide

[English](../en/GUIDE.md) | [简体中文](../zh-CN/GUIDE.md) | [日本語](../ja/GUIDE.md)

**Connect AI chat to your local harness.**

ChatToHarness is a desktop console that lets supported clients use local files, terminals, Git, and development tools through a secure tunnel. Applicable project instructions are delivered before tool operations.

[Documentation](README.md) · [Website and downloads](https://dj-huang.github.io/ChatToHarness/) · [Releases and checksums](https://github.com/DJ-Huang/ChatToHarness/releases) · [Clients](CLIENTS.md) · [Architecture](ARCHITECTURE.md) · [Verification](VERIFICATION.md) · [Release maintenance](RELEASING.md)

## Installation and use

Supported targets are macOS 14+ on Apple Silicon and Windows 11 x64. Installers include Node, the Tunnel runtime, and Desktop Commander; a separate development environment is not required. Read the signing status in the corresponding Release before installing. Default builds are unsigned on Windows and ad-hoc signed without notarization on Mac, so the operating system may warn or block installation.

1. Download the matching `.dmg` or `-setup.exe` from a published Release, install it, and open the application.
2. Create or select a Tunnel in the [service console](https://platform.openai.com/settings/organization/tunnels) and prepare a Runtime API Key. The relevant organization or workspace must have permission to use the tunnel.
3. Enter the Tunnel ID and Runtime API Key in **Connection settings** (连接配置). In **Work directories** (工作目录), select the folders that file tools may access.
4. Choose **Save and connect** (保存并连接). After local checks succeed and the status is **Tunnel ready** (通道就绪), follow **Connection and help** (接入与帮助) to configure the client.
5. Start with a read-only client request, then verify writing and reading in a dedicated temporary directory.

The application interface currently uses Chinese; the labels above identify the corresponding controls. Documentation language does not change the interface language.

Do not send API keys in chat or commit them to the repository. The application saves only system-encrypted credentials, reports only whether a key is saved, and clears the key input after saving. Only the Tunnel receives the Runtime API Key; tool processes do not. API callers need separate credentials.

Closing the window keeps the application running in the background. Left-click the system tray/menu bar icon to open the window; right-click for connection, stop, logs, and quit actions. **Stop connection** disconnects the tunnel; **Quit ChatToHarness** cleans up managed processes and exits. Launching again restores the existing window. Starting at login is disabled by default.

**Tunnel ready** confirms the tunnel and local tools are available. It does not confirm that a client has been configured or has successfully called a tool.

## Automatic project instructions

This feature is enabled by default. Give the client a task and its project directory. Before file, search, write, or terminal operations, the proxy requires project context:

- Read `AGENTS.md` from the project root through the target directory. Lowercase `agents.md` is supported, and conflicting candidates produce an explicit error.
- Index Markdown paths and titles under the root `rules/` directory. The client selects relevant bodies; project-local rule files referenced by AGENTS are also supported.
- Carry a context token on every operation. Reload after instructions change, when entering a new scope, or for another project. Chats do not share a global “current project.”

Returned rule bodies have a combined 64 KiB limit per context request. Out-of-project references, unreadable files, and oversized bodies are reported instead of silently skipped. Projects without rule files work normally. The program enforces delivery; the model remains responsible for understanding and following the instructions. Other products' dedicated rule directories are not inherited automatically.

Folder settings **do not sandbox the terminal**. Commands run with the current user's permissions and real user environment. Start long builds, Unity commands, and similar tasks in the background and read their output incrementally. Reconnecting does not replay tool operations.

## One-click source launcher

Double-click `Start.command` on Mac or `Start.cmd` on Windows. The first launch prepares locked dependencies and builds the application; later launches reuse it. Initial setup needs network access to download pinned components. Normal application startup does not check for dependency updates.

Development and builds use Node 24.22.0:

```sh
npm ci
npm test
npm run build
npm run dist
```

`build` produces an unpacked native application; `dist` produces a DMG or NSIS installer. Build on the matching operating system and architecture. Do not copy Mac dependency directories into Windows builds. CI performs native build and installation checks on Mac arm64 and Windows x64.

## Configuration and compatibility

Existing LocalHarness data on Mac remains in `~/Library/Application Support/LocalHarness`. The internal identifier and keychain namespace are preserved across the rename. The system may request authorization again. If decryption fails, the original file is retained and the key can be entered again in the application. Windows uses its system user-data directory. Tests override storage with temporary directories rather than using personal settings.

Application settings, tool configuration, and logs stay in the private data directory. The real HOME/USERPROFILE is preserved so Git, SSH, and development tools keep using existing user settings. Do not add a local stdio or local HTTP client entry: external client access uses the existing Tunnel only.

## Troubleshooting

| Symptom | Recovery |
| --- | --- |
| Tool component check fails | Open logs; prepare components again with the source launcher, or reinstall the package for the matching system. |
| Saved key cannot be read or system authorization is pending | Authorize in the system dialog. If it still fails, enter the key again without deleting the original settings file. |
| Credential or permission error | Check the Runtime API Key, Tunnel associations, and Read + Use permissions, then reconnect. |
| Network interruption | The application retries with backoff. You can reconnect or stop manually; tool operations are not replayed. |
| Client cannot see the tunnel | Check organization/workspace associations, keep the application running, and confirm Tunnel ready. |
| Project context expired | Have the client reload the instructions, then explicitly retry the operation. |
| Windows blocks installation | Verify the source, SHA-256, and Release signing notes. Production signing requires the maintainer's certificate. |

Use **View logs** (查看日志) to open the log directory. Redact support materials; do not include keys, complete environment dumps, or private project content.

## Open source and maintenance

MIT License. See [third-party notices](THIRD_PARTY_NOTICES.md) and the [license](LICENSE.md). The public repository excludes credentials, machine settings, logs, chat records, dependencies, and build outputs. Installers are distributed through GitHub Releases; the website does not collect credentials.
