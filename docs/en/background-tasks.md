# Start, inspect and cancel background tasks

[English](../en/background-tasks.md) | [简体中文](../zh-CN/background-tasks.md) | [日本語](../ja/background-tasks.md)

> For ChatToHarness 0.6.0.

## Your goal

Run long work and continue checking the same task after a disconnect.

## Before you start

Identify the project, command and output location. Save important files first. Persistent tasks are normally requested through your client.

## Steps

1. Explicitly request a persistent background task and keep its returned task ID.
2. Read status and logs for that same task. Submission means it was recorded, not that it finished.
3. After completion, inspect the result, exit status and artifacts instead of relying on the last log line.
4. After disconnects, app restarts or client timeouts, query the original task ID before starting anything again.
5. To cancel, identify the task and keep checking until termination or completion is confirmed.

### Example to copy

Replace the example with your own authorized absolute project path; on Windows, use your drive-letter path.

```text
Run my specified command in /Users/demo/ExampleProject as a persistent background task. Keep its task ID and query only that task without starting a duplicate. Report exit status and artifact paths when finished.
```

![Start, inspect and cancel background tasks](../images/help/en/tasks.svg)

Workflow illustration showing the sequence, not an actual client execution result.

## What success looks like

You can inspect progress, bounded output and the final state. The project task list can help recover an ID.

## If it does not work

Closing the window, stopping the connection or even quitting the app does not guarantee that persistent tasks stop. Inspect unknown states and artifacts; tasks are not automatically replayed. Concurrency and saved output have limits, so save important artifacts as files.

## Next steps

- [Find and understand execution history](execution-records.md)
- [Find and retrieve task artifacts](artifacts.md)
- [Handle timeouts, unknown states and missing responses](uncertain-results.md)
