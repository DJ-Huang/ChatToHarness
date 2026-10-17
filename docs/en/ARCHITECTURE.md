# ChatToHarness Architecture

[English](../en/ARCHITECTURE.md) | [简体中文](../zh-CN/ARCHITECTURE.md) | [日本語](../ja/ARCHITECTURE.md)

Request path: supported client → OpenAI Secure MCP Tunnel → local Tunnel runtime → project-instruction protocol proxy → Desktop Commander. External clients connect through the Tunnel only. Internal stdio and loopback health endpoints are not additional public MCP entry points.

## Desktop layer

The Electron main process manages settings, system-encrypted credentials, single-instance behavior, windows, the background icon, and connection scheduling. HTML/CSS/JavaScript provides four separate pages. A restricted preload exposes settings, directory selection, state subscriptions, and connection controls. The renderer has no Node access and uses sandboxing, context isolation, navigation restrictions, and an external-link allowlist.

Closing the window hides it. Stop and Quit advance `actionEpoch`, cancelling queued automatic connections and the connect step after saving settings. Automatic key retrieval starts after the page loads so a system authorization dialog does not block the initial display. Public state reports only whether a key is saved, never plaintext or ciphertext.

Mac preserves the LocalHarness internal name, application identifier, and data location while displaying ChatToHarness. Windows has its own system data directory. Unavailable system encryption never falls back to plaintext; read failures preserve the original settings. Windows user-level encryption does not isolate the data from other programs running as the same user.

## Platforms and managed processes

The platform adapter supplies component locations, the default shell, user environment, Tunnel command arguments, and process supervision. Mac cleans up owned processes and process groups. Windows uses a compiled Job Object helper to contain the managed process tree; closing the job kills its descendants. The Tunnel key is passed only through the environment, and the launcher removes it before starting Desktop Commander.

Pinned versions and checksums determine bundled components, including Node. Tool settings and logs live in the private data directory, with the real HOME/USERPROFILE preserved and telemetry disabled. The build-time Desktop Commander configuration adaptation accepts only an exact known source match and stops the build on mismatch.

## Project guidance and search

`get_project_context(project_path, target_paths?, rule_paths?)` retains projects, bodies, indexes, and tokens, adding `diagnostics` with `blocks_writes`. Project scope determines instruction applicability; app-authorized folders determine file access. Shared rules can cross projects without expanding target or write scope. Missing AGENTS is normal, reference failures are soft, and unavailable applicable AGENTS block writes only.

Reads include guidance automatically; valid tokens reuse delivered bodies. A first write needing guidance returns bodies and retry tokens without execution. Bounded caches use file and directory metadata; bodies are reread and hashed only after changes, with concurrent loads coalesced. AGENTS discovery checks known filenames; rule indexes use bounded streaming enumeration. Index and delivered-instruction versions are separate.

`search_project` invokes bundled ripgrep with an argument array, never a shell. Defaults are literal queries, 2 seconds, 100 results per page, and two context lines per side. Limits are 1,000 matches, 2 MiB stored, 64 KiB per result page, four concurrent searches, and a maximum 10-second budget. Project/query-bound snapshots expire after five idle minutes. Completed, empty, timed-out, limited, and partial results remain distinct. Native streaming search tools remain available.

Pending requests are bounded and use 60-second deadlines, extended up to 180 seconds for explicit waits. Cancellation reaches context reads and searches; disconnect disposes requests, caches, and search children. Pre-forward failures report `not_started`; forwarded timeouts report `unknown`, with no automatic replay. Late replies are discarded. Continuations and cleanup bind originating handles, not a global current project. Known cleanup does not require fresh rules. Tool schemas, output schemas, and behavior annotations are maintained together; unsupported widget hints are removed.

## App updates

A separate `Updater` reads public stable Releases from the fixed GitHub repository, validates numeric versions, platform, asset URLs, size, and SHA-256, with `SHA256SUMS.txt` fallback. Requests use main-process [Electron net.fetch](https://www.electronjs.org/docs/latest/api/net) for system-proxy support; the renderer still has no network or Node access. Update IPC uses the existing main-window origin checks, and release URLs come only from validated metadata.

Checks run after 10 seconds and every 24 hours, controlled by an independent preference. Manual and automatic checks share in-flight work and never access credentials or connection scheduling. Downloads require a click, are verified while streaming and again before handoff, then stop managed tools before opening the installer and quitting. Failures remain retryable; quit aborts transfers. Old private update caches are pruned after seven days on later checks. Test mode never starts automatic network checks.

## Build and delivery

GitHub Actions builds on native Windows x64 and Mac arm64 runners, verifies packaged resources, and checks isolated windows and installation. Only after both platforms pass and uploaded assets are verified does it automatically publish a stable Release with notes and SHA-256 checksums, then call the website deployment. Public Releases are not overwritten. Pages builds independently and offers downloads only from published stable Releases. Source and website content contain no user settings or credentials.

See [verification boundaries](VERIFICATION.md), [release maintenance](RELEASING.md), and the [documentation index](README.md).

## Language support

The app shares `app/locales.js` and `app/i18n.js` between the renderer and native menus. Static text, accessibility labels, runtime state, and known errors use one catalog. System language selects the initial locale; `preferences.json` stores a later explicit choice independently from encrypted settings. Language IPC updates menus and state without entering the connection queue or changing `actionEpoch`. Paths, credentials, and tool output are never translated.

The website renders three complete static pages at the root (Chinese), `/en/`, and `/ja/`. Each has localized metadata, documentation links, download states, and application screenshots, with canonical and alternate-language links. The selector remembers the choice in browser storage; direct English/Japanese URLs remain authoritative.
