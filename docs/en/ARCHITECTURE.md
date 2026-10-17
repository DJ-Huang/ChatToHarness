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

## Project-instruction proxy

`get_project_context(project_path, target_paths?, rule_paths?)` returns the project root, applicable AGENTS files, a rule index, selected rule bodies, and a versioned context token. File, search, write, and terminal tools require `project_context_tokens`; shell calls also declare `context_paths`. Missing or stale context prevents execution. The caller must load context and explicitly retry.

Root-to-target AGENTS files support case variants and report conflicting candidates. The root rules index recursively includes Markdown; AGENTS may reference project-local text rules. Realpath checks reject references that escape the project through links. Returned bodies have a combined 64 KiB limit and are never silently truncated. Context is bound to the project, scope, and content version and passed on every operation, preventing concurrent chats from sharing an implicit project. Cancellation, notifications, request IDs, and concurrent calls retain their protocol semantics. Optional web-preview hints are removed so clients use ordinary tool results.

## Build and delivery

GitHub Actions builds on native Windows x64 and Mac arm64 runners, verifies packaged resources, and checks isolated windows and installation. Only after both platforms pass does it assemble a draft Release with SHA-256 checksums. Public Releases are not overwritten. Pages builds independently and offers downloads only from published stable Releases. Source and website content contain no user settings or credentials.

See [verification boundaries](VERIFICATION.md), [release maintenance](RELEASING.md), and the [documentation index](README.md).
