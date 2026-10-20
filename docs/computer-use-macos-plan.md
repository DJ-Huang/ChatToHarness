# macOS Computer Use — execution plan and evidence

Date: 2026-10-20 · Priority: **P0 macOS** · Branch: `feat/computer-use` · [Issue #1](https://github.com/watermoon/ChatToHarness/issues/1).

Windows native/installer acceptance is explicitly **deferred**. Do not change Windows desktop input behavior further unless needed for compatibility; the already made real-cursor-motion edit remains a separate unaccepted change.

## Current implementation

- `native/MacComputerUse.swift` and `native/MacCursorGlow.swift` are production candidates (macOS 14+ arm64). The earlier `MacComputerUseObservation.swift` was a standalone capture experiment, since superseded and removed; it is not the shipping entry.
- ScreenCaptureKit enumerates and captures a **single selected native window** (no full-screen fallback). The helper verifies window ID, PID, app launch date, foreground ownership and geometry before input, and checks topmost occlusion on pointer actions.
- AppKit provides a per-window consent picker in `per_window` mode, and an always-visible nonactivating STOP panel. A global passive Esc event tap **must be installed** before input can start or control is rejected.
- Screen Recording alone enables a **read-only MCP session**; without Accessibility or an operational Esc tap, input stays disabled and session status exposes `input_enabled: false` and `input_blocked_reason`.
- CoreGraphics supports real-cursor movement, click, scroll, Unicode key injection and bounded key shortcuts (CTRL+ aliases use Command on Mac). User-held modifiers/buttons or intervening user cursor movement abort input.
- The independent Mac stdio MCP service reuses Windows' session/token/fresh-observation rules and memory-only lossless PNG/WebP chunking and SHA-256. It uses a separate `macos-computer` service alias so Windows grants are not migrated implicitly.
- `scripts/build-computer-use.cjs` builds the Swift helper with `xcrun swiftc`. `prepare-computer-use.cjs` stages the Mac binary and Node files; `computer-use-config.cjs` emits absolute platform-appropriate Node/helper locations; Electron resources include Mac Computer Use.
- Mac pointer Glow is implemented with the actual system cursor alpha silhouette and hotspot in a mouse-transparent light-blue overlay; unavailable cursor extraction hides the Glow rather than drawing a fake cursor or locator ring. This code compiles but has not passed visual acceptance.
- The helper does **not** use AppleScript, desktop-wide screenshot fallback, TCC bypass, arbitrary shell execution or clipboard reads.

## Evidence (2026-10-20)

| Gate | Result |
| --- | --- |
| Swift arm64 source compiles with macOS SDK | **PASS** |
| `npm run test:computer-use-mac` | **PASS: 14/14**, exit 0 (prior run; repeat after permission change) |
| MCP tool discovery and error path | **PASS** |
| One-use observation, chunking, screenshot metadata | **PASS** mocked protocol + real read-only MCP native session |
| Direct native helper launch | **PASS** native permission status/list_windows/window probe |
| Actual ScreenCaptureKit window screenshot | **PASS** real ChatToHarness window 1160×850, 211,199 PNG bytes, negative-coordinate geometry `[1759,-1328,2919,-478]`, memory-only |
| Actual clicks/scroll/Unicode/keyboard and Esc/STOP | **BLOCKED** because helper's Accessibility TCC grant is still missing; Input Monitoring is not required; input safely rejected |
| Retina, multiple displays, moving/resizing windows | **NOT TESTED** |
| Resource staging, manifest SHA-256 and bundled Node/MCP test | **PASS** (staging exit 0; bundle manifest includes Mac helper and adapter) |
| Actual signed/installed DMG TCC permissions | **NOT TESTED** |

### Verification command

From the repository root, on a Mac with Swift toolchain and `npm ci` already executed:

Grant only **Screen Recording** (observation) and **Accessibility** (input and Esc listener). Apple's DTS notes that Accessibility authorizes posting and listening events; the helper must still prove its own Esc event tap works before activating input.

```sh
npm run test:computer-use-mac
npm run computer-use:mac:permissions -- --status
# Explicit local TCC request; requires user approval:
npm run computer-use:mac:permissions -- --request
```

To prepare the optional MCP service, after application resources have been prepared:

```sh
npm run prepare:resources
node resources/computer-use/configure.cjs
```

The configuration prints a `macos-computer` MCP server. Enable it explicitly in the ChatToHarness MCP service manager; its tool must still be individually authorized. Mac OS permissions are separate and cannot be granted by ChatToHarness.

### Remaining work and real-device acceptance

1. Screen Recording is already granted for the executing helper. Grant the still-missing **Accessibility** permission (no additional Input Monitoring required) in macOS System Settings → Privacy & Security to the exact running helper identity. Reopen the relevant service afterward. Avoid granting unrelated processes permission.
2. Use a disposable native test window to verify window selection, correct PNG, real cursor click/scroll/Unicode and re-observation. Ensure secure/system windows are rejected.
3. Press Esc while input is in progress and use the STOP panel across desktop Spaces/full-screen; neither must leak a click to another app. Test owner exit, timeout, user interference and TCC revocation.
4. Validate the newly implemented mouse-transparent native blue window border on real macOS Spaces/full-screen and multiple displays. Native cursor-silhouette Glow code is implemented and compiled, but real pointer appearance is not yet visually verified; do not substitute a click-location circle.
5. Verify actual DMG staging, signing/notarization/TCC attribution and Retina/multi-screen transformations. Only then mark feature as supported.

These unresolved acceptance gates are intentionally not counted as complete.
