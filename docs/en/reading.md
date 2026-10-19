# Read documents, images and spreadsheets

[English](../en/reading.md) | [简体中文](../zh-CN/reading.md) | [日本語](../ja/reading.md)

> For ChatToHarness 0.6.0.

## Your goal

Read local material and connect answers to the actual source.

## Before you start

Place the file in an authorized folder. Know the filename; for spreadsheets, identify the sheet and cell range.

## Steps

1. Give the path and question. Common formats include text, images, PDF, Word and spreadsheets; results depend on the file.
2. For long text, select a section or line range. For Excel, name the sheet and range instead of reading a large workbook at once.
3. Ask to compare several files together and identify the source of each conclusion.
4. Ask to inspect actual images. For scans or pages that cannot be extracted, request a clear statement of what was unavailable.
5. Verify important conclusions against the original text, page or cell.

### Example to copy

Replace the example with your own authorized absolute project path; on Windows, use your drive-letter path.

```text
Read /Users/demo/ExampleProject/report.docx and summarize the main conclusions with supporting excerpts. Do not modify it.
```

![Read documents, images and spreadsheets](../images/help/en/files.svg)

Workflow illustration showing the sequence, not an actual client execution result.

## What success looks like

The answer uses actual file results and identifies its sources; unread pages are not presented as checked.

## If it does not work

Empty output may indicate a scanned PDF, damaged file or unsupported format. Narrow the range or use a readable copy. Failure to parse does not mean the file is empty.

## Next steps

- [Search filenames and content](search.md)
- [Find and retrieve task artifacts](artifacts.md)
- [Edit files and undo safe text changes](editing.md)
