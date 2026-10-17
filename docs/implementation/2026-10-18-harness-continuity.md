# ChatToHarness 项目理解、扩展与持续执行交付说明

## 交付位置与状态

- 实现分支：`codex/harness-continuity`。
- 实现工作区：`/Users/djhuang/AI/LocalHarness/.cache/worktrees/harness-upgrade-20261018`。
- 原分支：`codex/mcp-tool-access-stability`，原 HEAD 为 `6f9583d7ed73b6e63b3a129c72b547943d865496`。
- 源码版本仍为 `0.5.0`；新增构建标识用 commit、源码 SHA-256、构建时间区分实际构建，不冒充新 release。
- 最后一项应用代码提交：`f079554`。后续验收脚本和交付文档提交不改变应用源码。
- 原工作区的三个未提交文件按初始 SHA-256 保留。既有有效修改已在独立工作区完成并纳入对应提交。
- 当前运行实例没有被替换或重启。原生 UI 验收只启动独立临时数据目录中的测试实例。
- 没有推送、PR、release、正式签名、公证或安装到 Applications。没有启动额外模型或多 agent 编排。

基线与原始文件校验见 [baseline](2026-10-18-baseline.md)。日期目录沿用本次工作开始时的本地日期；机器可读证据使用 UTC 时间。

## 本地提交

| 提交 | 内容 |
|---|---|
| `50c5624` | 保存真实基线及三个未完成文件的处理记录 |
| `f2fd6c0` | 运行构建状态、项目概览、Git 只读读取、产物回传、官方引擎能力验收 |
| `1f19c17` | 持久任务、日志、幂等、取消及恢复查询 |
| `3de5802` | 路径/任务规则、按需 skills、MCP resources/prompts 与工具回退 |
| `abc1f8c` | 授权记忆、可恢复文本编辑、撤销及长任务验收脚本 |
| `66eb160` | PowerShell 命令输入与 UTF-8 日志输出处理 |
| `f079554` | 保存状态不可读时保留任务身份和执行不确定性；入口工作流指引 |
| `0bdfdfa` | 在独立原生应用中验证构建身份、授权记忆、撤销授权和全局选项保留 |

## 新的使用入口

| 工具 | 作用与关键参数 |
|---|---|
| `get_harness_status` | 已加载构建标识、设备、组件版本、连接状态、能力、分页工具目录；区分工具存在与功能已验收 |
| `get_project_overview` | `project_path`，可选 `target_paths`、`task`、`depth`；返回目录摘要、Git、AGENTS、规则和 skill 索引 |
| `git_status` / `git_diff` / `git_log` | 固定 Git argv，无任意 shell；项目路径限定、分页快照；diff 支持 `staged` |
| `get_file_result` | 文件 SHA-256、大小、文本或 base64 字节页；小图片返回原生 MCP image，完整小文件返回 embedded resource |
| `start_task` | `project_path`、`command`、`idempotency_key`；可选 `runtime_limit_ms`、`artifact_paths`、上下文参数；立即返回 `task_id` |
| `get_task_status` / `get_task_result` | 查询持久状态、退出码、时间及产物路径 |
| `get_task_logs` | 保存的 stdout/stderr 字节游标分页，可在重连后继续读取 |
| `list_tasks` / `cancel_task` | 找回项目任务；按本应用任务身份记录取消，不接受任意 PID |
| `apply_project_edit` | UTF-8 文本创建/替换，要求 `expected_sha256` 和 `idempotency_key`，返回 `undo_id` |
| `undo_project_edit` | 用 `undo_id` 和编辑后的 SHA-256 恢复原字节；后续修改造成冲突时拒绝覆盖 |
| `mcp_list_resources` / `mcp_read_resource` | 无资源浏览器客户端的列表、模板与资源读取回退 |
| `mcp_list_prompts` / `mcp_get_prompt` | 列出并读取 MCP prompt 模板和参数化消息 |

