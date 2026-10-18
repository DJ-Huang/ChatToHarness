# ChatToHarness 续作交付：结果回传与最终复验

日期：2026-10-18（Asia/Singapore）。机器证据中的时间使用 UTC。

## 交付位置与状态

实现分支为 `codex/harness-continuity`，独立工作区：

```text
/Users/djhuang/AI/LocalHarness/.cache/worktrees/harness-upgrade-20261018
```

接续已有提交 `9a6949f`，新增功能修复提交 **`d52193d`**。此前的项目概览、Git 只读接口、持久任务、路径/任务规则、按需 skills、MCP resources/prompts 和授权记忆均保留。没有重复执行原有阶段开发，没有切换原工作区分支。

原工作区仍为 `codex/mcp-tool-access-stability` / `6f9583d`。`app/mcp-proxy.cjs`、`app/project-context.cjs`、`electron-builder.config.cjs` 三个原有未提交文件均通过 SHA-256 原样保留校验。原运行实例 PID 41054 未被替换或重启。没有 push、PR、release、安装到 Applications，也没有启动额外模型。

## 本次实际修复

续作时的真实插件调用出现：文件读取/命令已经执行，但客户端只展示 `project_contexts`，不展示原文件正文、标准输出或进程句柄。只读执行历史与代理源码共同确认，代理为未结构化结果新增了仅含指引的 `structuredContent`，不能被当作操作未执行，更不能据此重放修改。

`app/mcp-proxy.cjs` 现在保留原生 `content` 及顶层错误/客户端元数据，同时在结构化结果中加入 `_harness_result.content` 和 `_harness_result.isError`。原有结构化业务字段继续保留；保留字段发生冲突时，可从 `_harness_result.upstream_structured_content` 找回原值。客户端专用的顶层 `_meta` 不提升给模型。该处理不推断失败操作是否已产生副作用，不增加自动重试。

原生文本、图片、音频、资源和资源链接仍以原内容块回传。纯结构化客户端也能取得它们的公开数据；真实手机是否渲染图片仍由客户端决定，不能将结构化中的图片字节等同于已完成手机视觉验收。完整镜像会增加响应载荷，大文件和长日志应继续走分页接口。

新增 `tests/mcp-result-delivery.test.cjs` 的 9 项回归；先在修复前复现失败，再验证修复。`scripts/mcp-smoke.cjs` 增加真实官方引擎经 stdio 代理的结构化优先断言，并读回有效 PNG、检查不存在文件的真实错误。

协议参考：[MCP 工具结果与输出结构](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-06-18/server/tools.mdx)。项目的该验收使用 2025-06-18 协议协商，不在本次擅自升级协议或官方引擎版本。

## 当前验证结果

| 检查 | 本次结果 |
|---|---|
| 续作前基线 | 241 项：239 通过、0 失败、2 个 Windows 原生测试跳过 |
| 修复后完整测试 | **250 项：248 通过、0 失败、2 个 Windows 原生测试跳过** |
| 代理与新增回传专项 | 26 项全部通过，其中 9 项为新增回归 |
| 真实官方 MCP | 文本读写、规则、搜索、PNG 和错误回传通过 |
| 官方 Desktop Commander 0.3.0 | 25 个工具保留；23 验证通过、2 部分验收 |
| 文档格式 | XLSX 创建/编辑/读取、DOCX 创建/编辑/读取、PDF 创建/读取通过 |
| 隔离 Tunnel | loopback 测试通过；不是线上 ChatGPT Tunnel 实测 |
| 长任务 | 启动返回 23 ms；实际运行 125063 ms；重连、管理器重建、仅执行一次、日志、产物和撤销通过 |
| 独立 Mac 应用 | 构建通过；打包代理与源码字节一致，SDK 随包存在 |
| 打包应用 UI | 仓库外工作目录、全新测试配置下通过；45 个本地工具、三语、项目/工具授权记忆、撤销、全局选项保留与重启恢复通过 |

两个部分验收项目仍为 `set_config_value`（普通配置验证，不允许模型借此扩大目录授权）和 `give_feedback_to_desktop_commander`（保留定义，没有代用户打开/提交反馈）。此统计不代表全部高级 Excel/Word/PDF 特性都已覆盖。

## 使用该构建

应用版本保留 `0.5.0`，构建提交为 `d52193d`，源代码 SHA-256：

```text
564094672c5ce7f9513ecbaee5a742d7f89fad830d28d29c24c2c6be0b4b588e
```

新的未发布应用位于：

```text
/Users/djhuang/AI/LocalHarness/.cache/worktrees/harness-upgrade-20261018/dist/mac-arm64/ChatToHarness.app
```

本次没有将当前连接切换到该应用。用户按自己的安装/启动流程切换后，需要刷新或重新连接客户端工具目录，再用 `get_harness_status` 核对上述构建提交与指纹。当前旧连接仍可能出现原先的正文隐藏现象，不能声称线上问题已经验收消失。

## 证据与复现

机器证据为同目录 `continuation-evidence.json`。逐项日志及 UI 截图位于工作区 `.cache/acceptance/continuation-20261018/`。此前 `delivery-evidence.json` 与首次交付说明保留作为历史记录，本文件对应更新后的构建。

在该工作区用已准备的 Node 运行：

```bash
resources/node/bin/node --test
resources/node/bin/node scripts/mcp-smoke.cjs
resources/node/bin/node scripts/capability-smoke.cjs
resources/node/bin/node scripts/continuity-smoke.cjs
resources/node/bin/node scripts/tunnel-smoke.cjs
```

UI 验收必须显式使用全新、专用于合成数据的 `LOCALHARNESS_HOME`；不要把它指向真实日常配置。本次明确隔离该目录，并从仓库外启动新打包应用。构建使用未发布/非正式签名测试模式，不创建安装器、不公证、不上传。

## 限制与回退

Windows 原生环境未连接，不能把 Mac 测试当作 Windows 通过；现有原生 CI 矩阵和测试保留，但本次没有推送触发远端 CI。真实手机端和线上 ChatGPT Tunnel 的新版本验收，仍需在明确切换运行版本后进行。MCP 交互式 UI 的实际展示也取决于客户端能力。

仅回退本次功能修复，在没有额外未提交改动的实现分支执行：

```bash
git revert d52193d
```

这是回退方法，本次未执行。全部阶段的回退顺序见更新后的 `2026-10-18-harness-continuity.md`。原工作区及当前程序无需回退；不要用 reset/checkout 覆盖那三个未提交文件，不要删除持久任务记录来伪装任务未执行。
