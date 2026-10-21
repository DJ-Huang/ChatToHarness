# Windows computer use (source preview)

## Shared BaseComputerUse and Windows consent — 2026-10-21

- `WindowsComputerUse extends BaseComputerUse`. Windows installer includes base, image codec, Windows adapter and `ChatToHarness.ComputerUse.exe`, excluding Mac Swift helper and Mac-only JS adapters.
- Windows does **not** call macOS TCC APIs. Desktop window authorization remains in the Windows native helper. A runtime `CU_CONSENT_DENIED` stops the current session, removes the visible Computer Use tool and shows a platform-specific retry/consent explanation; it does not offer macOS Privacy & Security controls or silently elevate privileges.
- Cross-platform JS and MCP policy regression tests pass on macOS. Windows installer binary and real GUI remain to be verified on an actual Windows host.


## Built-in MCP Servers opt-in on Windows — 2026-10-21

- The same MCP Servers checkbox is scoped to this Windows installation, disabled by default. When checked, **only** `WindowsComputerUse` with the packaged `ChatToHarness.ComputerUse.exe` is eligible for app-owned MCP `computer_use` registration.
- Never load the macOS helper on Windows or the Windows helper on macOS. Switching off immediately aborts active mouse, keyboard, screenshot and session processes and removes the tool from discovery. Connection stop also aborts sessions; a later opt-in connection starts with a clean session.
- UI/IPC persistence, cross-platform selection and process-cancellation tests pass under synthetic Windows environments on macOS. Real Windows GUI/Glow acceptance must still be run on a Windows device.


## Human-visible pointer motion — 2026-10-21

The native helper now uses the real Windows pointer for 60Hz, distance-scaled motion. Average pacing targets approximately 850 physical pixels/second plus 170ms start/stop allowance (0.24–3.6s total); quintic acceleration/deceleration and bounded same-screen curvature replace the old max-32-steps / 12ms motion. Cursor-shaped blue Glow continues to follow the real pointer; no extra cursor or click-location circle is introduced. Screen.AllScreens adjacency waypoints prevent routing through gaps between monitors.

Windows pointer state, Esc/STOP, and foreground/target checks remain mandatory throughout the animation. Source regressions pass 2/2 and native C# compiles with Mono on macOS; real Windows pointer/GPU visual acceptance has **not** been run and remains explicitly pending at the user's request.


This optional local MCP service controls one Windows window at a time. Authorization is configurable: `all_windows` is the default (requested on 2026-10-20), while `per_window` requires local selection/consent for each new window session. It is not enabled automatically and does not change Desktop Commander or shell permissions. Windows 11 x64 and the .NET Framework 4 compiler are required to build the helper. No model/API key is needed by the service.

## Build and connect

In PowerShell, from the repository root:

```powershell
npm ci
npm run build:computer-use
```

The build also writes `resources/computer-use/mcp-config.json` with this checkout's actual Node and script paths. Import this file's JSON in MCP Servers; it contains no credentials. Rebuild it if the checkout moves.

In ChatToHarness → MCP Servers, add a **stdio** service with ID `windows-computer`, command set to the absolute path returned by `(Get-Command node).Source`, and one argument: the absolute path of `app/windows-computer-use-stdio.cjs` in this checkout. Alternatively import the following after replacing paths with your actual paths:

```json
{
  "mcpServers": {
    "windows-computer": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["D:\\proj\\github\\ChatToHarness\\app\\windows-computer-use-stdio.cjs"]
    }
  }
}
```

Review/trust the launch target, enable the service and set the discovered `computer_use` tool permission. Its client-visible name is normally `windows-computer__computer_use`. Imports remain disabled until enabled locally. The existing app's allow-all setting also applies to this external service, but does not override the configured native authorization mode. This preview runs from the source checkout or a local Windows build; published release assets have not been replaced.

## Authorization configuration

In MCP Servers, edit this service's environment JSON. Set `CTH_COMPUTER_USE_AUTHORIZATION_MODE` to one of:

| Value | Behavior |
| --- | --- |
| `all_windows` (default) | All windows are authorized. `list_windows` returns visible window IDs; pass the intended `window_id` to `open_session`. No local picker is shown. Omitting the ID selects the foreground window. |
| `per_window` | Every new session requires the local window picker and explicit Allow. `window_id` may preselect a candidate; the local user makes the final selection. Window enumeration is not returned to the client in this mode. Switching windows requires a new session/consent. |

Example environment JSON: `{"CTH_COMPUTER_USE_AUTHORIZATION_MODE":"per_window"}`. Save and reconnect the service. Configuration changes may require reviewing its trust and tool permission again. This startup setting cannot be changed by an MCP tool argument. Both modes retain foreground/geometry checks, one-use observations, bounded input and visible STOP/Esc controls. The controlled window is outlined with a non-activating, mouse-transparent, light-blue translucent gradient while the native session is active. All enabled/trusted clients share this service's single session; session IDs are routing identifiers rather than separate permissions.

