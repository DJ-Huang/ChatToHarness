# ADR 0002 — Device-bound Computer Use tool registration

Status: **0.7.1: automatic connector-bound identity; host-side ambiguous-user-intent handling remains advisory** (2026-10-21).
Tracked by [ChatToHarness #1](https://github.com/watermoon/ChatToHarness/issues/1); development branch `feat/computer-use`.

## Decision

Each independent Windows/macOS Harness registers its own `computer_use` tool. At registration, the tool includes an explicit local device identity:

- A stable per-install random `cu-UUID`, persisted as `computer-use-device-id` in the app's settings directory. This is a routing identifier, **not** an authentication secret.
- Human-friendly current hostname and platform in `title` and `description` (readable even if the client discards MCP metadata).
- Structured `_meta["com.chattoharness/device"] = {id, name, platform}` (readable by MCP consumers supporting tool metadata).
- Optional JSON Schema `target_device_id` with `const` equal to the local device ID. The user is never asked for this ID; the selected connector itself identifies the device.

The ChatGPT session discovers device identities through the accessible MCP tool catalog. Routing priority is **explicitly named device > trusted current conversation-bound device > single available device > numbered selection (1, 2, 3, …)**. In particular, if two or more Harnesses are online and the user does not name a target, choose the current conversation's verified device directly, without prompting. Only when no unique device can be resolved should ChatGPT list friendly names/platforms and ask the user to enter a number (never a UUID). An explicit target overrides the session binding; an unavailable explicit/bound device never silently fails over. The selected connector **automatically binds its own ID**. An *explicitly supplied* incorrect ID fails with `CU_TARGET_DEVICE_MISMATCH`; omitting the ID is a normal supported call. A successful selection forwards the original input to the native controller, retaining its window consent, Screen Recording/Accessibility, fresh observation, stop key and cleanup checks.

Each Harness validates only its **own** identity. The standalone server does not itself maintain a global online roster or ChatGPT conversation binding. `resolveComputerUseDevice` in `app/computer-use-devices.cjs` is a tested, pure rule for a trusted caller that has those inputs; it is **not** wired into the ChatGPT client/router and does not fabricate that missing context. This simplifies multiple independent Windows/macOS connectors and does not assume both machines share a tunnel or a filesystem.

## Registration paths

The desktop application's opt-in MCP `computer_use` and the optional macOS/Windows standalone stdio MCP entries both use `app/computer-use-devices.cjs` to build the device-bound schema and validate arguments. Standalone services derive the same app settings path as the Electron runtime, so the device IDs agree on a given installation. The resource staging manifest includes the shared helper.

`get_harness_status.device.computer_use_id` and the desktop status continue to expose the same device ID without starting a control session. The same `name` and `platform` appear in the registered tool metadata.

## Important limitation

**Selecting a connector is not proof of the user's intent.** A model could invoke the wrong connector despite the descriptive metadata. `docs/computer-use-policy.md` is the canonical GUI-operation and device-routing policy, referenced by `AGENTS.md` and tool descriptions. Visible real mouse/keyboard actions are the default for desktop operations; direct window position changes require explicit intent. The tool descriptions instruct it to prefer the conversation-associated device and ask for numbered choices only when association is unknown, but only the ChatGPT client/router can inspect all connected tools and enforce that request-based choice. This repository does not implement a ChatGPT-hosted selection dialog and cannot inspect the online state of other independent Harness instances. Stronger enforcement needs a trusted client-side router or host-issued selection token.

## Acceptance boundary

- Mac-only local development and validation through `macHarness`. Shared device registration tests, real macOS MCP tool enumeration, and native macOS compiler checks apply.
- No `winHarness` calls, Windows-native compilation/GUI tests, or Windows computer-use acceptance in this change.
- The previously reported real macOS GUI `CU_USER_INPUT_ACTIVE` remains an unresolved visual-input acceptance blocker; unit/schema/compiler passes do not constitute a successful real cross-display drag.
- No running installed application is silently replaced; this change takes effect when a build including it is started and the connector tool catalog refreshes.