已有 `get_project_context` 扩展了 `skill_paths` 和 `task`；已有 `search_project` 继续提供有界文件匹配。官方 Desktop Commander 25 个工具全部保留。网关初始化指引优先推荐只读 Git、可撤销文本编辑和持久任务入口。

### 读项目、编辑与任务恢复

1. 用 `get_project_overview` 查看项目，必要时带具体 `target_paths` 和任务描述。
2. 从 `get_file_result` 取得将要编辑文件的 SHA-256。新建文件使用 `expected_sha256: "absent"`。
3. 用 `apply_project_edit` 修改，保存 `undo_id`。需要新项目规范时，结果明确返回规范和 delivery token；阅读后使用原幂等键重试。
4. 将测试、渲染、构建等长命令交给 `start_task`，保存 `task_id` 和 `idempotency_key`。
5. 调用超时、会话重连或应用管理器重建后，先按原 `task_id` 查询；重发启动请求时保持同一个键和相同命令、时限、产物列表。
6. 完成后用 `get_file_result` 取回产物。需要撤销文本改动时使用原 `undo_id`。

幂等键的范围是规范化后的项目路径。同键不同执行参数返回 `IDEMPOTENCY_CONFLICT`，不会启动第二次修改。既有任务的重复启动先查持久记录，不要求重新加载已经完成的任务规范。新操作使用新键。

## 规则与 skills

AGENTS 继续按项目根到目标目录的顺序继承；显式用户指令优先。新增规则发现范围为项目的 `rules/`，并保留 AGENTS 中的文件引用和显式 `rule_paths`。

支持以下有界 front matter 示例：

```yaml
---
name: Build checks
description: Instructions for source changes and builds
globs:
  - "src/**/*.cjs"
tasks:
  - build
alwaysApply: false
---
这里是规则正文。
```

`globs`/`paths`、`tasks`/`task_keywords` 或 `alwaysApply: true` 任一命中即加载规则正文。任务关键词按不区分大小写的子串匹配；路径从项目根计算。front matter 是有界发现格式，非完整 YAML 实现；复杂模式优先使用上述逐行列表。

- 自动发现 `skills/`、`.agents/skills/`、`.codex/skills/` 中的 `SKILL.md`，以及 AGENTS 引用的 skill 文件。
- 默认只返回名称、简介、路径、匹配情况等索引；显式传入 `skill_paths` 才加载正文。
- AGENTS、已匹配/选定规则和已选 skills 共享 64 KiB 正文预算。索引读取前 4 KiB 元数据；目录和文件发现有数量上限。
- 同一目录中的不同文件名会重新核对适用规则，不能用一个不匹配文件的上下文跳过另一个文件的规则。
- 已交付正文变化会刷新 token；无关的未加载 skill/规则变化不重复要求交付同样的正文。
- token 证明内容已交付，不授予文件访问权。文件范围仍由桌面设置决定。
- 用户明确关闭自动项目上下文时，新任务和安全编辑入口尊重该设置；显式项目概览仍可读取规范。

## MCP 扩展及预览

原有 stdio 和 Streamable HTTP 服务配置方式保留。新增服务通过配置和信任流程接入，不要求修改主程序。

- 同时代理 `resources/list`、`resources/templates/list`、`resources/read`、`prompts/list`、`prompts/get`。
- 没有 tools、仅提供 resources/prompts 的 MCP 服务也能连接。
- 工具名称继续采用稳定服务 ID 命名空间；prompt 为 `server::name`。
- 普通资源使用 `cth-resource://server/original-uri`。UI 资源使用 `ui://cth/server/...`，保留 MCP Apps 所需的 `ui://` scheme。
- 保留资源正文、blob、图片和相关元数据。HTML 作为资源数据返回；本机界面不会任意执行该 HTML。
- 不支持原生资源浏览器的客户端可使用四个固定回退工具。
- 单个工具定义或服务配置变化使对应授权失效；无关服务或其他工具变化不取消已有调用。

