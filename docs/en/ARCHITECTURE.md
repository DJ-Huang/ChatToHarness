# ChatToHarness Architecture

[English](../en/ARCHITECTURE.md) | [简体中文](../zh-CN/ARCHITECTURE.md) | [日本語](../ja/ARCHITECTURE.md)

Request path: supported client → OpenAI Secure MCP Tunnel → local Tunnel runtime → authenticated private IPC → application MCP gateway. The gateway routes built-in tools through the project-instruction proxy to Desktop Commander and authorized third-party tools to their own MCP connections. External clients connect through the existing Tunnel only; private IPC and health endpoints are not public MCP entry points.

## Desktop layer

The Electron main process manages settings, system-encrypted credentials, single-instance behavior, windows, the background icon, and connection scheduling. HTML/CSS/JavaScript provides separate settings and help pages. A restricted preload exposes settings, directory selection, state subscriptions, and connection controls. The renderer has no Node access and uses sandboxing, context isolation, navigation restrictions, and an external-link allowlist.

Closing the window hides it. Stop and Quit advance `actionEpoch`, cancelling queued automatic connections and the connect step after saving settings. Automatic key retrieval starts after the page loads so a system authorization dialog does not block the initial display. Public state reports only whether a key is saved, never plaintext or ciphertext.

Mac preserves the LocalHarness internal name, application identifier, and data location while displaying ChatToHarness. Windows has its own system data directory. Unavailable system encryption never falls back to plaintext; read failures preserve the original settings. Windows user-level encryption does not isolate the data from other programs running as the same user.

## Platforms and managed processes

The platform adapter supplies component locations, the default shell, user environment, Tunnel command arguments, and process supervision. Mac cleans up owned processes and process groups. Windows uses a compiled Job Object helper to contain the managed process tree; closing the job kills its descendants. The Tunnel key is passed only through the environment, and the launcher removes it before starting Desktop Commander.

Pinned versions and checksums determine bundled components, including Node. Tool settings and logs live in the private data directory, with the real HOME/USERPROFILE preserved and telemetry disabled. The build-time Desktop Commander configuration adaptation accepts only an exact known source match and stops the build on mismatch.

## Application MCP gateway

MCP server settings belong to ChatToHarness and are shared by clients of the Tunnel, independently of any Agent. The Electron main process owns configuration, secrets, trust, tool policy and one connection per service. The Tunnel's stdio entry uses an authenticated private local channel to access the gateway; it cannot manage configurations or approve calls. Unity and browsers are ordinary third-party MCP services. This release adds no Agent runner or Computer Use driver.

The manager supports local `stdio` and local/remote Streamable HTTP. Remote targets require HTTPS; HTTP is accepted only for loopback targets. OAuth and legacy HTTP+SSE are not supported. SDK `1.32.1` negotiates independently on each side and exposes the negotiated protocol version; a peer requiring only `2026-07-28` is unsupported. Configuration supports platform-specific command overrides. System encryption stores secret values separately; configuration and exports contain references, and renderer state contains only saved-secret indicators. Imports are previewed, disabled by default, and never start commands. Exports omit trust records and tool authorizations.

Built-in names stay unchanged. Third-party names use stable `serverId__toolName` namespaces and are routed by a registry. All discovery pages are read; list changes refresh the registry. New or changed definitions require fresh authorization. Each tool is disabled, directly allowed, or requires local confirmation on every call. Server annotations never grant authorization. First connection requires trust in the actual command or target URL; changing the launch target invalidates trust. Confirmations bind the tool, immutable arguments and connection generation and expire with the call deadline.

Third-party arguments and tool input/output schemas are preserved without project-context injection or built-in argument stripping. Results preserve structured content, images and tool errors. Only tools are aggregated: resources, prompts, sampling and elicitation are not additional gateway capabilities. Resource links may occur in tool results. Clients may need to refresh their own tool catalogs after changes.

Connections and process trees are managed independently. Repeated connection checks reuse existing connections; Tunnel reconnection does not relaunch healthy services. Transport failures use independent reconnects, while authentication, configuration and protocol errors require correction. Calls are never replayed after disconnect; once forwarded, a missing result is reported as execution state unknown. The total call deadline is 60 seconds by default, at most 90 seconds including local confirmation, and serialized messages are limited to 8 MiB. Logs record service, tool, duration, authorization result and execution status, excluding argument/result bodies and images.

