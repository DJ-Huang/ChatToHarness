# Run commands and interactive sessions

[English](../en/terminal.md) | [简体中文](../zh-CN/terminal.md) | [日本語](../ja/terminal.md)

> For ChatToHarness 0.6.0.

## Your goal

Run a specific local command and continue reading output or providing input when needed.

## Before you start

Install the required command on the computer and identify its working directory. Commands run with your user permissions.

## Steps

1. State the command, actual working directory and expected output, rather than only a vague goal.
2. For short commands, inspect output and the exit status.
3. For an interactive command, keep the returned session identifier to send input or read more output.
4. List sessions to find the one to end, then stop that specific session.
5. Use a persistent background task for long work or results that must survive a disconnect.

### Example to copy

Replace the example with your own authorized absolute project path; on Windows, use your drive-letter path.

```text
In /Users/demo/ExampleProject, read-only check the current directory and available Git version. Do not modify files. Return output and exit status.
```

![Run commands and interactive sessions](../images/help/en/tasks.svg)

Workflow illustration showing the sequence, not an actual client execution result.

For process troubleshooting, list local processes first and identify the exact target before requesting termination. Do not terminate an unrelated process.

## What success looks like

You receive command output and can distinguish running, waiting for input and finished states. Keep the session identifier for follow-up actions.

## If it does not work

Directory authorization is not a terminal sandbox; commands can access the network or other folders. A timeout does not prove a command never ran. Sessions can become invalid after reconnecting; inspect the process or files before repeating work.

## Next steps

- [Start, inspect and cancel background tasks](background-tasks.md)
- [Handle timeouts, unknown states and missing responses](uncertain-results.md)
- [Understand access, credentials and local records](privacy.md)