## Local Windows packages

Local Windows builds now include the helper, standalone service, production MCP dependencies and bundled Node under `resources/computer-use` and `resources/node`. The service remains optional; installation does not automatically trust or enable it. Published v0.6.0 assets have not been replaced.

For the unpacked local build, import `dist/windows-computer-use-mcp-config.json` (generated by the package smoke test). For an installed copy, generate paths for **that actual installation** by running its bundled Node and configuration generator:

```powershell
# From the installation directory (or dist/win-unpacked):
& .\resources\node\node.exe .\resources\computer-use\configure.cjs
```

Copy the resulting JSON into MCP Servers → Import, then enable/trust the service and grant its tool permission. This requires neither a system Node installation nor the source checkout. Moving the application requires regenerating the config. Do not reuse the unpacked build's config for a different installation directory.

Package acceptance can be repeated with `node scripts/smoke-computer-use.cjs`. It relocates the packaged service and Node into a dedicated temporary directory, verifies SDK discovery and validation, and runs native tests exclusively against disposable fixture windows. The native test also exercises the production consent picker, STOP button and Esc. Installer install/uninstall acceptance remains restricted to a dedicated CI profile by `scripts/installer-smoke.cjs`.

## Calls

1. In `all_windows`, call `{"action":"list_windows"}` and choose a returned `window_id`. Call `{"action":"open_session","window_id":"…"}`. The response immediately contains `session_id` and state `initializing`; `per_window` instead returns `awaiting_consent` and displays the picker. Local consent must finish within 45 seconds. At most one session exists and it expires after ten minutes.
2. Poll `{"action":"get_session"}` until state is `ready`. This call does not require an ID and recovers the current ID after a lost response. Repeating `open_session` also returns the current ID without opening another picker or repeating any input. A conflicting `window_id` is rejected; close the current session before switching targets. Closed status includes the last session and diagnostic code; after service restart, state is `none` and a fresh session is required.
3. `{"action":"observe","session_id":"…"}`: returns a screenshot or chunk manifest plus `observation_id`, width and height. Images use physical pixels relative to the entire window, including its frame. Maximum 4096 pixels per side and 8 megapixels. The local native PNG capture has a 40 MiB guard; there is no 2 MiB whole-image rejection. The helper uses PrintWindow; protected, GPU or unsupported windows can return blank/incorrect pixels and require application-specific testing. There is no full-desktop capture fallback. PrintWindow itself does not capture the OS cursor, so the native helper overlays the actual Windows cursor at its current physical position and hotspot when the cursor is visible inside the selected window. This is a visual aid only and does not change input coordinates. The actual Windows pointer is moved to the intended location, while a soft light-blue translucent halo is generated from the active Windows cursor's actual silhouette and hotspot, rather than using a circular radial gradient centered on the pointer. The cursor-shaped glow is cached per cursor handle and moved with the real pointer; it does not substitute a fake cursor, draw a ring, or intercept input. Unsupported cursor bitmaps produce no artificial halo. The window boundary remains a light-blue translucent gradient with increased opacity.
4. Supply that session and observation with **one** action:
   - `click`: `x`, `y`, optional `button` (`left` or `right`).
   - `type_text`: literal `text`, 1–1000 UTF-16 code units, no control characters. Unicode input uses SendInput, without clipboard or SendKeys interpretation.
   - `key_press`: `key` from the advertised allowlist (Enter, Tab, navigation and basic Ctrl editing shortcuts (Escape is reserved for ending the Computer Use session)).
   - `scroll`: `x`, `y`, `delta` from -10 to 10, excluding zero; positive scrolls upward, each unit is a Windows wheel notch.
5. Observe again after each input, including uncertain/failed input. Observations expire after 30 seconds; window geometry changes invalidate them. The target must be foreground for input. On `CU_WINDOW_NOT_FOREGROUND`, call `{"action":"activate","session_id":"…"}`, then obtain a new observation before deciding the next input. Activation needs no observation, restores a minimized target, verifies its identity and actual foreground, and invalidates previous observations even on failure. It never replays input. If Windows refuses activation, `CU_ACTIVATION_FAILED` requests manual activation; no fake Alt keys/clicks, privilege elevation or foreground-lock setting changes are used. Click/scroll targets must not be covered by a different window. Concurrent operations fail with `CU_BUSY`; status/close remain available during active operations.
6. `{"action":"close_session"}` releases this service's current session even if the original ID was lost, including during startup/consent. Supplying an ID remains supported; an incorrect ID never closes another session. Locally, click **STOP**, close the stop window, or press **Esc**. The session displays a light-blue translucent gradient outline around the selected window, which follows its geometry and is removed on close. Esc is registered as a session-wide stop key, so it cannot be delivered normally to the controlled application during the session. Failure to reserve this hotkey prevents session creation. Closing the MCP owner also exits the helper, including during the picker.

## Security and limitations

