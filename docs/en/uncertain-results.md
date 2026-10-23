# Handle timeouts, unknown states and missing responses

[English](../en/uncertain-results.md) | [简体中文](../zh-CN/uncertain-results.md) | [日本語](../ja/uncertain-results.md)

> Available in v0.6.2.

## Your goal

Establish what actually ran before deciding whether to retry.

## Before you start

Keep the time, request or task ID and the current file or application state.

## Steps

1. Find the request in execution history and distinguish not started, running, successful, failed and unknown.
2. Not started means this operation did not run; complete its arguments, instructions or permissions before submitting again.
3. For an unknown state or a timeout after starting, inspect files, the external app and any linked task.
4. Query background work using its original task ID. For a safe text edit, inspect the original edit record rather than creating another edit.
5. If local execution succeeded but the client received nothing, reread the result instead of repeating the write.
6. If a retry is needed, identify the original operation and existing results to preserve.

### Example to copy

Replace the example with your own authorized absolute project path; on Windows, use your drive-letter path.

```text
Inspect the execution record and existing task for my last operation. Report its actual state and artifacts first. Do not repeat the write or start the command again.
```

![Handle timeouts, unknown states and missing responses](../images/help/en/history-detail.png)

1 Record details; 2 Copy diagnostic summary; 3 Detailed diagnostics. Interface demonstration using the current repository UI and isolated sample data; not evidence of a live tunnel or tool call.

## What success looks like

You distinguish a missing response from a missing execution and avoid duplicate files or commands.

## If it does not work

A response written locally does not prove remote receipt. Reconnection does not replay operations. Cancellation also requires a final-state check; requesting cancellation does not prove termination.

### Recover saved results (current source)

Execution details show result availability and provide Copy recovery information for querying the original task or saved result in chat. `get_execution_summary` also returns result references. Small and large ordinary tool results can be saved. The separate cache holds at most seven days and 50 MiB; capacity pressure can expire results earlier. Native previews retain their format, and recovery reads do not create another snapshot. Results may contain file bodies and other user content and are stored in a private local directory; current source permissions still apply. Storage failures, expired snapshots and legacy records without saved results are explicit and never authorize replaying a mutation.

### Query diagnostics without guessing log paths

- For tool failures, call `get_execution_summary` with an authorized `project_path`, `state:"errors"` and an optional `since`. Add `include_connection:true` for bounded app connection events.
- For disconnects, reconnects and retry delays, call `get_harness_status` and read `connection.events`. These application-wide records contain states, timestamps and retry delays, excluding other projects’ calls, raw log messages and credentials. History is bounded; an empty list does not prove there were no earlier disconnects.
- For task stdout/stderr, call `get_task_result` or `get_task_logs` with the original `task_id`.

Do not guess OS log directories or app-storage paths, or broaden project scope to read diagnostics. A rejected log read retains its rejection and suggests a callable diagnostic tool; it neither expands permissions nor automatically calls an alternative.

The tunnel requests a one-second initial poll. Unexpected exit triggers immediate detection; brief outages use fast retries and sustained failures back off to 10/30 seconds. Backoff resets after 30 seconds of continuous readiness; stopping cancels scheduled retries. Network, server and proxy delays still affect recovery. Tool deadlines and task replay behavior do not change.

## Next steps

- [Find and understand execution history](execution-records.md)
- [Start, inspect and cancel background tasks](background-tasks.md)
- [Edit files and undo safe text changes](editing.md)
