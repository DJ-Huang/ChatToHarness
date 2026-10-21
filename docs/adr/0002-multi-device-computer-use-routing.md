# ADR 0002 — Device-bound Computer Use tool registration

Status: **implemented for app-owned and standalone stdio MCP registration; host-side user-intent enforcement remains advisory** (2026-10-21).
Tracked by [ChatToHarness #1](https://github.com/watermoon/ChatToHarness/issues/1); development branch `feat/computer-use`.

## Decision

Each independent Windows/macOS Harness registers its own `computer_use` tool. At registration, the tool includes an explicit local device identity:

- A stable per-install random `cu-UUID`, persisted as `computer-use-device-id` in the app's settings directory. This is a routing identifier, **not** an authentication secret.
- Human-friendly current hostname and platform in `title` and `description` (readable even if the client discards MCP metadata).
- Structured `_meta["com.chattoharness/device"] = {id, name, platform}` (readable by MCP consumers supporting tool metadata).
- Required JSON Schema `target_device_id` with `const` equal to the local device ID, on **every invocation**, including `list_windows`, `get_session`, `mouse_up` and `close_session`.

The model/client must use the connector corresponding to the user-chosen machine and include its advertised `target_device_id`. If the user has not indicated which device to use, the model/client should **ask which machine** instead of choosing one from the connected tools. A specified but incorrect device ID fails with `CU_TARGET_DEVICE_MISMATCH`; a missing ID fails with `CU_DEVICE_SELECTION_REQUIRED`. Neither error starts native control. Correctly targeted calls strip the extra parameter before invoking the existing native controller, retaining its window consent, Screen Recording/Accessibility, fresh observation, stop key and cleanup checks.

The rule is unconditional: no device count, shared online-presence roster, or cross-platform default-route guess is needed. Each Harness validates only its **own** identity. This simplifies multiple independent Windows/macOS connectors and does not assume both machines share a tunnel or a filesystem.

## Registration paths

The desktop application's opt-in MCP `computer_use` and the optional macOS/Windows standalone stdio MCP entries both use `app/computer-use-devices.cjs` to build the device-bound schema and validate arguments. Standalone services derive the same app settings path as the Electron runtime, so the device IDs agree on a given installation. The resource staging manifest includes the shared helper.

`get_harness_status.device.computer_use_id` and the desktop status continue to expose the same device ID without starting a control session. The same `name` and `platform` appear in the registered tool metadata.

## Important limitation

**A required device ID is not proof of an actual user's selection.** A model could still populate it by itself from visible metadata. The tool descriptions mandate asking when target intent is absent, but only the ChatGPT client/router can enforce that rule based on the user's message or provide an actual UI selection. This repository cannot implement or verify a ChatGPT-hosted selection dialog. No local application claims to know how many *other* Harness instances are online. For stronger enforcement, a host-issued user-selection token would need to be supplied and verified by a trusted host integration.

## Acceptance boundary

- Mac-only local development and validation through `macHarness`. Shared device registration tests, real macOS MCP tool enumeration, and native macOS compiler checks apply.
- No `winHarness` calls, Windows-native compilation/GUI tests, or Windows computer-use acceptance in this change.
- The previously reported real macOS GUI `CU_USER_INPUT_ACTIVE` remains an unresolved visual-input acceptance blocker; unit/schema/compiler passes do not constitute a successful real cross-display drag.
- No running installed application is silently replaced; this change takes effect when a build including it is started and the connector tool catalog refreshes.
