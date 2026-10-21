# ADR 0002 — Explicit device selection for multi-device Computer Use

Status: **partially implemented** (2026-10-21). Issue: [#1](https://github.com/watermoon/ChatToHarness/issues/1), branch `feat/computer-use`.

## Product rule

1. Detect connected Computer Use capable devices from the **ChatGPT-level connector/tool registry** (not solely the local harness).
2. With exactly one online device, route to it as usual.
3. With more than one online device, if the user's request names a specific device (stable device ID, unambiguous host name, or unambiguous platform), route **only** to that device. If ambiguous or absent, **show a selection dialog in ChatGPT before any Computer Use call**. Display friendly name and platform; never preselect a device.
4. The explicit selection binds the current native control session, allowing its subsequent mouse operations and emergency release without another prompt. It is not blanket or permanent permission for new sessions or subsequent tasks. A local OS window authorization, Screen Recording/Accessibility, fresh observation and STOP/Esc remain independent safeguards.
5. If the chosen device disconnects, do not silently fail over to another. If presence cannot be authenticated or is stale, fail closed rather than guessing.

## Implemented in this repository

- Durable per-install random `computer-use-device-id` with current host name and platform. The same ID appears in `get_harness_status.device.computer_use_id` and the published Computer Use tool description.
- Optional `target_device_id` on the app-owned Computer Use tool. A mismatch rejects **before creating a native helper** (`CU_TARGET_DEVICE_MISMATCH`).
- Injectable **trusted** online device roster (max 30 seconds old); if it lists more than one unique device, missing target returns `CU_DEVICE_SELECTION_REQUIRED` with choices and no native action. Stale or untrusted rosters block with `CU_DEVICE_ROSTER_UNAVAILABLE`. The roster cannot be supplied by a model's Computer Use request.
- The tool description instructs the ChatGPT caller to resolve ambiguous platform/device intent **before** calling the tool. It is guidance, not proof that the user clicked a dialog.

## Integration limitation / remaining work

**This app instance cannot discover other independent `winHarness`/`macHarness` connectors**. Each local connection is registered separately in ChatGPT. No existing central online-presence API or hook for displaying a modal in the ChatGPT host was found in this repository. Accordingly, the current app does **not** supply a global online roster, and this change **does not implement a native ChatGPT device-selection dialog**. The conditionally enforced roster gate is tested with an injected verified registry fixture; it is not wired to a real cross-device provider.

To finish the requested behavior, add an authoritative aggregate router in the ChatGPT connector/host layer (or one shared MCP aggregator) that lists the online devices, owns the selection dialog, passes a verified roster to the selected harness, and forwards a device-bound user-selection token. The server should validate this token, not just a model-supplied ID. Do not build a selection popup in each local desktop: a Mac instance cannot authorize routing into a Windows instance.

## Mac-only validation boundary

All development and verification in this iteration used `macHarness`; no `winHarness` operations or Windows-native acceptance were performed. The Mac native helper compiles and Computer Use controller/device-gate tests pass. A real Mac GUI test reached input but was blocked by `CU_USER_INPUT_ACTIVE`; that is not a PASS. No packaged app was installed over the running desktop.
