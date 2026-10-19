# Complete your first task

[English](../en/first-task.md) | [简体中文](../zh-CN/first-task.md) | [日本語](../ja/first-task.md)

> For ChatToHarness 0.6.0.

## Your goal

Verify the whole connection with a read-only check and a separate trial file.

## Before you start

Authorize an empty trial folder, make the tunnel ready and discover tools in the client. Replace the sample path with your own absolute path.

## Steps

1. Select the connected ChatToHarness plugin in your client and send the read-only example below.
2. Check that an actual tool result lists the folder or describes the project. A model saying “done” alone is not verification.
3. Ask it to create a new hello-harness.txt in the trial folder, containing “Connection test”, then read it back.
4. Compare the returned content with the local file and locate the call in execution history.
5. For cleanup, identify only this trial file or remove it yourself in the system file manager.

### Example to copy

Replace the example with your own authorized absolute project path; on Windows, use your drive-letter path.

```text
Show the project overview and file list in /Users/demo/ExampleProject. Do not modify any files.
```

![Complete your first task](../images/help/en/workflow.svg)

Workflow illustration showing the sequence, not an actual client execution result.

## What success looks like

Both the read-only result and the read-back match the actual folder and file. This verifies a real client-to-computer tool call.

## If it does not work

If no result arrives, inspect execution history before creating the file again. If the first write asks to read project instructions, have the client read them and continue the original request.

## Next steps

- [Read documents, images and spreadsheets](reading.md)
- [Edit files and undo safe text changes](editing.md)
- [Find and understand execution history](execution-records.md)