完整交互式 MCP Apps 的宿主渲染、扩展协商和 UI 双向事件仍取决于客户端；本次验证覆盖原生资源读取、HTML 资源预览数据和工具回退，不宣称所有客户端均能渲染交互式 widget。未实现 resources subscription 或 prompt completion 等未宣告的可选能力。

协议参考：

- [MCP resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP prompts](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts)
- [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)

## 本机授权复用

确认卡可选择“仅本次”“此项目内记住”“记住此工具”。项目选项仅在工具声明 `project_path`、项目位于已授权目录且可识别的目标路径都落在该项目内时出现。

项目授权按规范化项目路径、服务配置指纹和工具定义指纹保存，跨重启保留；界面可清除。显式 deny、配置变化和工具定义变化会撤销相应授权。已有全局允许选项继续保留，本次未自动打开。

参数预览和确认来源说明收进 details。界面区分 ChatGPT 平台、本机 Harness、操作系统以及服务端确认。此实现复用本机授权，不能保证消除 ChatGPT 或系统弹窗。

项目授权表示对已声明项目的调用记忆，不是任意终端命令的操作系统沙箱。原有 Desktop Commander 命令策略继续检查持久任务命令。

## 可靠性与已知范围

| 项目 | 当前范围 |
|---|---|
| 持久任务 | 独立 worker 和原子任务记录；应用管理器退出后继续运行，显式取消才请求终止 |
| 恢复 | 会话和管理器重连可查询原任务；worker 心跳消失时报告 interrupted/unknown，不自动重放命令 |
| 重启边界 | 机器重启、worker 被强制终止后可找回记录；不能自动恢复任意程序内部执行进度 |
| 日志 | 每任务最多 4 MiB；达到上限标记截断。每页最多 200 条、64 KiB |
| 任务容量 | 最多 4 个活动任务、1024 个持久任务记录；默认时限 24 小时，最大 7 天 |
| 编辑保护 | UTF-8、单链接普通文本文件、最多 1 MiB；SHA-256 前置检查、原字节备份、原子替换、幂等和撤销 |
| 编辑并发 | 检测到内容变化时拒绝覆盖；不声称能对任意外部编辑器提供操作系统级 compare-and-swap |
| 旧工具与 shell | 保留其完整能力。安全编辑的 undo 不覆盖旧格式工具或任意 shell 命令的所有副作用 |
| 记录归档 | 记录不自动删除。手动归档完成任务后，原幂等键应视为已封存，不重新提交 |
| Git | 固定参数和字面路径；禁用外部 diff、textconv、fsmonitor 和交互提示；历史最多 100 条，输出上限 512 KiB |
| 结果分页 | Git/目录等快照保留 5 分钟；文件最多 64 MiB，每字节页最多 64 KiB；原生图片预览最多 512 KiB |
| 移动端 | 短摘要、结构化结果和分页已做协议验收；真实 ChatGPT 手机端视觉与平台确认仍需新版本接入后检查 |

“结果写入失败”会区分尚未执行和执行状态不确定。已经修改文件但未能保存结果的编辑，可用同一键核对并恢复原结果；不会盲目再写一次。任务状态损坏时仍返回原 task_id 和 unknown 状态。

## 官方引擎与文档格式

完整逐项表见 [Desktop Commander compatibility](desktop-commander-compatibility.md)。固定官方 Desktop Commander 版本 `0.3.0`、依赖锁和许可证保留。

macOS 的 25 个官方工具中，23 项通过合成原生验收，2 项部分验收：

- `set_config_value` 的普通配置项通过；模型不能通过该接口扩张目录授权，目录继续由本机界面管理。
- `give_feedback_to_desktop_commander` 保留原工具定义和正确注解；未打开外部反馈表单或代用户发送反馈。

XLSX 创建/范围编辑/读取、DOCX 创建/文本编辑/读取、PDF Markdown 创建/文本读取均通过。修复了固定版本 PDF 转换依赖在缺少字体名称时的异常；补丁精确匹配上游代码，不替换官方引擎。历史记录和模糊编辑日志使用独立应用目录。

这不证明宏、完整 Excel 公式重算、复杂 Word 排版、PDF OCR 或全部高级 PDF 操作均受支持。

