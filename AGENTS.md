# ChatToHarness Agent Instructions

## Required Computer Use Policy

Every AI call to `computer_use` `open_session` MUST include a readable `session_title` describing only the authorized task, not the ChatGPT chat name. Never invent the ChatGPT conversation title: it requires explicit host metadata. Computer Use task IDs use the registered device ID and millisecond timestamp (optional collision sequence); legacy hash-based IDs are unsupported during development.


Before performing or modifying desktop GUI operations, read and follow [docs/computer-use-policy.md](docs/computer-use-policy.md). It is the repository's source of truth for visible real-input operations, device routing and failure reporting.

**Device routing:** explicit user device > trustworthy current ChatGPT session device association > sole available Computer Use device > numbered 1/2/3 device choices. If the user does not name a device, default directly to the current session's associated Harness when known; do not ask for device UUIDs. Do not invent a session association.

**Desktop interaction:** default to scoped Computer Use real mouse/keyboard. Do not silently substitute an OS API. The user explicitly permits OS window-positioning API fallback when visible dragging cannot complete the authorized ChatToHarness window move. Follow docs/computer-use-policy.md: validate target/window/device permissions, preserve Esc/STOP and user takeover, close any active CU session, restrict changes to authorized window position only, independently verify, and disclose the actual method. This is not blanket authorization for other targets or GUI actions.

**Computer Use session naming:** `session_title` is the current operation label only. The real ChatGPT/Codex conversation title must come from authenticated host-supplied metadata; missing titles appear as unavailable. Never put a UUID or fabricated title in the chat field.

**Windows and macOS Computer Use task continuity:** For GUI tasks prefer the platform-neutral start_task/get_task/cancel_task/submit_task_decision contract. A trusted Planner adapter may continue autonomously across fresh observations; otherwise the ChatGPT/Codex caller must submit a decision when awaiting_decision. Legacy start_move_task is only a compatibility fixture, not the framework architecture. Never close_session until a task is terminal, unless the user requests STOP/Esc. Keep the authorized task active across recoverable input errors with no fixed attempt limit while its original session remains valid and the user has not explicitly stopped. CU_USER_INPUT_ACTIVE is not cancellation. Recover by safe observation/activation, never replay uncertain side effects or bypass STOP/Esc, user takeover, permissions or a terminated session. Follow policy section 0.

Preserve Esc/STOP, per-window authorization, screenshots, input interruption safety, and exact distinction between real GUI acceptance and static/unit tests. The repository's documentation cannot enforce routing inside ChatGPT itself; do not claim that it can.

## Repository development

Follow existing `docs/dev.md`, relevant local instructions, and work-item/issue tracking. Keep changes on the current branch, test the actual target platform when authorized, preserve unrelated edits, and record verifiable results. Do not use worktrees.
