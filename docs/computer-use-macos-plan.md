# macOS Computer Use — execution plan and evidence

## BaseComputerUse and permission prompt acceptance — 2026-10-21

- `MacComputerUse extends BaseComputerUse` and no longer imports or extends Windows code. Packaged macOS app contains base, image codec, Mac adapter and the Swift helper, but no Windows native executable or Windows-only JS adapters.
- MCP Servers Computer Use toggle requires native read-only `permission_status` first; if either Screen Recording or Accessibility is missing, it shows a local user-facing dialog identifying each grant. Explicit user clicks can open macOS Privacy & Security or call native `request_permissions`. Never request permissions just because the UI is displayed or a client uses `tools/list`.
- Runtime native `CU_SCREEN_RECORDING_REQUIRED` or `CU_ACCESSIBILITY_REQUIRED`, including delayed session-start failures, stops the control session and brings the permission guidance forward. Granting OS access does not automatically replay an uncertain input. After granting, user must recheck and start with a fresh observation.
- TCC belongs to the signing identity of the native app/helper. Ad-hoc local builds and installed production builds may have different grants; prompt links alone are not evidence of granted permission.


## MCP Servers built-in Computer Use toggle — 2026-10-21

- **Native Electron UI integration:** `node scripts/ui-smoke.cjs --dev` PASS on this Mac, checking and unchecking the new checkbox in a temporary profile, proving persistent enable/disable and no third-party server import. Pending UI state is rendered optimistically until the local IPC returns.

- One MCP Servers checkbox `mcp-computer-use` controls **this device's macOS adapter only**; it never instantiates Windows native code.
- Default is off. When enabled and bundled `ChatToHarness.MacComputerUse` is present, the app-owned MCP gateway automatically lists `computer_use` with the macOS description and native permission contract, including screenshots, cursor/keyboard input and Esc/STOP. Restart reads the persisted per-device preference.
- Uncheck immediately hides the MCP tool and aborts the native helper and all in-flight sessions. Closing the gateway likewise releases the current session. OS TCC permissions remain mandatory.
- Source and UI regression tests pass, including a real Mac native `get_session` call through the dynamically selected service. A freshly built/installed .app is necessary to validate the new checkbox's visual presentation; already installed 0.7.0 apps have the previous code.


## Human-speed motion and cross-monitor routing — 2026-10-21

- Native pointer updates approximately every 16ms on a monotonic clock, with quintic accelerate/slowdown and duration 0.17s + routeLength/850 (clamped 0.24–3.6s). Windows implements equivalent timing, with separate native API calls.
- Single-screen movement follows a small deterministic lateral arc only if it remains safely inset; crossing monitors uses explicit edge gateways computed from CGDisplayBounds / Screen.AllScreens, avoiding empty desktop-coordinate holes and unexpected cursor clipping.
- MacCursorTrajectory model tests check 4 scenarios × 301 frames, all on display rectangles in the three-monitor layout found on this Mac (main above two other screens). User-interference/foreground/STOP remain enforced on every frame; do not turn them off to pass tests.
- Real GUI fixture now samples actual CGEvent cursor positions at ~60Hz and asserts movement has >=8 distinct positions and >=240ms duration on its tested travel. One opt-in Mac run returned successful exit; other attempts were correctly interrupted by user-input/focus safety checks. Optical Glow appearance is still unverified and actual Windows GUI acceptance is deferred.
- Verify using `npm run test:computer-use-mac` and, only in a disposable local GUI session, `npm run test:computer-use-mac:gui`; for Windows source model use `node --test tests/windows-cursor-motion.test.cjs`.


## 2026-10-21 real macOS input acceptance

| Gate | Actual result |
| --- | --- |
| Screen Recording + Accessibility TCC | **PASS:** both granted for executing native helper |
| Native session with input enabled, real screen capture and close | **PASS** |
| Disposable AppKit fixture real click + Unicode typing + BACKSPACE + scrolling | **PASS**, 1/1 |
| Single-use observation and anti-replay on actual native input | **PASS** (CU_STALE_OBSERVATION) |
| Global Esc system event closes helper, leaves target app untouched | **PASS**, 1/1, synthetic foreground-guarded Esc |
| Full interactive acceptance runner | **PASS 2/2**, 0 skipped, explicit command |
| Default noninteractive test run | **12 PASS**, 0 FAIL, **2 SKIP** because no ChatToHarness app window visible and the no-Accessibility test is inapplicable |
| Cross-platform CTRL+A -> macOS Command+A in native text control | **FAIL:** does not select all; input-state interference observed in prior attempts |
| On-screen STOP button | **NOT TESTED** |
| Native Glow visual effect and multi-monitor/Retina placement | **NOT TESTED** |
| Installed, signed Mac app identity / DMG and permission revocation | **NOT TESTED** |

Real GUI tests are NOT in default `npm test` because they activate a disposable window and inject actual pointer/keyboard events. Run explicitly on a Mac with Screen Recording and Accessibility grants:

```sh
npm run test:computer-use-mac:gui
```

This command compiles both disposable Swift fixtures, checks the fixture is foreground before sending Esc, runs GUI interactions in isolated processes and removes temporary fixture executables. The combined keyboard shortcut remains an open functional defect and blocks full production acceptance. Windows native acceptance stays deferred.


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