## 验收证据

| 检查 | macOS arm64 | Windows x64 |
|---|---|---|
| 基线单元/集成测试 | 213 项：211 通过，0 失败，2 个 Windows 原生测试跳过 | 原生待执行 |
| 最终单元/集成测试 | 241 项：239 通过，0 失败，同样 2 项跳过 | CI 已接入，原生待执行 |
| 官方引擎、项目规范、搜索、凭据隔离 | 通过 `mcp-smoke.cjs` | 原生待执行 |
| 25 工具兼容及 XLSX/DOCX/PDF | 23 验证、2 部分；三种格式通过 | 原生待执行 |
| 真 Tunnel / app-owned gateway | 通过隔离 loopback 控制面；未连接外部 OpenAI 服务 | 原生待执行 |
| 125 秒任务、重连、重建管理器、单次写入、产物与撤销 | 通过：启动 24 ms、实际运行 125066 ms，写入计数为 1 | CI 已接入，原生待执行 |
| 独立应用打包与仓库外 UI 启动 | 通过：独立依赖校验、仓库外启动；45 个工具，项目/工具授权记忆、撤销授权、三语界面与重启通过 | 原生待执行 |

机器可读报告：`capabilities-darwin-arm64.json`、`continuity-darwin-arm64.json` 和 `delivery-evidence.json`，与本文同目录。详细日志、截图和构建回执位于当前工作区 `.cache/acceptance/`；原始基线位于原工作区 `.cache/acceptance/harness-upgrade-20261018/`。

首次独立工作区打包发现共享 node_modules 的符号链接导致打包器遗漏 MCP 依赖。已改用独立依赖副本重新构建；交付前检查 app.asar 内 SDK 及依赖，并在仓库之外运行原生测试实例，避免仓库依赖掩盖缺失模块。

当前仅连接 Mac，无法据此报告 Windows 原生通过。`.github/workflows/ci.yml` 保留 macOS arm64 / Windows x64 原生矩阵，并加入官方能力验收和真实 125 秒恢复场景。未推送或触发远端 CI。

### 复现

在项目目录、已安装依赖和已准备本机组件的环境中：

```bash
node --test
node scripts/build.cjs
node scripts/mcp-smoke.cjs
node scripts/capability-smoke.cjs
node scripts/continuity-smoke.cjs
node scripts/tunnel-smoke.cjs
node scripts/ui-smoke.cjs
```

CI 固定 Node `24.22.0`。本次 Mac 使用 `resources/node/bin/node`；Windows 可使用 `resources/node/node.exe`。`build.cjs` 默认只生成独立应用目录并传递 `--publish never`；本次明确使用未发布测试构建，未创建安装器。

## 使用构建与回退

本次生成的应用位于工作区 `dist/mac-arm64/ChatToHarness.app`。它使用构建回执报告源码身份。需要实际切换时，由用户先退出现有实例，再按自己的运行/安装流程启动该构建，并刷新或重新连接客户端工具目录；随后用 `get_harness_status` 核对 commit `f079554` 和源码指纹。本次没有执行该切换。

原工作区和正在运行的程序保持原状态，不需要回退。开发分支中的阶段可按相反顺序用 `git revert` 回退，保留历史；不要对原工作区使用 reset/checkout 覆盖三个未提交文件。

若要回退全部功能代码，在没有额外未提交修改的独立分支中逐个执行：

```bash
git revert 0bdfdfa
git revert f079554
git revert 66eb160
git revert abc1f8c
git revert 3de5802
git revert 1f19c17
git revert f2fd6c0
```

回退到没有新任务接口的版本前，应先用当前版本查看并按需要取消自己的活动任务；不要删除持久任务/撤销目录来假装任务未执行。以上为回退方法，本次没有执行回退。

PowerShell 编码与退出码语义参考 [Microsoft character encoding](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding?view=powershell-5.1) 和 [PowerShell executable](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-7.4)。任务记录中的退出码是所选 shell 的退出码。
