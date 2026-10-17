# ChatToHarness 0.3.0 Verification Record

[English](../en/VERIFICATION.md) | [简体中文](../zh-CN/VERIFICATION.md) | [日本語](../ja/VERIFICATION.md)

This record separates automated checks, platform execution, and real client calls. Unfinished items remain unverified; the existence of implementation code is not evidence that a check passed.

## Recorded results

- Local Mac unit checks: 68 total, 66 passed, and 2 Windows-native Job Object checks skipped on Mac. Those two checks subsequently passed in Windows CI.
- The local Mac application and approximately 225 MB DMG were built and passed signature-integrity verification. Isolated packaged-window checks passed for all four pages, 26 real tools, directory selection, encrypted credential save/replace/clear, reconnect after restart, duplicate launch, hide/restore, cleanup of three process generations, and permission-error recovery. DMG validation, mounting, copying to a path with Chinese characters and spaces, running the application, and removing it while retaining user data passed. The final package passed the full isolated-window check again.
- Native GitHub Windows and Mac CI both passed. Windows passed 67 of 68 checks with 1 POSIX-only check skipped; both native Job Object checks passed. Both platforms verified the real tool engine, a local mock control plane for the Tunnel, packaging, and isolated windows. [CI run](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39001994066).
- Offline Pages builds, repository-subpath links, and unavailable-download handling passed. The public page returned HTTP 200, resources loaded, and desktop/mobile views had no horizontal overflow. [Deployment run](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39001761795).
- The two-platform installer draft was generated automatically and its remote sizes and SHA-256 checksums verified. The [delivery workflow](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39002181642) passed, including Mac DMG mounting/copying/startup and Windows NSIS installation/startup/uninstallation with settings retained. At the time of this record, the Release remained a draft and had not been published.
- Existing Mac settings and real Tunnel: the new native window reported Tunnel ready with 26 tools available. The settings file's SHA-256 was identical before and after the upgrade, confirming that the saved key, directory selection, and toggles were preserved.
- The current Codex session successfully called the existing Tunnel plugin: project context was obtained automatically, README was read, read-only Git/HOME checks ran, the Runtime key was absent from the shell environment, and a test marker was written and read back in a dedicated verification directory. ChatGPT web showed “Unable to load this response” during the read-only check; a new chat with no plugin, asked only to reply OK, had the same problem. Web response rendering therefore remains blocked by an external issue and is not marked passed. Responses API and AgentKit have official connection references in this version, but no real-call success is claimed.

Real local MCP smoke checks passed: writes were blocked before context delivery; root/nested AGENTS, selected rules, invalidation after rule changes, cross-project moves, concurrent contexts, file read/write, preservation of the real HOME, and removal of the Runtime key from shell environments were verified. The actual Tunnel runtime accepted current command arguments and exposed health endpoints against a local mock control plane. This alone is not proof of a working external tunnel.

## Compatibility baseline

Version 0.2.0 had already verified automatic project-instruction delivery, root/nested AGENTS, on-demand rules, cross-project contexts, actual tool read/write, and menu bar behavior on the original Mac. Those results are not automatically counted as 0.3.0 results. Personal configuration is not included in the public repository.

## Verification boundaries

CI uses temporary settings, synthetic credentials, and simulated control planes, never a personal Tunnel. Hosted Windows installation and automated checks do not replace manual checks on a user's device. Tunnel ready does not mean client setup is complete. Long-running tool operations are not replayed automatically after reconnection.

## Language and screenshot checks (2026-10-17)

Isolated native Mac checks passed for all four pages in all three languages, native menus, language persistence after restart, and preservation of unsaved drafts. Switching language left encrypted settings and managed process IDs unchanged. Screenshots were captured from this real renderer with a simulated tunnel, not from a real client call. Website checks cover all three static routes, localized release/download states, matching images and documentation links. ChatGPT composer screenshots show task entry in each language, not a successful tool response.

The updated local suite passed 69 of 71 checks; the two Windows-native checks were skipped on Mac.

The signed native Mac application also passed the complete isolated packaged-window checks in all three languages.

