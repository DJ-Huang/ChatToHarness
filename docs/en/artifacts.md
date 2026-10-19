# Find and retrieve task artifacts

[English](../en/artifacts.md) | [简体中文](../zh-CN/artifacts.md) | [日本語](../ja/artifacts.md)

> For ChatToHarness 0.6.0.

## Your goal

Locate files actually produced by a task and inspect readable results.

## Before you start

Know the project and expected output location. File tools can read artifacts only within authorized folders.

## Steps

1. Specify where output files should be saved when starting the task.
2. After it finishes, list the paths, sizes and types of files that actually exist.
3. Read text in sections. Supported small images can be previewed; large files may be returned in parts.
4. Use an actual attachment or file link if your client offers one. Otherwise, open the path in your computer’s file manager.
5. Verify important content and sizes, and keep the final copies you need.

### Example to copy

Replace the example with your own authorized absolute project path; on Windows, use your drive-letter path.

```text
Check the files actually present in /Users/demo/ExampleProject/output. List paths, sizes and types and preview supported images. Do not report nonexistent files as generated.
```

![Find and retrieve task artifacts](../images/help/en/files.svg)

Workflow illustration showing the sequence, not an actual client execution result.

## What success looks like

You inspect real, accessible files. A filename mentioned in chat does not prove a file or attachment was created.

## If it does not work

For missing files, check task completion, the output path and permissions. A limited response does not mean the file is damaged; read sections or open it locally. Not every client displays a download button.

## Next steps

- [Read documents, images and spreadsheets](reading.md)
- [Start, inspect and cancel background tasks](background-tasks.md)
