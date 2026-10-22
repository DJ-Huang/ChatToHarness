# Computer Use TaskRunner V1

## Scope and authorization

This document describes only the legacy deterministic **window positioning compatibility workflow** for Windows and macOS. The product-wide architecture is now the generic autonomous GUI Agent in [computer-use-agent-architecture.md](computer-use-agent-architecture.md), not this specialized workflow. All native input remains mediated by the existing window authorization, Esc/STOP, focus, occlusion and fresh-observation protections.

The caller must already have an authorized and ready Computer Use session and an unexpired observation. A requested target specifies the authorized window's **top-left desktop coordinate**. It must fit wholly on a reported display before any drag is issued. Source and target are never switched to another window or another Harness device.

## Architecture

\`\`\`mermaid
flowchart TD
  A["Authorized Computer Use session"] --> B["start_move_task: goal + idempotency key"]
  B --> C["TaskRunner: one active task per controller"]
  C --> D["Atomic JSON checkpoints (no screenshots)"]
  C --> E["Observe actual window geometry"]
  E --> F{"Position verified?"}
  F -->|Yes| G["Succeeded; close native session/HUD"]
  F -->|No| H{"Safe drag and display geometry?"}
  H -->|Yes| I["Atomic drag_window"]
  H -->|No| J["Wait and re-observe"]
  I --> E
  J --> E
  C --> K{"STOP/Esc/cancel/session terminated?"}
  K -->|Yes| L["Cancel or session_terminated; never reopen"]
\`\`\`

## MCP contract

The shared \`computer_use\` tool advertises:

| Action | Required fields | Meaning |
|---|---|---|
| \`start_move_task\` | \`session_id\`, \`observation_id\`, \`target_x\`, \`target_y\`, \`idempotency_key\` | Persist and start an authorized window-move task |
| \`get_move_task\` | \`session_id\`, \`task_id\` | Read task state, latest observed geometry, attempts and phase |
| \`cancel_move_task\` | \`session_id\`, \`task_id\` | Record cancellation, release native control and end the original session |

The stable idempotency key deduplicates a lost \`start_move_task\` response, including after an observation is consumed or task completion. Reusing the key with different coordinates is rejected. Only one move task may run in a controller at a time; concurrent manual input is rejected without interrupting the running task.

A successful \`drag_window\` call **never** concludes the workflow. The next fresh \`observe\` must verify that the window reached the target (within two desktop coordinate units). If the drag outcome is uncertain and native control remains authorized, the loop re-observes before determining any remaining movement. An uncertain post-mousedown native failure ends the session and cannot be blindly replayed.

## Durability and lifecycle

The task stores small, atomic JSON records in the current user's private \`.chattoharness/computer-use-tasks\` directory, scoped by session ID and a hashed idempotency key. The record captures a goal, window identity, phase, actual observed geometry, attempt count, error code and final state; **screenshots, typed text, raw mouse inputs and credentials are not persisted**.

The local event loop continues execution across independent MCP calls while the owning Computer Use service process and original native session are alive. Temporary focus loss and input occupancy are recoverable without a fixed retry count; exponential backoff avoids aggressively fighting user input. STOP/Esc, explicit cancellation, native helper death, revoked authority or session expiry ends execution. Completion releases native control/HUD.

After a service restart the original native session is not restored. A previous nonterminal checkpoint is reported as \`interrupted\` and **never automatically replayed**. A newly authorized session and fresh observation are required for a new task. This explicitly limits the meaning of "persistent": checkpoints survive process restarts; active GUI control does not survive termination of the authorized session.

## Test and release evidence (2026-10-22)

Node mock tests run without using the real OS mouse. They cover recovery from pre-mousedown input conflict, verified geometry, idempotency, cancellation, uncertain injected input, session termination, restart without replay, no-op goal, shared schema and packaging manifest. The targeted cross-platform test set on Windows passed **71 total / 67 passed / 0 failed / 4 macOS-only skipped**. \`git diff --check\` passed.

Not yet claimed: fresh installed-app interaction, real desktop mouse/HUD behavior of this version, macOS Swift runtime acceptance or a fully independent process-resilient GUI session. Full-suite failures from prior Windows runs (symlink EPERM, task-store timeouts, packaging fixtures) need separate follow-up and are not evidence that these tests passed.
