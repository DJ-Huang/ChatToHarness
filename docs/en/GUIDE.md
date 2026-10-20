> **New help center:** See the [38-topic user guide](README.md) for illustrated instructions. This earlier comprehensive guide retains its sections and links, including developer material.

# ChatToHarness User Guide

[English](../en/GUIDE.md) | [简体中文](../zh-CN/GUIDE.md) | [日本語](../ja/GUIDE.md)

**Connect AI chat to your local harness.**

ChatToHarness is a desktop console that lets supported clients use local files, terminals, Git, and development tools through a secure tunnel. Applicable project instructions are delivered before tool operations.

[Documentation](README.md) · [Website and downloads](https://dj-huang.github.io/ChatToHarness/en/) · [Releases and checksums](https://github.com/DJ-Huang/ChatToHarness/releases) · [Clients](CLIENTS.md) · [Architecture](ARCHITECTURE.md) · [Verification](VERIFICATION.md) · [Release maintenance](RELEASING.md)

## Installation and use

Supported targets are macOS 14+ on Apple Silicon and Windows 11 x64. Installers include Node, the Tunnel runtime, and Desktop Commander; a separate development environment is not required. Read the signing status in the corresponding Release before installing. Default builds are unsigned on Windows and ad-hoc signed without notarization on Mac, so the operating system may warn or block installation.

1. Download the matching `.dmg` or `-setup.exe` from a published Release, install it, and open the application.
2. Create or select a Tunnel in the [service console](https://platform.openai.com/settings/organization/tunnels) and prepare a Runtime API Key. The relevant organization or workspace must have permission to use the tunnel.
3. Enter the Tunnel ID and Runtime API Key in **Connection settings**. In **Work directories**, select the folders that file tools may access.
4. Choose **Save and connect**. After local checks succeed and the status is **Tunnel ready**, follow **Connection and help** to configure the client.
5. Start with a read-only client request, then verify writing and reading in a dedicated temporary directory.

Use **Interface language** in the sidebar to switch between English, Simplified Chinese, and Japanese immediately. The first launch follows your system language (other languages fall back to English); later launches remember your choice. Native menus, tray actions, status, help, and errors change together. The separate `preferences.json` stores language and update-check preferences and does not read or rewrite credentials or reconnect the tunnel. The website has its own language selector and remembers your browser choice.

Do not send API keys in chat or commit them to the repository. The application saves only system-encrypted credentials, reports only whether a key is saved, and clears the key input after saving. Only the Tunnel receives the Runtime API Key; tool processes do not. API callers need separate credentials.

Closing the window keeps the application running in the background. Left-click the system tray/menu bar icon to open the window; right-click for connection, stop, logs, and quit actions. **Stop connection** stops the tunnel and all managed MCP services; **Quit ChatToHarness** cleans up managed processes and exits. Launching again restores the existing window. Starting at login is disabled by default.

**Tunnel ready** confirms the tunnel and local tools are available. It does not confirm that a client has been configured or has successfully called a tool.

## MCP Servers

MCP server management is available starting with v0.5.0, through the matching installers or the source development entry point.

Configure services in **MCP Servers** in ChatToHarness. These are application settings shared by the Tunnel's clients; you do not attach each service to a particular Agent. Built-in file and terminal tools keep their existing names. Unity, browsers and other integrations connect as ordinary MCP services, without app-specific logic in ChatToHarness. No work directory is needed for third-party services; built-in file tools still require authorized folders.

1. Add a service with a stable server ID, display name and transport. `stdio` requires a command and argument list, with optional working directory, environment values and Mac/Windows overrides. Streamable HTTP requires a URL and optional static request headers. Remote URLs require HTTPS; HTTP is limited to loopback. OAuth and legacy HTTP+SSE are not supported.
2. Save credentials through the app's secret fields. System-encrypted values stay in local secret storage; service configurations and exports contain references. The app never returns saved secrets to the page. Configure only the environment values a service needs; it runs with your user permissions and is not confined by the file-tool directory list.
3. Before connecting, inspect the exact command or URL and confirm trust. Changing the launch target requires trust again. **Test connection** reuses a healthy connection; it does not call discovered tools. The preview shows connection state and negotiated protocol.
4. Set each discovered tool to disabled, direct call, or local confirmation on every call. New tools start disabled; changed definitions require authorization again. Read-only hints from a server do not grant access. A local confirmation applies only to the displayed tool, arguments and connection, and must finish within the call deadline.
5. Enable and connect the service, then refresh the tool catalog in your client if needed. External names use `serverId__toolName`, for example `unity__get_scene`. Configuration, trust and call approvals remain in the desktop app.

JSON import accepts the app's export format and common `mcpServers` configurations. Inspect the preview before importing; imported services are disabled and import never runs a command. Export omits secret values, trust decisions and tool authorizations. Re-enter missing secret values locally and authorize tools before connecting an imported service.

Disabling a service stops only that service. **Stop connection** stops the Tunnel and all managed services; closing the window keeps them in the background. Transport failures reconnect independently without repeating calls. If a forwarded call loses its reply, inspect the target application's state before retrying. Authentication, configuration and protocol errors need correction. SDK `1.32.1` cannot connect to a peer that requires only protocol `2026-07-28`.

Forwarded third-party tool calls have a default 60-second deadline and at most 90 seconds including local confirmation, with an 8 MiB serialized message limit; Harness tasks and content reads use their own bounded paths. Results may include structured content and images. Enabled, trusted MCP services now support native resources/templates and prompts for capable clients, plus four read-only fallback tools for clients that expose only tools. Resource subscriptions, completions, sampling and elicitation are not provided. Ordinary application diagnostic events redact call content; separate durable task inputs, bounded task output and execution-detail files have different retention and may contain user data. **Tunnel ready** does not establish that a newly added tool has been discovered or called by your client.

## Harness project tools and durable work (v0.6.0)

Call `get_harness_status` to inspect the **running** version, build identity, device, connection and paginated tool catalog. Tool availability does not prove a successful client call. With an authorized project directory, `get_project_overview` supplies bounded directory/Git summaries and optional AGENTS/Rules/Skills indexes; `git_status`, `git_diff` and `git_log` are project-scoped read-only Git queries. `get_file_result` returns a file SHA-256, size and bounded byte pages, and may return a small native image preview. These project tools require a directory already authorized in the app.

`get_project_context` discovers AGENTS from outer to inner scopes and can return indexes for `globs`/`paths`, `tasks`/`task_keywords` and `alwaysApply` rules. Rules match when an applicable path or keyword or always-apply condition matches. Skill directories and AGENTS references are indexed first; supply explicit `skill_paths` to load selected bodies. Delivered context and skill content share a 64 KiB budget. Tokens prove delivery and do not grant access or prove the model followed instructions. Initial writes may stop before execution to deliver new guidance.

For long shell work, pass `project_path`, a command and a stable `idempotency_key` to `start_task`, and keep the returned `task_id`. `get_task_status`, `get_task_result`, `get_task_logs`, `list_tasks` and `cancel_task` inspect or cancel that task. Successful submission **does not mean the command finished**. A disconnected client should first query the existing task; a timeout or missing worker heartbeat may leave execution **unknown**, and the command is not automatically replayed. By default tasks can run up to 24 hours (maximum seven days); up to four active tasks and 1,024 retained task identities. Durable workers are detached: **Stop, Quit and restarting the desktop app do not necessarily stop them**. Use `cancel_task` and confirm terminal status. The command validator still applies, but a project folder does not sandbox the shell.

Use `apply_project_edit` for authorized UTF-8 text: create with `expected_sha256="absent"`, or replace using the current SHA-256 and a stable idempotency key. One call writes, reopens the actual saved file, verifies its full checksum and returns up to 4 KiB of UTF-8 readback plus an undo ID. When `verification.status="matched"` and `complete=true`, use that text to confirm the write without a second read. Truncation affects only the preview; retries with the same key verify again without rewriting. `undo_project_edit` restores prior bytes only if the current file still matches the edited hash. A conflict does not overwrite subsequent user changes; the hash check is not a transactional guarantee against simultaneous external writers. Legacy PDF/DOCX/XLSX file tools remain independent. Local project/tool approval memory can be invalidated by service configuration, tool-definition or project-scope changes. The optional **Allow all tools** switch acts only on enabled, trusted downstream MCP services and never overrides ChatGPT's own approvals.

## Execution history and live logs (v0.6.0)

The sidebar has a **Live logs** page with a collapsible **Execution history** child (collapsed by default). Click Live logs again to fold or unfold the child; a log-page shortcut also opens history. Logs update approximately every two seconds and offer All/Tools/Connections/Errors filters, search, pause/resume, auto-follow and reload. The viewer is a **bounded recent view**, not a lossless high-volume audit stream: intermediate events can be skipped when more than one page arrives between polls. Clearing the view does not delete saved files.

Execution history stores a request ID, tool/service, limited argument summary, timestamps, outcome, transport-write status and optional task ID. **Execution success, a successful local write, and confirmation that ChatGPT received the reply are separate things**; remote acknowledgement remains unknown without a client receipt. The default cleanable-log budget is 50 MiB, retention is at most seven days/10,000 execution records, and task stdout/stderr is capped at 4 MiB each. The 50 MiB limit does **not** include task identity/guards or all other application data. Detailed diagnostics are opt-in, limited to 10 MiB within the budget and automatically turn off after 30 minutes. Logs are redacted on a best-effort basis; do not put credentials into shell output. See [execution-records.md](../execution-records.md).

Pre-execution requests needing scope arguments or refreshed guidance display as **Needs arguments** or **Needs project guidance** in All/Tools, rather than Errors. Transport updates for the same request, execution state and error code update one displayed row; raw logs retain every event. **Response written to local channel** only describes writing the response to the local communication channel.

## App updates

Use **App updates** in **Connection and help** to check versions and read release notes. The application and tray menus also offer **Check for updates**. An available update appears in the sidebar.

Automatic checks run 10 seconds after launch and every 24 hours thereafter, and can be disabled. Checks need no tunnel or API key; failures do not interrupt tools or connections. Automatic checks only notify. Downloading and installing require your click. The preference is stored alongside language in the separate `preferences.json`, without rewriting credentials or reconnecting.

**Download and install** downloads the matching installer and verifies its size and SHA-256. After verification, the app stops the connection, opens the installer, and quits. On Mac, drag the new version from the DMG into Applications; Windows uses the installer wizard. Save or discard unsaved configuration changes and finish running tool tasks first. Development mode checks versions only. Missing assets, download failures, or invalid checksums do not start installation.

![App updates and client help](../images/help/en/updates.png)

This screenshot uses isolated demonstration settings and a synthetic update response; it does not establish a real tunnel call.

## Automatic project instructions

Enabled by default. Give the client the task and project directory. File, search, and terminal tools may also specify `project_path` as the instruction root.

- AGENTS and rules are optional. Reads, directory listings, and searches execute directly with guidance or diagnostics. Valid `project_context_tokens` reuse previously delivered bodies.
- Root-to-target `AGENTS.md` / `agents.md` apply within their scopes. If a first write needs undelivered guidance, it returns the bodies and retry tokens without execution. A complete response includes `retry_patch.project_context_tokens`: read the returned `contexts`, merge the patch into the original arguments, and retry the original tool named by `next_tool`, without another `get_project_context` call. Preserve the command, content and idempotency key. Incomplete guidance still requires loading first. Terminal commands, project edits and persistent tasks share this recovery flow; the server never automatically replays them. Projects without instructions allow direct writes.
- Ordinary references, missing files, and documentation patterns such as `{en,zh-CN,ja}` are diagnostics, not execution prerequisites. Relative references use the containing AGENTS directory. Shared rules outside the project may be read within authorized folders, without expanding target scope or write permissions.
- Conflicting, unreadable, or oversized applicable AGENTS block writes only; reads remain available. `get_project_context` explicitly loads projects, target paths, and selected `rule_paths`; failure to read a requested rule affects that call only.
- Delivered bodies total at most 64 KiB and are never silently truncated. Changes to delivered guidance require rereading; unrelated index changes do not block writes. File and directory metadata invalidate caches and detect added, removed, and nested instructions.

Both file and rule access enforce the app's authorized folders after resolving symbolic links. Change folders in the desktop app; `set_config_value` cannot change `allowedDirectories`. Project text cannot override user or platform instructions. Delivery does not prove model compliance.

## Search and recovery

Prefer `search_project` for code: supply `project_path` and `pattern`. It defaults to literal content matching; `regex` enables regular expressions, `ignore_case` ignores case, and `search_type="files"` searches filenames/globs. Use `include_globs` and `exclude_globs` to narrow the scope. Ignore rules and binary-file skipping apply by default. Results contain absolute paths, 1-based line numbers, and two surrounding lines on each side. `read_file` offsets remain 0-based: line N uses offset N−1.

Defaults are 20 results per page and a 2-second search budget, configurable up to 10 seconds. One search stores at most 1,000 matches and 2 MiB; each page budgets 14 KiB for the text and structured response together, leaving room for guidance. Business entries use the search cursor without an additional raw-JSON page layer. Timeout, count/byte limits, partial access, and no matches have distinct states. Long lines/snippets are marked when truncated. `next_cursor` reads the stored snapshot without rescanning, binds the project and query, and expires after five idle minutes. Up to four new searches run concurrently. Existing streaming search tools remain available.

The gateway allows 60 seconds per call by default and at most 90 seconds including any local confirmation. The internal built-in proxy's longer explicit wait cannot extend that total deadline. A timeout before forwarding reports `execution_state="not_started"`; a forwarded timeout reports `"unknown"`. Writes, appends, moves, and commands are never automatically replayed. Reads/searches can be retried after inspecting state. Stopping known processes or searches does not require refreshed rules. Handles lost on reconnection produce an explicit error.

Folder settings **do not sandbox the terminal**. Shell commands retain the user's permissions and real environment. When `start_process` omits `context_paths` and supplies a valid absolute `project_path`, guidance scope defaults to `[project_path]`. Explicit `context_paths` take precedence; use `[]` for ordinary system diagnostics. Scope completion changes neither the command's working directory nor its permissions. Run long tasks in the background and read output incrementally. Stop and Quit clean up managed processes.

## Run source during development

Double-click `Dev.command` on Mac or `Dev.cmd` on Windows. The first run prepares pinned Node, Electron and tool components and needs network access. Later runs load current `app/` source **without packaging an app or installer**. With dependencies installed, `npm run dev` and `npm start` provide the same development entry.

After editing code, select **Restart ChatToHarness** in the application menu or tray context menu to load the current source, or launch the development entry again; it does not watch file saves. The old instance stops its tunnel and tools, cancels reconnects and releases the single-instance lock before the new instance loads source. Existing directories, credentials and preferences retain their storage. A new executable may require first-use keychain authorization.

On Mac, development startup creates and reuses a native application shell named ChatToHarness in `.cache/dev-electron/`, so the menu bar shows the product name. It still loads repository source directly, leaves the original Electron dependency unchanged and does not create an installer.

Keep the development terminal open. Ctrl+C or closing it ends that development run. Closing the app window still hides it in the background; launching the development entry again replaces it. Restarting stops owned MCP service processes, but detached persistent start_task workers may continue; cancel them explicitly before upgrading when required.

For the first switch from an older version without the restart protocol, select **Quit ChatToHarness** once from its menu; closing the window is insufficient. If the old instance stays alive, the launcher fails clearly after at most 15 seconds rather than starting a second service. Subsequent development restarts use the one-click entry. If Windows reports that a changed pinned dependency is in use, quit the old development instance before preparing it again.

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

Use **View logs** to open the log directory. Redact support materials; do not include keys, complete environment dumps, or private project content.

## Open source and maintenance

MIT License. See [third-party notices](THIRD_PARTY_NOTICES.md) and the [license](LICENSE.md). The public repository excludes credentials, machine settings, logs, chat records, dependencies, and build outputs. Installers are distributed through GitHub Releases; the website does not collect credentials.

## Direct queries and result recovery

For a known project or path, call the target tool directly. Use status only for connection diagnosis and project overview only when structure is needed. Prefer `search_project` for ordinary searches (20 results by default), bounded line ranges for file reads, and dedicated Git reads. Built-in text/file tools return data without opening the optional Desktop Commander viewer; explicit artifact previews and external MCP widgets remain available.

`get_execution_summary` returns project-scoped execution metadata with state, tool and time filters (10 records by default, at most 50). It omits commands, arguments and full output. Use raw tool history only when those details are actually needed. `get_task_result` includes a bounded stdout/stderr tail and log cursor, so most task checks need one call. It never restarts the command.

Large supported built-in results return `harness_result_summary`, with a useful preview, original result ID and completeness flags. Fetch original pages only when more evidence is needed. A preview marked `requires_full_guidance` is not complete instruction delivery: read all guidance pages before retrying a write. Unknown external results retain their existing format.

Channel readiness and tool health are separate. “Some tools are unavailable” identifies a degraded tool service even while the secure channel works. A disconnected service reports `MCP_SERVICE_UNAVAILABLE`; a permission denial remains distinct. Diagnostic history, log writes and cleanup run in a bounded worker queue; persistence is best effort, while task identities and undo records retain their durable writes.
