# Desktop Commander 0.3.0 compatibility

The official pinned engine and all 25 tool names are retained. Native evidence uses disposable synthetic projects. Every platform must run its own acceptance; no Windows execution is claimed from this Mac.

| Official tool | macOS arm64 | Windows x64 | Evidence / boundary |
|---|---|---|---|
| `get_config` | verified | Native run pending | Synthetic native invocation succeeded. |
| `set_config_value` | partial | Native run pending | Ordinary configuration works. Authorized-folder expansion through a tool is intentionally unsupported; use desktop settings. |
| `read_file` | verified | Native run pending | Synthetic native invocation succeeded. |
| `read_multiple_files` | verified | Native run pending | Synthetic native invocation succeeded. |
| `write_file` | verified | Native run pending | Synthetic native invocation succeeded. |
| `write_pdf` | verified | Native run pending | Synthetic Markdown PDF creation and native readback. |
| `create_directory` | verified | Native run pending | Synthetic native invocation succeeded. |
| `list_directory` | verified | Native run pending | Synthetic native invocation succeeded. |
| `move_file` | verified | Native run pending | Synthetic native invocation succeeded. |
| `start_search` | verified | Native run pending | Synthetic native invocation succeeded. |
| `get_more_search_results` | verified | Native run pending | Synthetic native invocation succeeded. |
| `stop_search` | verified | Native run pending | Synthetic native invocation succeeded. |
| `list_searches` | verified | Native run pending | Synthetic native invocation succeeded. |
| `get_file_info` | verified | Native run pending | Synthetic native invocation succeeded. |
| `edit_block` | verified | Native run pending | Synthetic native invocation succeeded. |
| `start_process` | verified | Native run pending | Synthetic native invocation succeeded. |
| `read_process_output` | verified | Native run pending | Synthetic native invocation succeeded. |
| `interact_with_process` | verified | Native run pending | Synthetic native invocation succeeded. |
| `force_terminate` | verified | Native run pending | Synthetic native invocation succeeded. |
| `list_sessions` | verified | Native run pending | Synthetic native invocation succeeded. |
| `list_processes` | verified | Native run pending | Synthetic native invocation succeeded. |
| `kill_process` | verified | Native run pending | Synthetic native invocation succeeded. |
| `get_usage_stats` | verified | Native run pending | Synthetic native invocation succeeded. |
| `get_recent_tool_calls` | verified | Native run pending | Synthetic native invocation succeeded. |
| `give_feedback_to_desktop_commander` | partial | Native run pending | Official definition and annotations preserved. Browser/form submission intentionally not exercised. |

## Formats and integration

XLSX creation/range editing/readback, DOCX creation/text editing/readback, and PDF Markdown creation/text readback passed. This does not establish XLSM macros, full Excel formula recalculation, complex Word layout fidelity, PDF OCR, or every advanced PDF operation.

The missing-font-name crash in the pinned PDF converter is fixed by a narrowly matched preparation patch. Configuration, tool history and fuzzy-edit logs use the private app directory. Upstream dependency pins and licenses are preserved.

New app-owned tools: get_harness_status, get_project_overview, git_status, git_diff, git_log, get_file_result. Build identity is captured once at development startup or read from the packaged receipt. Git output uses bounded snapshots, and file byte pages include SHA-256 with native image content where supported. The native CI matrix runs this same acceptance on macOS and Windows.
