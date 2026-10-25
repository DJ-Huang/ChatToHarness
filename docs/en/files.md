# Browse and organize files

[English](../en/files.md) | [简体中文](../zh-CN/files.md) | [日本語](../ja/files.md)

> For ChatToHarness 0.8.1.

## Your goal

Find specific files and organize a clearly defined set of folders.

## Before you start

Add and save the target folder under Work directories. Example paths: /Users/demo/ExampleProject on Mac; C:\Users\demo\ExampleProject on Windows.

## Steps

1. Ask for a folder listing and identify files by name, type or size. Request file information when needed.
2. To create a folder, give its full location and name.
3. For moves or renames, specify the source, destination and exact set of files.
4. Ask the client to report existing destination names before overwriting anything.
5. List both locations again to check the actual result.

### Example to copy

Replace the example with your own authorized absolute project path; on Windows, use your drive-letter path.

```text
List the top-level files, types and sizes in /Users/demo/ExampleProject. Do not move, rename or delete anything.
```

Local images above 1 MiB return chunk guidance. With `preview:true`, `get_file_result` delivers a derived JPEG preview up to 512 KiB for large images. Use `preview:false` and omit `length` for the unchanged original bytes. Artifacts are limited to 64 MiB. Omit `length` for original bytes: binary pages return up to 5 MiB, fitting files in one call. Explicit smaller ranges remain supported. Previews include a small 32 KiB byte page by default; text pages are limited to 512 KiB. Follow `next_offset`, decode each Base64 chunk separately, concatenate bytes and verify SHA-256. Oversized built-in results fail delivery without stopping file tools; an external service disconnected by an oversized response reconnects without replaying the call.

![Browse and organize files](../images/help/en/files.svg)

Workflow illustration showing the sequence, not an actual client execution result.

## What success looks like

The directory listing shows the intended names and locations, with unrelated files unchanged.

## If it does not work

If access fails, check folder permissions. The resolved destination of a shortcut or link must also be authorized. There is no general recycle bin or undo-all for organization; review the scope before moving files.

## Next steps

- [Read documents, images and spreadsheets](reading.md)
- [Search filenames and content](search.md)
- [Manage work directories and project instructions](work-directories.md)
