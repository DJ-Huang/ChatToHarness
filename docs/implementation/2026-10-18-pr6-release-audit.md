# PR #6 合并审查与 v0.6.0 发布前检查

> 审查日期：2026-10-18 · 状态：**发布分支准备，尚未创建 v0.6.0 Tag / Release**。
>
> 这是针对已合并源码的静态审查与自动化证据汇总，不是新的用户端到端实测，也不意味着下述遗留风险已修复。

## 范围与可追溯基线

- PR：[ChatToHarness #6](https://github.com/DJ-Huang/ChatToHarness/pull/6)，合并提交 `b518a00c8cbc5ca4caf60f7fca09a0c0a9e4f6be`。
- 比较基线：合并提交第一父节点 `07bc8b5` → `b518a00`，**67 个变更文件，+4,550 / −144 行**（按 `git diff --shortstat`）。
- 本次发布分支：`release/v0.6.0`，基于合并后的 `main`；仅将应用和 lockfile 根版本提升到 `0.6.0`，并准备三语发布说明与更新文档。
- 公开稳定版当前仍为 [v0.5.0](https://github.com/DJ-Huang/ChatToHarness/releases/tag/v0.5.0)，不能将本次分支源码、CI 产物与已正式发布的安装包混为一谈。

## 子系统、源码、测试对应表

| PR #6 子系统 | 主要实现 | 可核对的自动化证据 | 关键边界 |
| --- | --- | --- | --- |
| Harness 状态、工程概览、Git 与产物 | [harness-services](../../app/harness-services.cjs)、[project-inspect](../../app/project-inspect.cjs)、[build-identity](../../app/build-identity.cjs) | [harness-services.test](../../tests/harness-services.test.cjs)、[capability-smoke](../../scripts/capability-smoke.cjs) | 工具可用 ≠ 客户端调用成功；需授权工程目录；`get_file_result` 每页最多 64 KiB，文件预览上限 64 MiB |
| AGENTS、Rules、Skills 匹配与交付 | [project-context](../../app/project-context.cjs)、[mcp-proxy](../../app/mcp-proxy.cjs) | [guidance-matching.test](../../tests/guidance-matching.test.cjs)、[mcp-proxy.test](../../tests/mcp-proxy.test.cjs) | 规则路径／任务关键词／alwaysApply 支持有界匹配，Skill 默认先返回索引；`skill_paths` 显式选择正文，共享 64 KiB；上下文 Token 不授予文件权限 |
| 持久任务、幂等和取消 | [task-store](../../app/task-store.cjs)、[task-worker](../../app/task-worker.cjs)、[task-output](../../app/task-output.cjs) | [task-store.test](../../tests/task-store.test.cjs)、[continuity-smoke](../../scripts/continuity-smoke.cjs) | 最多 4 个活动任务／1,024 条身份；默认 24 小时、最长 7 天；成功提交不是命令成功；Worker 可跨 App Stop／Quit 继续，丢失心跳不自动重放 |
| 带哈希的安全文本编辑与撤销 | [safe-edits](../../app/safe-edits.cjs)、[harness-services](../../app/harness-services.cjs) | [safe-edits.test](../../tests/safe-edits.test.cjs) | UTF-8、`expected_sha256`、幂等键与 `undo_id`；有冲突则拒绝覆盖；不是与任意外部同时写入的事务级 CAS |
| MCP 授权、全工具放行及目录稳定性 | [mcp-manager](../../app/mcp-manager.cjs)、[mcp-settings](../../app/mcp-settings.cjs)、[project-grants](../../app/project-grants.cjs) | [mcp-manager.test](../../tests/mcp-manager.test.cjs)、[project-grants.test](../../tests/project-grants.test.cjs)、[mcp-ui.test](../../tests/mcp-ui.test.cjs) | allow-all 仅作用于**已启用、受信任**服务；本机授权不能消除客户端／OS 确认，也不是终端或第三方 MCP 进程的沙箱 |
| MCP Resources、Prompts、内容回退及结果保真 | [mcp-content](../../app/mcp-content.cjs)、[mcp-gateway](../../app/mcp-gateway.cjs)、[mcp-proxy](../../app/mcp-proxy.cjs) | [mcp-content.test](../../tests/mcp-content.test.cjs)、[mcp-result-delivery.test](../../tests/mcp-result-delivery.test.cjs)、[mcp-gateway.test](../../tests/mcp-gateway.test.cjs) | 原生 list/read/get 与四个只读工具回退；URI／名称分服务命名；没有完整 MCP Apps 宿主、资源订阅、completion、sampling、elicitation |
| 执行记录、日志总预算和滚动页面 | [execution-history](../../app/execution-history.cjs)、[diagnostic-budget](../../app/diagnostic-budget.cjs)、[live-logs](../../app/live-logs.cjs)、[renderer](../../app/renderer.js) | [execution-history.test](../../tests/execution-history.test.cjs)、[live-logs.test](../../tests/live-logs.test.cjs)、[mcp-ui.test](../../tests/mcp-ui.test.cjs)、[ui-smoke](../../scripts/ui-smoke.cjs) | 执行状态／本机写入／远端收到分别记录；远端确认未知；最多 7 天／10,000 条／共享 50 MiB，诊断 30 分钟，UI 最多 400 条，不是无损事件流 |
| Mac/Windows 打包、Desktop Commander、配置隔离 | [platform](../../app/platform.cjs)、[prepare-resources](../../scripts/prepare-resources.cjs)、[ci.yml](../../.github/workflows/ci.yml)、[desktop.yml](../../.github/workflows/desktop.yml) | [mcp-smoke](../../scripts/mcp-smoke.cjs)、[capability-smoke](../../scripts/capability-smoke.cjs)、[tunnel-smoke](../../scripts/tunnel-smoke.cjs)、[ui-smoke](../../scripts/ui-smoke.cjs) | 官方 Desktop Commander 的 25 个工具名保留；不要将它宣传为固定总目录数量。格式验收仅涵盖所列合成读写操作，不等于完整 Office、OCR、宏或图形交互 |

完整设计补充：[执行记录与清理](../execution-records.md)、[兼容工具清单](desktop-commander-compatibility.md)、[持久任务交付](2026-10-18-harness-continuity.md)。

## 自动化及交付证据

1. 合并后的 `main`（`b518a00`）已在 [Application checks](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39119237872) **macOS 15 arm64 和 Windows 2025 x64 双平台通过**；工作流涵盖 `npm test`、打包、Desktop Commander 引擎／格式、持久任务 125 秒与断连恢复、Tunnel 回环和打包 UI 的合成验收。
2. [Website 工作流](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39119237858) 在该合并提交上完成并通过。该结果不能证明尚未公开的 v0.6.0 安装包下载链接。
3. 独立发布分支使用项目固定 Node **24.22.0**；版本检查 `node scripts/release.cjs check` 通过，`npm test` **275 项：273 通过、2 跳过、0 失败**。此为源码候选版本的本机验证，不是 v0.6.0 原生安装包验收。
4. `docs/implementation/continuation-evidence.json` 保留的是更早的 Mac 开发快照验证，不应当作本次合并提交的完整结论。原有的真实 ChatGPT Tunnel 测试也不应推断 v0.6.0 新版本已通过个人账号端到端验收。
5. **尚待正式发版流程验证**：`v0.6.0` 标签工作流、Windows x64 EXE、Mac arm64 DMG、正式上传的 `SHA256SUMS.txt` 与双平台资产大小／哈希、安装后的版本、发布后的官网链接。

## 风险修复与仍需验收的边界

以下是对 PR #6 审查风险的修复与验证状态。修复提交属于本 PR #8 的发布分支，未创建版本标签；本机测试不能替代安装包与真实第三方服务验收。

| 重要程度 | 来源与问题 | 修复状态 / 剩余边界 |
| --- | --- | --- |
| P2 | [live-logs.cjs](../../app/live-logs.cjs) 读取后推进游标，再根据 UI 限额裁剪；高频日志每轮超过页上限时可能遗漏中间事件 | 已修复：增量读取达到页面 limit 时立即停止、保留游标，并在轮转跨文件时正确继续；新增 78 条跨文件无丢失测试。首次进入仍是有界尾部预览，UI 仍只保留最近 400 条 |
| P2 | [task-store.cjs](../../app/task-store.cjs) worker 启动失败路径可能缺 `finished_at`；[execution-history.cjs](../../app/execution-history.cjs) 依据终止时间刷新，可能把已经失败的任务历史标为 submitted/unknown | 已修复：同步和异步启动失败写入 finished_at / not_started；历史读取兼容既有缺失 finished_at 的终态；新增对应测试 |
| P2 | [mcp-content.cjs](../../app/mcp-content.cjs) 的 URI 重写并不覆盖任意第三方工具结果；转发的 `resource_link` 在客户端回读时可能无法按预期路由 | 已修复：透传工具的 resource_link 和 embedded resource 统一加命名空间；新增长链路读回测试；任意嵌套的第三方私有字段仍无法自动改写 |
| P2 | MCP 资源／提示词服务连接或停用时，内容目录刷新与工具目录刷新机制不同 | 已修复：可用内容服务的连接代次变化触发 resources/prompts list_changed 通知和本地分页缓存失效，并加入停用服务测试；客户端仍须实现通知处理 |
| P2 | 内置 Harness／内容工具的超时链路不一定与外部转发工具的默认 60／90 秒一致；多服务内容分页可能累积较长时间 | 已增加内容目录整体 90 秒 AbortSignal 预算，且保留逐服务请求 20 秒上限；真实慢服务验收仍需在正式安装包中进行 |
| P2 | [safe-edits.cjs](../../app/safe-edits.cjs) 哈希检查到最终替换之间存在极小的外部写入窗口 | 尚未彻底解决：保留 SHA-256 前置校验与提交前再验证；外部进程在最终校验与 rename/unlink 之间写入仍可能竞争。文件锁只能约束协作进程，不能提供任意外部进程的原子 CAS；建议后续单独设计并发策略 |

另外需要维护的限制：项目目录授权不是终端沙箱；Task 状态、防重放身份和编辑备份**不**计入 50 MiB 可清理日志预算，不能描述为“整个 App 数据目录最多 50 MiB”；脱敏是尽力而为。日志写入成功只能证明本机传输动作完成，没有客户端 ACK 时不能标记“ChatGPT 已收到”。删除任务身份或幂等保护会带来旧命令重放风险，不能直接按日志保留期删除整个任务目录。

## PR #8 风险修复补充（2026-10-18）

- 已修复：增量日志读取按页限制保留后续游标，轮换后分批补读；初次读取仍只展示有界最近记录。
- 已修复：Worker 启动失败同步及异步路径记录 `finished_at` 和 `failed`；历史记录对旧的终态缺少时间字段进行兼容。
- 已修复：转发 MCP 工具返回的 `resource_link` 与嵌入资源 URI 命名空间化，并测试回读。
- 已修复：内容目录可见性随服务连接和启停更新，触发 resources/prompts 变更通知和缓存清理。
- 已收敛：多服务内容目录遍历共享 90 秒总超时；单次请求仍最多 20 秒。
- 尚未完全解决：`safe-edits.cjs` 哈希校验和重命名之间的外部写入竞争，不能声明对任意外部进程提供事务级 CAS。
- 本机修复工作树测试：281 项、279 通过、2 跳过、0 失败。正式发版仍须 CI、Mac/Windows 安装及客户端验收。

## v0.6.0 发布流程与阻断条件

- [x] PR #6 合并 `main`，来源 SHA 和审查范围已确认。
- [x] 合并 `main` 的 Application checks 在两平台通过。
- [x] `release/v0.6.0` 准备一致的 manifest／lockfile 版本和三语 Release Notes。
- [x] 发布分支本机 `npm test`、`release.cjs check` 通过。
- [x] **审核以上 P2 风险，并修复可直接确认的日志、Worker、资源路由、内容刷新和内容总预算问题。**
- [ ] 决定是否接受 Safe Edits 非事务级 CAS 的残余风险；完成必要的真实第三方客户端回归。
- [ ] 合并发布准备 PR 到 `main`；此阶段不创建版本标签。
- [ ] 核对合并后的 main/CI，再从正确提交推送 `v0.6.0` 标签。
- [ ] 标签驱动的 Desktop installers 双平台构建、安装验收、草稿资产校验及正式发布。
- [ ] 确认公开的 EXE、DMG 和 SHA256SUMS.txt，核对官网中英日稳定版下载链接。

此文档是发布前审查清单，**不代表本次已发起标签、安装包构建或正式 GitHub Release**。