Stop connection stops the Tunnel and all managed services; disabling one service affects only that service. Closing the window keeps services running in the background. Third-party stdio processes receive a minimal runtime environment plus their explicit configuration, never the Tunnel key. Work-directory restrictions do not sandbox third-party processes, which retain the user's operating-system permissions.

## Project guidance and search

`get_project_context(project_path, target_paths?, rule_paths?)` retains projects, bodies, indexes, and tokens, adding `diagnostics` with `blocks_writes`. Project scope determines instruction applicability; app-authorized folders determine file access. Shared rules can cross projects without expanding target or write scope. Missing AGENTS is normal, reference failures are soft, and unavailable applicable AGENTS block writes only.

Reads include guidance automatically; valid tokens reuse delivered bodies. A first write needing guidance returns bodies and retry tokens without execution. Bounded caches use file and directory metadata; bodies are reread and hashed only after changes, with concurrent loads coalesced. AGENTS discovery checks known filenames; rule indexes use bounded streaming enumeration. Index and delivered-instruction versions are separate.

`search_project` invokes bundled ripgrep with an argument array, never a shell. Defaults are literal queries, 2 seconds, 100 results per page, and two context lines per side. Limits are 1,000 matches, 2 MiB stored, 64 KiB per result page, four concurrent searches, and a maximum 10-second budget. Project/query-bound snapshots expire after five idle minutes. Completed, empty, timed-out, limited, and partial results remain distinct. Native streaming search tools remain available.

The internal built-in proxy bounds pending requests and supports explicit waits up to 180 seconds; the enclosing gateway imposes its shorter total call deadline. Cancellation reaches context reads and searches; disconnect disposes requests, caches, and search children. Pre-forward failures report `not_started`; forwarded timeouts report `unknown`, with no automatic replay. Late replies are discarded. Continuations and cleanup bind originating handles, not a global current project. Known cleanup does not require fresh rules. Tool schemas, output schemas, and behavior annotations are maintained together; unsupported widget hints are removed.

## App updates

A separate `Updater` reads public stable Releases from the fixed GitHub repository, validates numeric versions, platform, asset URLs, size, and SHA-256, with `SHA256SUMS.txt` fallback. Requests use main-process [Electron net.fetch](https://www.electronjs.org/docs/latest/api/net) for system-proxy support; the renderer still has no network or Node access. Update IPC uses the existing main-window origin checks, and release URLs come only from validated metadata.

Checks run after 10 seconds and every 24 hours, controlled by an independent preference. Manual and automatic checks share in-flight work and never access credentials or connection scheduling. Downloads require a click, are verified while streaming and again before handoff, then stop managed tools before opening the installer and quitting. Failures remain retryable; quit aborts transfers. Old private update caches are pruned after seven days on later checks. Test mode never starts automatic network checks.

## Build and delivery

GitHub Actions builds on native Windows x64 and Mac arm64 runners, verifies packaged resources, and checks isolated windows and installation. Only after both platforms pass and uploaded assets are verified does it automatically publish a stable Release with notes and SHA-256 checksums, then call the website deployment. Public Releases are not overwritten. Pages builds independently and offers downloads only from published stable Releases. Source and website content contain no user settings or credentials.

See [verification boundaries](VERIFICATION.md), [release maintenance](RELEASING.md), and the [documentation index](README.md).

## Language support

The app shares `app/locales.js` and `app/i18n.js` between the renderer and native menus. Static text, accessibility labels, runtime state, and known errors use one catalog. System language selects the initial locale; `preferences.json` stores a later explicit choice independently from encrypted settings. Language IPC updates menus and state without entering the connection queue or changing `actionEpoch`. Paths, credentials, and tool output are never translated.

The website renders three complete static pages at the root (Chinese), `/en/`, and `/ja/`. Each has localized metadata, documentation links, download states, and application screenshots, with canonical and alternate-language links. The selector remembers the choice in browser storage; direct English/Japanese URLs remain authoritative.
