# Execution records V1

`executions/exec_<uuid>.json` schema 1 is a local diagnostic record, not an audit or replay journal. A generated `request_id` is stable through received, waiting_approval, running and terminal updates. It includes service/tool, a bounded argument description (content, commands, environment and arbitrary string values are omitted), project when supplied, timestamps, elapsed milliseconds, instance UUID, application version, optional task ID, error code/snippet and optional bounded explicit stdout. Task details also read at most 16KiB of existing task output to show a sanitized 2KiB stdout preview. Input wire IDs are scoped to a gateway session; they map to the generated ID and are never reused across sessions. Status/log polls within one minute fold into a record with `poll_count` and `last_received_at`.

Execution and delivery are independent. `delivery` is unknown, local_write_succeeded or local_write_failed. A successful socket callback proves only a local transport write, **never** ChatGPT receipt. `remote_ack` remains unknown. Timeouts/disconnections remain unknown; nothing replays mutations. Restart marks unresolved ordinary executions unknown. `start_task` means submitted, not command success; periodic maintenance reads worker state, links timestamps and terminal state, and marks stale worker state unknown. Cancellation without a confirmed worker outcome remains unknown.

History IPC is sender/frame checked by the existing main-process boundary: paginated list (maximum 100), detail, selected export (maximum 100), and a boolean diagnostics toggle. Startup state contains no history. The sandboxed renderer renders untrusted values as text. Diagnostic stdout is opt-in, only from an explicit structured stdout field, at most 2KiB, automatically disabled after 30 minutes and reset on restart. Error snippets are at most 16KiB, summaries 2KiB; records are bounded below 24KiB including JSON escaping. Arbitrary result content, images and base64 are never saved to history. Task output retains the existing per-task 4MiB ceiling, with bounded lines, secret/environment redaction and omission of oversized lines.

Optional `execution_state` records the tool's reported execution phase, and `recovery_kind` distinguishes `needs_arguments` and `needs_context` for known built-in rejections before execution. Their underlying state remains `failed` for compatibility; All/Tools and history show the recovery label, while Errors excludes these informational cases. Old built-in records with these exact codes receive the same presentation without a data migration. Unknown outcomes, external errors, permission denials and local transport write failures remain errors. Retry patches and context tokens are never persisted in execution history.

## Live log page

The overview has a visible **View live logs** shortcut and the sidebar provides a
separate **Live logs** page alongside the existing execution-history table. The
log panel follows the bounded `logs/app.log` JSONL stream and its rotated
`app.log.previous` file, with a read-only IPC method `live-logs-read`. Record
state changes generate sanitized `execution` entries. Filtering is local to the
current view: **All / Tools / Connections / Errors**, plus text search. Updates
poll every two seconds while the panel is visible, with pause/resume, a manual
reload and optional automatic scroll. Only 400 entries are kept in renderer
memory. Clearing the view never deletes saved logs.

The renderer coalesces execution updates with the same request ID, execution state and error code, including updates arriving on different polling pages. Distinct requests and execution phases remain separate. Raw JSONL events are unchanged. `local_write_succeeded` displays as **Response written to local channel**, which is neither file-write success nor remote receipt.

The reader accepts no filesystem path, reads at most 128KiB per file per
request, validates cursor offsets and file identity across rotation, skips
partial JSONL lines, refuses symlinks and hardlinks, and re-sanitizes legacy
entries. It does not stream full tool output, file contents or secrets.
Full task status and bounded details remain on the Execution history page.

## Retention and cleanup order

App and detached workers share `diagnostic-budget.lock` in the storage home. The desktop app delegates diagnostic disk writes, cleanup and inventory to a worker thread. Its main-thread execution cache is updated immediately; pending snapshots coalesce by request ID. Standalone legacy consumers may retain synchronous persistence. Task requests, replay guards and undo data remain synchronously durable. Execution updates coalesce in a retry queue capped at 512 records (at most 12MiB), retried every 100ms; task/app log contention drops diagnostic output instead of building queues. Dead PID locks are reclaimed conservatively. Regular files are counted by stored size; only private files are cleaned. Symlink directories/symlinks are not followed and hardlinks are never modified. Eligible files are app.log, app.log.previous, execution JSON/temp files, temporary files directly in diagnostics/, and finished tasks' output.jsonl. Task state, request, fingerprint, claim, cancellation and idempotency guards are never removed. Runtime components, credentials, updates and edit undo data are not diagnostics.

Startup and minute maintenance remove eligible files older than seven days, execution records beyond 10,000, and oldest eligible files starting near 40MiB. The shared hard ceiling is 50MiB, including active task output; detailed records count conservatively in full toward a 10MiB share of that ceiling. Workers stop output at 46MiB to leave terminal-record headroom and enforce the shared ceiling after the Electron app exits. Active records and in-flight task output are pinned; under prolonged pressure or queue overflow new diagnostic writes can be dropped. This is explicitly best-effort history, not a guarantee that every call survives disk exhaustion, contention, permission errors or a power failure before recording. Unknown execution is never evidence that an operation did not run.

Before deleting finished task output, cleanup writes output.expired. Log cursors then fail with TASK_LOG_EXPIRED instead of returning output from a different byte position. No active output is truncated or removed. Cleanup does not recycle task IDs.

## Task metadata capacity and manual archival

The existing 1024-task metadata limit remains intentional: automatically removing a request/claim would allow an old idempotency key to execute again. To archive safely, stop submitting tasks and confirm every task selected for archival has a finished_at and no surviving worker/child process. Back up the complete task directory (request, state, claim and any output) to private offline storage. Remove only those finished directories from tasks/. Keep an external permanent register of archived project/idempotency keys and never submit those keys again while their guards are absent. To query or reuse an archived key, restore the entire original directory before making any tool call. If those conditions cannot be ensured, keep the guards and use another storage profile rather than deleting metadata. Archival is manual and never runs during retention.

## Chat query summaries and worker persistence

`get_execution_summary` requires an authorized project and exposes only safe execution metadata, bounded error reasons and task IDs. It excludes commands, argument summaries and stdout. Execution cache reads do not scan the diagnostic directory during app tool calls. A bounded diagnostic writer queue owns app log rotation and shared-budget writes; worker failure never falls back to synchronous main-thread scanning. Shutdown awaits a bounded flush. A successful diagnostic enqueue is not a disk or remote acknowledgement.

In-flight `delivery=unknown` is informational. Terminal unknown outcomes and failed local transport writes remain errors. Legacy omitted optional fields are not error codes. Task maintenance copies actual worker execution state and exit results.

## Gateway phase timing

`mcp-timing` records local session/request ordinals, a fixed protocol method and bounded numeric phase durations: frame assembly/JSON parsing, receive-to-dispatch, initialize-response-to-notification, and local response writing. It excludes wire IDs, arguments, tokens and response bodies. `mcp-result-ready` carries the same local session/request ordinals. A repeated initialized notification is not a new process or a catalog refresh. A gap before the next local request does not identify which remote component waited; socket write completion is not browser receipt. Pair these events with native browser EventStream receipt times and a visibly completed answer when measuring web performance.
