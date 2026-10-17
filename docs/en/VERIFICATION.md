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
