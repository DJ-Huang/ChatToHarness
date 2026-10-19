# Handle timeouts, unknown states and missing responses

[English](../en/uncertain-results.md) | [简体中文](../zh-CN/uncertain-results.md) | [日本語](../ja/uncertain-results.md)

> For ChatToHarness 0.6.0.

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

## Next steps

- [Find and understand execution history](execution-records.md)
- [Start, inspect and cancel background tasks](background-tasks.md)
- [Edit files and undo safe text changes](editing.md)