Both [native CI jobs](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39004923858) and the [three-language Pages deployment](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39004923882) passed. The application installed on the original Mac switched among all three languages while its real Tunnel stayed ready with 26 tools. The encrypted settings fingerprint remained unchanged. These language checks do not repeat the earlier real client read/write acceptance.

## 0.3.1 automatic tag release (2026-10-17)

The [v0.3.1 tag workflow](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39006275576) passed both native installer builds, packaged-window checks, installation, and uninstallation with settings retained. It automatically published the [stable Release](https://github.com/DJ-Huang/ChatToHarness/releases/tag/v0.3.1), including the Windows installer, Mac DMG, SHA256SUMS.txt, and notes in all three languages. Public attachment sizes and SHA-256 digests were verified. The same workflow then deployed Pages; the Chinese, English, and Japanese live pages were checked against the actual v0.3.1 attachment URLs. Published release assets and tags remain unchanged.

## Guidance and robustness changes: source verification (2026-10-17, unreleased)

These source changes follow 0.3.1; published tags and installers were not changed. AGENTS is optional and automatic reference failures are diagnostics. Files and guidance share authorized-folder checks. New work includes bounded `search_project`, metadata caches, deadlines, cancellation and handle cleanup, plus manual/automatic update checks, installer verification and OS handoff. Tool metadata describes the protocol factually and retains truthful terminal write/network annotations.

- All 66 focused checks passed across contexts, real local ripgrep, proxy lifecycle, updates, main-process recovery and translation coverage. After boundary fixes, only affected search and proxy checks were rerun; both passed.
- All 8 runtime/connection checks passed separately in an approved local execution environment after the sandbox blocked loopback listening and some process inspection. The total is 74 focused checks, not the full suite.
- Read-only context loads succeeded for all three original project cases, with zero write-blocking diagnostics. The pet project retained its shared specification reference; missing references and VaultRAG brace shorthand remained visible diagnostics. Those project files were not modified.
- Tests used system Node 23.11.0 and local ripgrep; filename glob checks emitted that Node version's experimental-feature warning. Packaging still pins Node 24.22.0. No full suite, dual-platform CI, new package build, visual UI acceptance or real update installation ran. The real MCP smoke script now covers the new search and projects without AGENTS; it was not run this round.
- The running Harness and ChatGPT tool catalog were not replaced/refreshed, and real ChatGPT calls were not verified. Removing the old compulsory metadata prefix in source does not establish that ChatGPT's suspicious-instructions prompt has disappeared.

## Source development launch and restart (2026-10-17, unreleased)

Added `Dev.command` / `Dev.cmd`; `npm run dev` and `npm start` use the same development launcher. After first-time pinned setup it runs source directly. Components are prepared again only after fingerprint changes or failed verification; no app packaging runs. Bootstrap writes a compatible Node receipt so Windows preparation does not try to replace its running `node.exe`.

Electron single-instance messages request graceful Quit. The old instance awaits `runtime.close()` before releasing its lock; only then can the replacement start. Signals and development-owner loss enter normal shutdown. Windows reuses the private Job and a matching-owner stop request. An older incompatible instance causes a clear failure within 15 seconds rather than a second service. Long-running development does not hold the component-preparation lock.

All 35 focused checks passed in their relevant groups: main-process/development lifecycle 20, launcher substitutes 13, actual POSIX process cleanup 1, isolated Mac wrapper smoke 1. The native case confirmed that a temporary application and its detached service exited while an unrelated process survived. The wrapper case covered initial verified extraction, receipt reuse, preparation/launch lock boundaries and no packaging. Syntax and diff checks passed. No real Electron GUI, tunnel, personal configuration or actual component downloads were used; no full suite or native Windows execution ran. Graceful-exit evidence does not guarantee cleanup of reparented POSIX descendants after arbitrary SIGKILL or crashes.

## v0.4.0 pre-release checks (2026-10-17)

The complete local suite ran 131 checks: 129 passed, 2 native Windows checks skipped on this platform, no failures. Version/lock consistency, release guards and diff checks passed. Native builds, real tools, packaged windows, installer acceptance and public asset verification remain pending in the GitHub release pipeline; publication is not yet confirmed.

## v0.4.0 native checks on both platforms (2026-10-17)

[Pre-release checks](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39014237373) passed. Windows: 125 of 131 passed, 6 skipped by platform/tool availability. Mac: 126 of 131 passed, 5 skipped. Neither platform failed. Both completed packaging, discovery of 27 real tools, reads without a prerequisite, writes without AGENTS, bounded search, changed-rule/cross-project isolation, credential isolation, local tunnel control-plane checks, actual packaged windows and process cleanup. Update checks and preferences ran through real IPC without modifying credentials or reconnecting tools.

Acceptance scripts now compare canonical native Windows paths and explicitly select the POSIX shutdown scenario. Website/docs screenshots use current isolated Mac windows in all three languages. CI does not exercise personal remote tunnels. Public release still awaits native installers, installer acceptance and uploaded size/SHA-256 checks in the tag workflow.

## v0.4.0 public release (2026-10-17)

[v0.4.0 is public](https://github.com/DJ-Huang/ChatToHarness/releases/tag/v0.4.0), neither a draft nor a prerelease; the latest stable API returns v0.4.0. The [tag pipeline](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39014606580) passed native builds, real tools, packaged windows, install/start/uninstall data retention, uploaded asset verification and website build/deployment on both supported platforms.

Public assets contain the Windows x64 installer (188,361,888 bytes), Mac arm64 DMG (237,125,755 bytes), and SHA256SUMS.txt. The downloaded public checksum file matches all three asset sizes and GitHub SHA-256 digests. Published tags and assets remain unchanged.

The website job built v0.4.0 and deployed successfully. At verification time public pages still hit old CDN content, so updated downloads on all three root routes are not marked verified. Use the Release URL for immediate downloads; the cache does not affect public installers or the latest-version API.

## Application MCP manager and gateway (2026-10-17, unreleased)

- The full local run plus targeted reruns cover the current 202 cases: 200 passed and two Windows-native checks were skipped on Mac. The full suite ran once; after updating the obsolete mandatory-directory assertion and adding MCP-only runtime and HTTP recovery coverage, only affected checks were rerun.
- The Mac arm64 application builds successfully. Official MCP SDK 1.32.1 is a direct packaged dependency, including its MIT license. Gateway, settings, transport and entry-point sources were checked against the final packaged contents.
- The real built-in engine smoke passed with 27 tools, project guidance, search, file round trips and credential isolation. The shipped Tunnel runtime accepted the private gateway command and exposed its health endpoint against a synthetic loopback control plane; no OpenAI control-plane connection was made.
- Packaged-window acceptance passed with isolated settings: five-page navigation, all three languages, MCP management without workspace folders, trust/test/enable/disable, default-denied tools, explicit tool grants, encrypted environment references and export, restart persistence, single-instance behavior and process cleanup. Temporary profiles have separate test keychain identities; the production identity is retained and personal settings were not used.
- Six HTTP-focused checks passed: static authentication, graceful/abrupt SSE loss, POST network failure, expired-session 404 and optional GET 405. Connections recover without replaying interrupted calls. Changed or removed tools cannot regain old grants when their definitions reappear.
- Real ChatGPT client acceptance passed: a temporary stdio server `tunnel_probe` was added in ChatToHarness, only `echo` was authorized, and the existing plugin catalog was refreshed. One `tunnel_probe__echo` call crossed the personal live Tunnel and returned nonce `cth-live-20261017-1207`, `calls: 1`, and `server: fixture`, preserving Chinese, Japanese, nested arrays and `project_path`. The local redacted audit recorded completed execution. The temporary service was stopped and removed and the client catalog refreshed afterward. This does not establish Responses API or Unity acceptance.
- [Native CI passed on both platforms](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39031317049) for code commit `dd56576`: Windows x64 passed 196 of 202 cases with six platform/resource skips; Mac arm64 passed 197 with five skips, with no failures. Both completed native packaging, 27 real tools, private-gateway Tunnel loopback checks, three-language packaged UI, MCP-only settings and authorization, encrypted storage and process cleanup. Bounded deletion retries fixed Windows temporary-directory handle release after process exit; failing checks were not skipped. CI uses isolated profiles and synthetic credentials; the live personal Tunnel call is verified separately above.
- No release was published and the installed application was not replaced.
