# ChatToHarness Agent Instructions

## Required Computer Use Policy

Before performing or modifying desktop GUI operations, read and follow [docs/computer-use-policy.md](docs/computer-use-policy.md). It is the repository's source of truth for visible real-input operations, device routing and failure reporting.

**Device routing:** explicit user device > trustworthy current ChatGPT session device association > sole available Computer Use device > numbered 1/2/3 device choices. If the user does not name a device, default directly to the current session's associated Harness when known; do not ask for device UUIDs. Do not invent a session association.

**Desktop interaction:** by default use the selected device's Computer Use real mouse/keyboard controls. Do not silently substitute AppleScript, Accessibility/Win32 position APIs or `start_process` scripts for visible window dragging. Use direct setpos/setsize only on explicit request with suitable authorization; fail transparently otherwise.

Preserve Esc/STOP, per-window authorization, screenshots, input interruption safety, and exact distinction between real GUI acceptance and static/unit tests. The repository's documentation cannot enforce routing inside ChatGPT itself; do not claim that it can.

## Repository development

Follow existing `docs/dev.md`, relevant local instructions, and work-item/issue tracking. Keep changes on the current branch, test the actual target platform when authorized, preserve unrelated edits, and record verifiable results. Do not use worktrees.