### Screenshot delivery

`observe` accepts `format: auto | png | webp` (default `auto`). It compares original PNG, optimized PNG and lossless WebP, returning the smallest candidate. Forced `png` supports clients without WebP. Resolution and pixel detail are preserved; no automatic downscaling, lossy palette quantization or JPEG compression is used. This is a practical lossless choice, not a claim of a universally optimal codec. Compression uses pinned sharp 0.35.5 and its bundled native libraries; production staging includes these dependencies and upstream notices.

Up to 1 MiB compressed, observe includes a native MCP `image` block and a structured fallback: `structuredContent.screenshot` has `screenshot_id`, actual `mime_type`, `encoding: base64`, `data`, `sha256`, `byte_length`, `source_byte_length`, candidate sizes and expiry. If a connector exposes only structured output, decode `screenshot.data` and display it using that MIME type. The text block omits bytes. Neither an observation ID nor window dimensions alone is a screenshot.

Above 1 MiB, or with `delivery: chunked`, observe returns a small manifest (`screenshot.delivery: chunked`, no data/image block, `next_action: read_screenshot`). Fetch it as follows:

```json
{"action":"read_screenshot","session_id":"…","screenshot_id":"…","offset":0,"length":262144}
```

`offset` and `length` count decoded bytes; length defaults to 256 KiB and cannot exceed 512 KiB. Each response's `structuredContent.screenshot` includes `data`, `offset`, actual `length`, `next_offset`, `eof` and `chunk_sha256`, alongside full-image metadata. Decode each Base64 chunk separately, concatenate bytes in offset order and verify the whole-image SHA-256 before display. Do not concatenate padded Base64 strings. Retrying or reading out of order is safe; resume at the returned `next_offset`. Partial chunks are not image blocks because they are not independently decodable images. Network responses remain below the existing 8 MiB gateway limit.

Only the latest compressed snapshot is cached in memory, for 120 seconds. A new observation, activation, executed input attempt or session close invalidates it. Wrong/expired screenshot IDs return `CU_SCREENSHOT_EXPIRED`. Reading does not refresh or consume the separate 30-second observation used to authorize input; observe again before input if it has expired. Expiry releases the cache automatically. No screenshot files, public image URLs or additional filesystem grants are introduced.

The actual local Harness relay/manager/gateway and installed native service passed both delivery paths. The current remote connector's rendering of `computer_use` images remains unverified; an image-preserving local gateway does not establish remote-client compatibility. Test images saved by the acceptance script contain only disposable fixture content.

Authorization is to the selected application window, not its current document or a project folder. A permitted application can open files, run commands or access the network under the user's privileges. Menus/dialogs in a separate top-level window need a new explicit session. No arbitrary program launch, script evaluation, PID termination or privilege elevation is exposed. Secure desktops/UAC and higher integrity targets are unsupported. Input is subject to Windows UIPI and foreground restrictions. Global OS input is not an atomic transaction: focus or window contents can change between validation and input, and injected text can trigger application actions. This is not an OS sandbox and cannot guarantee that every effect remains within the selected window. Use a dedicated low-privilege desktop/VM for untrusted work.

The stop control stays visible and topmost; clicks covered by it are rejected. Screenshots and text travel through the MCP client and may be retained there. This service does not persist screenshots, input text or window titles. Existing execution history stores argument summaries and statuses, not full image/input payloads; local approval dialogs display supplied arguments. No automatic replay occurs after cancellation, timeout or disconnect. Once input may have begun, errors report execution state `unknown` rather than promising nothing happened. Cancellation cannot undo input already delivered.

## Verification

```powershell
node --check app/windows-computer-use.cjs
node --check app/windows-computer-use-stdio.cjs
node --check scripts/build-computer-use.cjs
node --test tests/windows-computer-use.test.cjs
npm run test:computer-use-native
node scripts/test-computer-use-mcp.cjs
node scripts/test-computer-use-mcp.cjs --per-window
```

The latter two commands run the namespaced `windows-computer__computer_use` through the actual Harness SDK relay, authenticated gateway, manager/policy and native helper. They use disposable WinForms targets and test lost-response recovery, screenshots, click/Unicode input, no replay and ID-less cleanup. They do not use the official computer-use provider. This local acceptance gateway is isolated from the live remote Tunnel/account; the installed application connection is checked separately.

The native acceptance command opens only its own disposable test window. Exit 0 means the listed native checks passed; exit 2 means foreground access was denied, so input acceptance could not run. This is not equivalent to a full desktop pass.

The tests cover validation, sessions, native image results, stale coordinates/observations, concurrency, cancellation, no replay, consent refusal and the real stdio MCP endpoint. Native helper compilation is separate. Real-window acceptance must verify capture, Chinese input, mouse/keyboard/scroll, focus/geometry rejection, local consent, emergency stop and owner exit using a dedicated test window before relying on a specific application. Mock-backed tests are not desktop acceptance evidence.
