# Development record — Windows computer use

## 2026-10-24 统一插件列表与插件管理

- 按用户确认的收敛方案移除“已安装 / MCP 服务”并列目录。Computer Use 和已有外部服务共用一个插件列表，以“内置 / MCP”标签区分。现有 MCP 配置及授权数据原样使用，没有存储格式迁移或自动启停。
- 外部插件“管理”在同一右侧抽屉提供“概览与权限 / 连接配置”；仅显示选中的服务，保留测试连接、显式信任、启停、删除复核、工具及项目授权。后台状态更新不替换未保存配置，关闭后清除未保存的密钥。错误在抽屉内可见，列表展示真实连接阶段。
- “添加插件”提供 MCP 接入和配置导入；“插件设置”独立管理明确影响全部 MCP 插件的允许所有工具开关与不含密钥的导出。权限模型及既有安全后端未改动。
- **聚焦检查**：首次同一组 14 项检查中 12 通过、2 失败，发现“已启用”状态翻译缺失、旧夹具错误地为只读权限检查传入参数；补齐翻译并修正夹具。用户明确同意补跑后，同一组 **14/14 通过**，包括选中插件的权限操作只作用于该插件、草稿保留、关闭清密钥、导航不授权、导入不启用、显式信任及三语目录。未扩大到完整测试或安装验收。随后只修正全局设置提示中的方位措辞。
- **真实开发界面**：重启当前开发实例，核对单一列表、添加插件的两个入口、MCP 接入表单、单独的全局权限及导出入口；未保存样例服务或操作权限开关。Computer Use 列表仍显示已启用，通道就绪。外部多插件选择和权限路由由上述隔离夹具验证，未宣称真实外部服务验收。
- 更新三语使用说明及既有 UI / 帮助截图脚本的导航入口。改动仍在当前分支，未提交、推送、打包或安装。


## 2026-10-24 插件页内右侧管理面板

- 根据用户后续澄清，移除侧栏独立 Computer Use 页面；点击插件“管理”在原插件页打开右侧管理抽屉。Computer Use 开关与系统权限、MCP 添加/编辑配置共用抽屉，关闭时保留原插件标签，清除未保存的敏感配置输入。支持关闭按钮、Esc、点击遮罩及原生 dialog 焦点约束；权限提示仍作为独立顶层确认弹窗。
- 已从开发版菜单重载，真实界面核对：左侧无独立 Computer Use 入口；“插件 → 已安装 → 管理”展开右侧面板，背景仍为插件页；关闭后仍选中“已安装”，焦点返回“管理”。开关保持用户先前确认的开启状态，屏幕录制与辅助功能均显示已授权。后续 UI 操作检测到用户正在改变窗口，未继续争抢操作。
- 更新三语使用说明及既有界面验收脚本入口。JavaScript 语法与 diff 空白检查通过；这是可逆界面布局调整，未新增或运行测试套件。本次未更改权限检查和开关后端，也未创建桌面控制输入会话。


## 2026-10-24 开发版 Computer Use 授权与插件入口

- 当前分支 `codex/release-v0.6.2`，基于合并提交 `379b2c4` 原地修改；不使用工作树、不改版本号、不提交或推送。
- 新增可执行 `dev.sh`，复用 `Start.sh --dev`。macOS 缓存开发包设置独立 `local.localharness.mac.dev` 标识及权限用途说明，保留 npm Electron 原件、用户数据目录和钥匙串身份。实际系统权限仍取决于应用及启动来源，不能将宿主进程中的结果外推到其他启动方式或安装包。
- 侧栏 MCP Servers 调整为“插件”，含“已安装 / MCP 服务”标签；内置 Computer Use 卡片链接至独立 Computer Use 设置页。原有 MCP 配置、导入导出、信任和逐项权限沿用原接口。新增只读权限检查接口，不会因检查成功自动启用控制；检查到已启用服务权限撤销时停止控制。授权提示改为原生 HTML dialog，保持聚焦、Esc 关闭及停止后不自动重放输入。
- 参考 OpenAI 官方文档 https://learn.chatgpt.com/docs/computer-use 的插件管理与独立 Computer Use 设置入口。当前客户端禁止自动读取自身窗口，因此未声称做了 ChatGPT 窗口逐像素对照。
- **验证**：`tests/dev-app.test.cjs`、`tests/computer-use-permissions.test.cjs`、`tests/computer-use-toggle.test.cjs` 共 17 项通过；JavaScript / shell 语法与 `git diff --check` 通过。既有 MCP UI 夹具、界面验收脚本和帮助截图脚本已适配新导航和 dialog；未扩大运行这些测试，也未运行完整测试或安装包验收。
- **真实开发界面**：通过 `dev.sh` 启动当前源码，核对插件两个标签、独立开关及权限状态；点击“检查权限”后仍保持关闭。当前实例显示屏幕录制、辅助功能均已授权。用户当次明确回复“打开”后才打开“允许控制电脑”；真实界面显示已启用，持久化 `computerUseEnabled=true`。重新连接后的实际 MCP 目录包含 `computer_use`，连接与工具健康为 ready，共 47 tools。
- **边界**：这是当前 macOS 开发实例的界面、授权检查和工具注册验收。没有创建 Computer Use 输入会话或执行鼠标/键盘任务，没有验证 Windows、其他启动来源或安装版；自动化检查不能替代这些验收。修改后保留开发实例运行及用户确认的开启状态。


## 2026-10-23 用户更新后的安装版整体验收

- 安装目录的 app.asar、独立适配器及 native helper 与交付包哈希一致；真实 connector 返回该构建指纹、ready、46 tools。结束时生产 connector 确认 `closed:true`。
- SDK 经仓库真实 Gateway/Manager 调用安装目录 stdio/native：原生 HUD 精确显示用户提供的聊天标题；会话复用名称更新、六段从窗口外开始的真实移动通过，独立采样最大倒退 0px，日志 839 条/421 次 move_step，无任务或聊天标题。不能据此认定间歇抖动已修复。
- 安装版真实拖动位移预期/实测均为 (+36,+32)；遮挡恢复与拒绝、瞬态重新规划、慢速接管让渡、HUD 避挡、STOP、通用任务 ID 完整往返与自动关闭通过。全局/逐窗口授权两组中文输入、失焦保护、最小化恢复、截图分块通过（8463654 字节、33 块，重组摘要与解码均核验）。各组 cleanupClosed 均为 true。
- 安装版 Electron Playwright 主界面验收通过，使用隔离配置与模拟隧道；语言、导航、凭据持久化、重启、MCP 管理、审批、日志与清理通过。它不是远程真实隧道端到端验收。
- 原生夹具首次因反射调用漏传 Inject 的 allowHeld 参数失败；保留原日志，仅修正测试传入 false 后重跑，PNG、Unicode、按键、点击、滚动、几何/焦点保护、生产授权、辉光、STOP/Esc 全部通过。未改变安装程序。
- **仍开放**：原鼠标跳回根因、本聊天客户端缓存缺少 conversation_title 参数、跨屏/macOS 原生体验；此前全量 9 项失败不被本轮覆盖。证据见 [安装版验收记录](evidence/computer-use-installed-2026-10-23.json)，原始日志位于 `.cache/acceptance/computer-use/installed-*-20261023.*`，界面报告位于 `.cache/acceptance/installed-ui-20261023/`。

## 2026-10-23 日志修复构建安装包及整体回归准备

- [x] 用户要求生成安装包后自行更新，再进行整体测试。使用独立目录 `dist/computer-use-logs-20261023/` 构建，不替换运行中的应用、不执行安装或卸载，不改版本号、不推送。
- [x] `node scripts/build.cjs --dist` 生成 `ChatToHarness-0.7.3-windows-x64-setup.exe`，大小 **213400736 字节**，SHA-256 **46255d972fe3cd14f6258a24969949425f74d8a55cececae7cde5117ecf56a3f**。应用源码指纹 `1df5c87fc987e4a51a08b5e9b307983b0450b34d3dc64b73e2503376c5d36bf6`，Git 检查点 `7db29d4e2d72333d97b6b1afb501116b46b5dadc`，包含当前未提交修复。
- [x] 打包资源逐项 SHA-256 核对通过；`app.asar` 包含真实聊天标题字段、原会话名称更新和日志路径状态；原生组件含日志实现。构建程序完成 NSIS 及 blockmap 生成；没有把打包成功等同于安装验收。
- [x] 全量测试中修正三项过时断言：Windows 打包夹具缺少必需 native helper、Mac HUD 仍引用旧尺寸/标签。另两项运行时测试的 HOME 预期未覆盖 Windows USERPROFILE 回退，改正后该组 **8 通过 / 0 失败 / 1 跳过**。这些修改仅影响测试，不改变安装包中的应用源码。
- **已保存结果**：首次并行全量测试 402 通过、12 失败、14 跳过；修正首批过时断言后的串行全量为 412 通过、10 失败、14 跳过，其中 8 项 EPERM 符号链接权限失败，2 项为随后已修正的 HOME 预期。最终复核结果以 `.cache/acceptance/computer-use/full-suite-final-20261023.log` 和输出目录 `verification.json` 为准；未将环境失败改成跳过或报告为通过。
- **最终全量**：436 项，**413 通过、9 失败、14 跳过**；8 项为 Windows 符号链接 EPERM 权限限制，另 1 项为任务取消夹具等待终态超时。任务取消项随后单独复测通过，仍保留全量中的失败记录，不据此称全量通过。安装包及测试摘要：[交付凭据](evidence/computer-use-installer-2026-10-23.json)。
- [ ] **待用户更新后的实机整体验收**：确认实际安装版构建指纹及工具 Schema 刷新，检查连接、窗口授权、真实聊天标题、鼠标从窗口外进入的轨迹和日志、文本/键盘、拖动、输入中断、STOP/Esc、任务 ID 完整链路与会话关闭；跨屏和 macOS 原生验收仍需各自硬件。鼠标回跳根因保持开放。

## 2026-10-23 无人操作、窗口外指针回跳：增加诊断日志（Issue #2）

- **用户澄清**：没有人在移动鼠标；异常是鼠标从目标窗口外朝目标移动一小段后返回原处。本轮不再把该反馈归因于用户接管。用户随后要求先添加日志，供下次复发调查；回跳根因保持开放。
- **范围**：Windows 原生本地有界 JSONL 日志；保留既有输入后端与恢复策略。本轮试验性的 SendInput/所有权采样方案没有纳入最终日志改动；全局钩子方案被自动审批拒绝且未应用。用户要求停止 REA 后不再使用该工具。
- [x] 原生日志记录动作/会话关联、构建 MVID、显示器、计划坐标、立即实测坐标、下一帧差异、重算次数、窗口外状态、DPI、辉光位置和鼠标释放结果。差异原因记为 `unknown`；不记录文本、按键内容、标题或截图。
- [x] 独立写线程、有界队列、同用户多 helper 写入互斥、每份 4 MiB 的当前/上一份轮转日志；磁盘不可用时不影响输入和 STOP。日志位于 `%APPDATA%\ChatToHarness\logs\computer-use-pointer\`；服务状态可返回路径。
- [x] **聚焦回归**：90 项，86 通过、0 失败、4 项 macOS 专属跳过。包括真实 C# 编译、并发写入、轮转大小、磁盘不可用、路径元数据和原有输入/任务生命周期。沙箱目录的首次轮转测试失败，同一测试在真实 Windows 文件系统通过；未将沙箱失败报告为通过。
- [x] **真实桌面日志验收**：六段移动均从目标窗口外开始，没有注入偏移；均完成、独立轨迹采样最大倒退 0 像素、`cleanupClosed=true`。本会话落盘 **982 条记录 / 464 条 move_step**，日志未包含测试任务/聊天名称。日志捕获 **8 次 pointer_mismatch / 8 次 move_replan**，立即写入与读取一致，但部分下一轮读数不同；不能从该现象推定人类输入或认定根因。原始日志保留在本机目录。
- [x] **部署**：用户明确选择“1（现在启用日志）”后，于北京时间 2026-10-23 16:01 仅替换安装目录原生 helper 和 `bundle.json` 对应校验值。组件 SHA-256 为 `97316318f4721eb568d69cc75accbc2bfdf14f4c3509600d5f8a97af31305055`；原生会话为空，四个应用 PID `[7724,14156,20816,31364]` 前后完全一致，主 `app.asar` 校验值未变，无应用重启。旧文件及凭据备份于 `.cache/hotfix-backups/pointer-logging-20261023-080137-993/`；下次会话自动记录。首次原子替换因 PowerShell 空路径参数失败且未改文件，改为明确备份路径后成功；安装后再次独立核对组件与清单一致。旧聊天标题构建的整体安装仍未执行。证据见 [日志及部署记录](evidence/computer-use-pointer-logging-2026-10-23.json)。

## 2026-10-23 当前聊天真实标题传递修正（Issue #2）

- **用户确认的真实聊天名称**：“继续修复 Computer Use 问题”。此前验收只传入测试任务标签，HUD 的“任务”显示通过不代表“聊天”标题通过；该覆盖缺口已明确纠正。产品代码不硬编码这一个标题。
- [x] `conversation_title` 接受宿主元数据或用户明确提供的确切标题，保持与 `session_title` 任务描述独立；未知时不猜测。
- [x] 修复 `open_session` 复用原会话时静默丢弃新标题的问题。仅在原生会话空闲时串行更新私有 HUD 元数据；输入/任务执行中返回 `CU_BUSY`；不重开窗口授权、不消耗截图观察、不重放 GUI 输入、不把名称写入一般状态结果。
- [x] 六个聚焦回归文件：**87 项，83 通过、0 失败、4 项 macOS 专属跳过**。新增真实标题补充、保留已有标题、原生输入互斥和错误目标拒绝测试。首次新增测试使用非数字窗口 ID 导致预期错误，改用有效窗口 ID 后通过。
- [x] 真实 Windows MCP SDK → Gateway → native：`--atomic-drag --title-only --conversation-title=继续修复 Computer Use 问题` 退出 0，原生标签逐字匹配 `聊天：继续修复 Computer Use 问题`，会话复用更新任务名通过，`cleanupClosed=true`。报告 `.cache/acceptance/computer-use/windows-conversation-title-result.json`。这是显式传入标题的真实验收，不宣称自动读取 Codex 侧栏名称。
- **当前安装版差异**：本轮开始时运行的是 `D:\\Program Files\\ChatToHarness` 中 0.7.3 / commit `a9ba8eac27eb404c71ff948b8e6592bdd26eb22a` 构建；当前连接工具 Schema 不含 `conversation_title`，仍有旧版 session_title 描述。源码修复本身不会更新该运行进程或外部客户端缓存。

## 2026-10-23 指针接管、释放结果和标题契约后续修复（Issue #2）

- **范围**：当前 `feat/computer-use` 分支；修改 Windows 原生代码、双平台工具描述和验收夹具。未改版本号、未替换安装版、未推送；不使用工作树。
- [x] **慢速用户接管**：旧逻辑把每 25 毫秒不超过 2 像素的持续移动累计为静止，可能恢复合成输入争抢鼠标。现在任何坐标变化都重置静止窗口，连续静止 320 毫秒才重算路径，持续运动在本地有界等待后返回可恢复冲突。动作路径基于 Windows 实际接受的指针坐标比较下一次采样，避免坐标量化导致错误重算。
- [x] **释放失败**：分步 `mouse_up` 检查 `ReleaseHeldMouse()` 返回值；释放失败返回 `CU_INPUT_FAILED`，不再错误报告成功。此失败分支尚未通过真实 SendInput 故障注入验收。
- [x] **双平台标题**：删除 Windows/macOS 对共享 `session_title` Schema 的过时覆盖；任务名称必填，真实聊天标题仅使用可选 `conversation_title`。修正 macOS 描述中要求省略任务名称的矛盾提示。
- [x] **回归**：七个聚焦测试文件共 **86 项：82 通过、0 失败、4 项 Mac 专属跳过**；包含真实编译 C# 的静止窗口逻辑测试（慢速持续运动、1 像素来回运动、短暂偏移后恢复）。Windows 原生 helper 编译通过。沙箱内任务检查点测试超时；同一测试集在沙箱外通过，不能将前者算作通过。
- [x] **真实 Windows 桌面**：MCP SDK → Gateway → native 隔离窗口；窗口内及窗口外 12 个样本的系统指针稳定、辉光对齐；真实拖动 `(36,32)`、遮挡恢复、短暂指针重规划、HUD 避挡、STOP、任务 ID 全链路和自动关闭已通过。逐窗口模式的慢速接管测试（每 25 毫秒移动 1 像素）确认返回 `CU_USER_INPUT_ACTIVE`，原会话继续有效并可重新观察。
- **诊断限制**：早期样本在未开启 Computer Use 的对照组也观察到指针返回原位，无法将用户原始跳回反馈全部归因于辉光。最后稳定样本来自单显示器；跨屏人工混合轨迹、安装版及 macOS 原生验收仍未完成，原始反馈不标记为全面解决。
- **验收脚本**：增加独立系统指针/辉光坐标采样、未开启服务的对照组、慢速接管测试和失败后显式关闭检查；修正逐窗口模式 STOP 后第二次开会话缺失的本地授权步骤。完整最新结果见 `.cache/acceptance/computer-use/windows-atomic-drag-result.json`。
- **最终逐窗口验收**：`node scripts/test-computer-use-mcp.cjs --atomic-drag --per-window` 退出 0；慢速接管、拖动、遮挡、STOP、第二次授权、任务全链路及自动关闭全部通过，`cleanupClosed=true`。包含源码 SHA-256 的摘要：[验收证据](evidence/computer-use-pointer-per-window-2026-10-23.json)。

## Generic GUI Agent ID and session-name contracts — 2026-10-23

- **Issue / branch:** ChatToHarness #1 / `feat/computer-use`; Windows repository `D:\\proj\\github\\ChatToHarness`. No macHarness, real pointer input, version bump, installation or push.
- [x] **Public task IDs:** Both general GUI and compatibility window-move tasks now use persistent Harness device UUID + 13-digit Unix epoch millisecond timestamp; same-millisecond collisions append a sequence number. No legacy `cu_agent_<hash>`/`cu_task_<hash>` API compatibility. Stable idempotency hashes remain private filesystem indices; duplicate start recovers the original task, conflicting payload is rejected. `task_id` input schema, status, cancel and decision calls all use the same validated format.
- [x] **AI session naming:** `open_session` requires a truthful human-readable `session_title`; use known real ChatGPT/Codex title or an accurate task description, never a guessed conversation title or UUID. Native HUD title is sent through already-authorized private stdio.
- [x] **Planner context wiring:** MCP Gateway forwards a per-connection Sampling Planner through Manager → HarnessServices → ComputerUseSwitch → BaseComputerUse to the specific started Agent task. Never stash a different client's Planner on a shared controller. Without Sampling, task safely awaits an external decision.
- [x] **Regressions:** 119 Computer Use mock regression tests: **115 PASS / 0 FAIL / 4 SKIP** (Mac-only on Windows); JS syntax and `git diff --check` PASS. Includes per-client Planner forwarding, device identity, readable task ID allocation and collision, same-key idempotency, required session name, stop/consent, macOS/Windows contracts. Real model Sampling after tool return and GUI task completion remain unverified.
- [ ] **Full npm test:** fails in this Windows environment. Observed `EPERM` on Windows test-created symlinks under `D:\\system_folder\\Temp` and `Bundled computer-use resources are missing` in Windows packaging-config test. Do not report full suite as passing or treat these failures as Computer Use regressions without independent reproduction.
- [ ] **Open:** real installed-client Sampling in ChatGPT/Codex, Windows/macOS native end-to-end dynamic interaction, cross-application authorization transitions, full npm test and new installation package. Do not treat mock suite or test build metadata as release acceptance.

## Computer Use device-time task IDs and readable titles — 2026-10-23

- **Issue/branch:** ChatToHarness #1, `feat/computer-use`; Windows checkout, no macHarness, no live desktop input, no installer/version update.
- [x] Generic and window-move TaskRunner IDs now use registered device ID + 13-digit millisecond time + optional collision sequence. A private idempotency index prevents duplicate work after lost replies. Legacy hash task IDs are intentionally unsupported.
- [x] New task IDs are accepted consistently by MCP input schema, runtime validation, task get/cancel/decision handlers and Windows/macOS packaging manifests.
- [x] AI must send a human-readable `session_title` with each `open_session`, describing the real current task; names are shown by native HUD via private stdio, not fabricated from unknown conversation metadata.
- [x] The app-owned MCP Gateway forwards a client-scoped optional Sampling Planner into the generic Computer Use task; no shared mutable global planner reference.
- [x] Mock-only regression: 112 cases across core, schema, Windows/macOS adapters, packaging, policy, app switch/HUD — 108 pass, 0 fail, 4 macOS-only skip on Windows. `git diff --check` PASS. No real GUI action attempted.
- [ ] Production follow-ups: rebuilt Windows installer, client MCP sampling after tool return, full native GUI acceptance, macOS hardware checks, full npm test environment.



## General Computer Use Agent: chunked model screenshots — 2026-10-23

- **Branch / issue:** `feat/computer-use` / ChatToHarness #1; Windows checkout `D:\\proj\\github\\ChatToHarness`. No macHarness used, no real-system pointer input, version bump or installer replacement.
- [x] **Full screenshot pipeline:** `app/computer-use-planner-images.cjs` reconstructs `observe` screenshots with `delivery=chunked` by bounded `read_screenshot` calls in the same authorized original session. Checks screenshot ID, offset, EOF, byte size, base64, each chunk SHA-256 and overall SHA-256; stops on abort or snapshot expiry. No raw screenshot is persisted to disk.
- [x] **Model input image:** large screenshots are downsampled only for the model using bounded in-memory JPEG previews. `planner_image` dimensions and image-to-native pixel scale accompany decisions; `x/y` are mapped to actual GUI screenshot coordinates before `BaseComputerUse` input validation. The native screenshot/observation is not resized or given new authority.
- [x] **Integration:** generic Agent now uses the screenshot preparation layer before calling Planner or awaiting decisions. Corrupt, unavailable or expired chunks cause safe re-observation, not an unverified GUI action. Windows/macOS staging manifests include the shared helper.
- [x] **Verification:** mock-only cross-platform eight-suite `node --test` **93 total, 89 PASS, 0 FAIL, 4 SKIP** (macOS-dependent skips on Windows), syntax checks and `git diff --check` PASS. Includes large synthetic 2400×1600 screenshot preview, corrupted/out-of-order chunks, abort before read, coordinate transform and end-to-end forced chunked observe → planner.
- [ ] **Open:** actual ChatGPT/Codex host `sampling/createMessage` after tool return, native Windows and macOS visual integration, cross-application authorization, production JPEG preview readability and overall full-suite environment failures. Mock success is not production acceptance.



## General Computer Use Agent reliability — 2026-10-22

- **Branch / issue:** `feat/computer-use`, continuing ChatToHarness #1, Windows checkout `D:\\proj\\github\\ChatToHarness`. No macHarness used, no production mouse movements, installer/version unchanged.
- [x] **Stale decision renewal:** `ComputerUseAgentRunner` automatically invalidates external `decision_id` before the native 30-second observation deadline (28-second limit), drops the previous screenshot from memory, re-observes and issues a fresh decision token. A late submitted action or `done:true` is rejected before native input, not retried against a stale screenshot.
- [x] **Abortable Planner and MCP Sampling:** replaced `Promise.race`'s leaked 15-second timer with a bounded decision helper that always clears timers and listens for STOP/cancel. Cancelling while sampling aborts the model request signal; late model output cannot execute GUI actions. The optional Sampling Planner forwards AbortSignal to SDK `createMessage`.
- [x] **Mock-only Windows+macOS-shared regression:** `node --test` for seven Computer Use suites: **85 tests / 81 PASS / 0 FAIL / 4 SKIP** (macOS-only on Windows). Syntax and `git diff --check` PASS. Agent+Sampling focused suite previously took ~15.7s with the dangling timer; after fix 14 cases completed in ~1.4s.
- [ ] **Still open:** verify the installed ChatGPT/Codex MCP client's async `sampling/createMessage` support, Windows desktop and Mac native acceptance, cross-application authorization handoff, large/chunked screenshot planning, full `npm test` environment failures and arbitrary GUI task completion evidence. Test-only results are not production acceptance.



## Generic Computer Use GUI Agent — 2026-10-22

- **Scope / branch:** General, platform-neutral GUI agent core on `feat/computer-use`, in Windows checkout `D:\\proj\\github\\ChatToHarness`. No macHarness invoked; no version number or installed app changed. Legacy window move remains a compatibility test, not the core architecture.
- [x] **Generic executor:** `app/computer-use-agent-runner.cjs` handles `observe → plan → act → observe` with one scoped native session, dynamic click/type/key/scroll/drag actions, checkpoints, fresh-observation completion decision, cancellation and backoff. Does not blindly replay unknown side effects or reopen terminated sessions.
- [x] **Public API:** `start_task`, `get_task`, `cancel_task`, `submit_task_decision`; task records persist only status/goal digest/action name and geometry, not screenshots or typed text. No configured Planner means explicit `awaiting_decision`, not false autonomous success.
- [x] **MCP Sampling bridge:** SDK `Server.createMessage` is available. Win/Mac stdio adapters install an optional planner only when the connected client advertises sampling; requests include only the original window's in-memory screenshot, no arbitrary external model endpoint. Client declines/errors yield safe waiting. Actual ChatGPT/Codex host support still unverified.
- [x] **Distribution:** Windows and macOS staging + manifests include the generic Agent Runner and sampling planner; `docs/computer-use-agent-architecture.md` and policy updated. Legacy move-specific tasks remain intact.
- [x] **Mock-only validation:** 82 test cases total, **78 PASS / 0 FAIL / 4 SKIP** (macOS-only skipped on Windows), plus JS syntax and `git diff --check` PASS. Tests include dynamic multi-step Planner, external decisions, stale decision rejection, input conflict recovery, STOP/cancel, native side-effect uncertainty, restart no-replay, sampling fallback and package manifests. No real desktop cursor controlled.
- [ ] **Remaining gates:** prove sampling works after an MCP call has returned in target clients; Windows installed-app/native GUI acceptance, macOS real-hardware build and GUI acceptance, cross-application authorization transitions, broader UI workflows and full npm test. No claim of fully validated autonomous deployment.



## Computer Use TaskRunner V1 — 2026-10-22

- **Issue/branch:** ChatToHarness #1 / `feat/computer-use`. Implemented exclusively through winHarness in `D:\\proj\\github\\ChatToHarness`; no macHarness, no real-system cursor test, no version bump or installed-app replacement.
- [x] **Narrow, locally executing GUI task engine:** `app/computer-use-task-runner.cjs` adds an authorized `move_window` workflow that keeps running between MCP requests. A fresh scoped observation plus explicit target desktop x/y and idempotency key are required. It never executes Shell or infers permission.
- [x] **MCP API:** `start_move_task`, `get_move_task`, `cancel_move_task` share the Windows/macOS `BaseComputerUse` contract. One active task per native session; direct concurrent input is rejected. Lost `start` replies are deduplicated, including after the task completes; changed goals with the same key are rejected.
- [x] **Safe loop and checkpoint:** progress is atomically persisted without screenshots or text; focus/input errors are observed and recovered with backoff, drag status is never treated as task success without fresh geometry verification, STOP/Esc/explicit cancellation/terminated native session aborts. A confirmed completed task closes its native session and overlay. On service restart existing incomplete work is marked interrupted for reads; it is never injected into a new session automatically.
- [x] **Cross-platform distribution:** both resource manifests and staging copies include the TaskRunner and `durable-files` helpers; `AGENTS.md`, `docs/computer-use-policy.md`, `docs/windows-computer-use.md` and `docs/computer-use-task-runner.md` describe the behavior and boundaries.
- [x] **Mock-only verification:** `node --test tests/computer-use-task-runner.test.cjs tests/computer-use-platform-packaging.test.cjs tests/windows-computer-use.test.cjs tests/macos-computer-use.test.cjs tests/computer-use-policy.test.cjs`: **71 total, 67 pass, 0 fail, 4 macOS-only skip** on Windows; `git diff --check` PASS. No actual desktop pointer was controlled by these tests.
- [ ] **Acceptance gates:** native installed Windows workflow, macOS packaged workflow/native Swift acceptance, full npm test environment failures, and general multi-step arbitrary GUI planning remain open. TaskRunner is a narrow session-scoped executor; it does not keep control after the MCP service/native session terminates, nor does it run a model unattended.



## Cross-platform Computer Use task continuation — 2026-10-22

- **Issue / branch:** ChatToHarness #1 / feat/computer-use; Windows checkout D:\\proj\\github\\ChatToHarness; worktree clean before editing; no macHarness used, no version bump or installed application replacement.
- [x] **Both OS task contract:** docs/computer-use-policy.md section 0 and AGENTS.md require recovery without a fixed attempt cap while the original session remains valid, until verified completion, explicit STOP/Esc/user cancellation or terminated session. User input activity means pause, not task cancellation; unknown effects cannot be blindly repeated.
- [x] **Shared MCP output:** app/base-computer-use.cjs returns task_state (recovering/session_terminated), recovery_action and replay_same_input=false for recoverable failures. Both win/mac tool descriptions require caller continuation. This is a response contract, not an autonomous task scheduler after the chat turn.
- [x] **Windows atomic pre-press:** native/ComputerUse.cs reports input_started=false until left-down may have been sent; true afterward. JS bridge forwards the flag so focus loss/input collision before down keeps original session, whereas possibly injected mouse-down still terminates session safely.
- [x] **Cross-platform mocked tests:** Windows helper compiled; initial four-suite run 62 tests / 58 pass / 0 fail / 4 Mac-only skip; git diff --check clean. Separate native GUI acceptance still required.
- [x] **Real Windows disposable GUI acceptance:** `node scripts/test-computer-use-mcp.cjs --atomic-drag` final rerun EXIT 0 through actual SDK/Gateway/MCP/native helper. Confirmed target drag (36,32) measured (36,32), single-grip occlusion recovery, all-grip occlusion safe fail and fresh observation, HUD top-edge avoidance, real top-edge drag, STOP button and closed session. The first run after edits stopped on `CU_USER_INPUT_ACTIVE` before any mouse-down; after the recovery loop was added a separate run failed because the fixture's `overlay_all` reported `covered:false`. An independent rerun passed all fixture assertions. Do not conceal the two failed runs or infer repeated stability from the passing run.
- [x] **macOS native parity in shared source:** native/MacComputerUse.swift now reports `input_started` around the atomic left-down boundary, analogous to Windows. Additional mocked Mac pre-press recovery and Swift source regressions bring the focused suites to **64 tests / 60 PASS / 0 FAIL / 4 SKIP** (Mac-only skips) on Windows. Windows C# helper build and `git diff --check` PASS. Swift compiler and physical macOS GUI are **not** verified; no macHarness invoked.
- [ ] **Full-suite blockers:** `npm test` EXIT 1 on Windows. Reported problems include `EPERM` creating a symlink in temporary settings tests, timeouts in persistent task-store tests, and bundled resources missing for Windows packaging configuration tests. These were not marked PASS or silently changed; the targeted Computer Use tests remain green.
- [ ] **Remaining:** address unrelated full-suite environment/test blockers, validate installed Windows build and manual Esc, verify Swift build/macOS native input on a macOS machine. No persistent unattended retry scheduler is implemented or claimed.



## Windows Computer Use 实机拖动/遮挡/HUD 收口 — 2026-10-22

- **Issue/branch:** ChatToHarness #1, `feat/computer-use`, follow-up to local commit `66ad106`. 用户明确要求删除误放的三个 3DFace 目录；逐个限定目录检查后删除 `.3dface-p0b-matrix-20261020` (1 entry), `.3dface-p0b-review-20261020` (4), `.3dface-render-transfer-20261020` (12)。`git status` 删除后干净，这些文件原本不受 Git 跟踪，没有混入提交。
- [x] **HUD 自遮挡修复:** Windows `StopWindow.FollowTargetDisplay` 在当前屏幕顶部居中时检查授权目标的可拖动标题栏矩形；如相交，将 HUD 移至该屏底部（STOP 可继续点击），避免 HUD 自身导致 `CU_TARGET_OCCLUDED`。未改 Mac、未引入不可见窗口定位作为实际移动方式。
- [x] **错误语义:** `drag_window` 的输入前确定性遮挡失败返回 `execution_state:not_started`、`operation_executed:false`、`next_action:observe`；可能已经注入鼠标输入的故障仍返回 unknown、终止会话，禁止自动重放。
- [x] **真实 Windows SDK→认证 Gateway→MCP→原生 helper→WinForms 临时窗口：** `node scripts/test-computer-use-mcp.cjs --atomic-drag` EXIT 0。实际拖动要求平移 (36,32) px，观察结果完全一致；第一个标题栏落点被独立非激活临时窗口遮挡时自动改用备用点，目标平移保持正确；遮住全部落点时 `CU_TARGET_OCCLUDED` 且未发送鼠标按下，会话维持 ready，清除遮挡后重新观察成功。
- [x] **真实 HUD/顶部避让：** fixture 枚举 Windows 原生 HUD 的实际窗口和子控件，验证会话原文标题、当前/上一步操作文本及 STOP。通过仅用于测试窗口的 `position_top` 放到屏幕顶部后，核验 HUD 与标题栏不重叠，再次真实拖动成功；这属于测试窗口的定位设置，不是生产 Computer Use 的 API 兜底。
- [x] **STOP:** 测试 fixture 先核验唯一的预期会话标题，再向其真实原生 STOP 按钮发送 Win32 `BM_CLICK` 测试消息；helper 退出、`get_session` 返回 closed、`close_session` 返回 `closed:true`。这是按钮消息验收，不是肉眼/物理鼠标 STOP 点击验收。
- [x] **代码回归:** `node scripts/build-computer-use.cjs` 编译通过；定向测试 49 total / 45 PASS / 0 FAIL / 4 Mac-only SKIP；`git diff --check` 通过。验收报告：`.cache/acceptance/computer-use/windows-atomic-drag-result.json`。
- [ ] **保留未验收项:** `node scripts/test-computer-use-native.cjs` 仍在本机因 `CU_USER_INPUT_ACTIVE` 终止（未取消真实用户接管检测）；Esc 真正热键、肉眼 Cyan 动画质量、异构多屏真实拖动及完整安装包尚未在本轮新改动上验收。此前完整 `npm test` 有 10 FAIL（符号链接权限/资源打包等），并非全量通过。
- **运行/交付约束:** 未修改版本号、未覆盖运行中的安装或 Windows MCP 服务；此证据仅适用于本地源码构建的原生 helper，正式部署后仍需单独验收。

## Windows 与 macOS Computer Use 源码对齐 — 2026-10-22

- **Issue/branch:** ChatToHarness #1 / `feat/computer-use`。通过 winHarness 操作 Windows 本地仓库，没有使用 macHarness；原有三个 3DFace 未跟踪目录保留。
- [x] Windows 原生 `drag_window`：新鲜 observation、最多三个输入前标题栏命中点、补偿终点、真实鼠标渐进移动/按下/拖动/释放；异常与用户接管时释放左键，不自动重放结果未知的动作。
- [x] 遮挡诊断：`WindowFromPoint` 返回窗口 ID/PID/进程名/边界与 hit-test 标识，禁止泄露其它窗口标题；安全失败保留会话，输入可能已执行的失败则终止会话。
- [x] Windows HUD：深色高对比度圆角面板、3.5s Cyan 周界动画、顶部居中、当前原生动作、上一动作结果与时间、可选真实会话名称；保留 STOP/Esc 和光标 Glow。
- [x] 双平台共享契约：两个平台均公开 `drag_window` 和 `session_title`；标题仅经 private stdio 传递、缺失不编造；明确任务结束应调用 `close_session`。没有添加系统 API 静默定位。
- [x] Windows C# 原生 helper 重新编译通过。最终定向回归 49 项：45 PASS / 0 FAIL / 4 SKIP（Mac-only）；`git diff --check` 通过。完整 `npm test` 为 390 项：366 PASS / 10 FAIL / 14 SKIP，存在 Windows 符号链接权限 EPERM 与缺少打包资源等非目标失败，不能宣称全量通过。
- [ ] Windows GUI fixture：`node scripts/test-computer-use-native.cjs` 出现 `CU_USER_INPUT_ACTIVE`，无法标记通过；未关闭保护或盲目重试。原子拖动、跨屏、HUD 真实视觉和 STOP/Esc 需要独立无干扰的 GUI 验收。
- **Next:** 完成最终全量静态回归与 GUI 验收。没有升级、安装或覆盖正在运行的应用；版本号不变。


## 已授权的系统窗口 API 兜底与原移动任务收口 — 2026-10-22

- **用户指示：** 真实 Computer Use 因遮挡、拖动状态、设备交互等问题不能完成窗口移动时，不应一次失败便放弃；可以考虑系统 API 兜底。只针对已授权目标窗口定位，不能以 API 绕过权限拒绝、用户接管、STOP/Esc 或错误设备。
- [x] 更新 docs/computer-use-policy.md 及 AGENTS.md：优先原生真实鼠标，诊断后有限重试；只有用户明确授权时改用目标范围限定的窗口定位 API，必须独立核验坐标，说明使用何种操作方式。其它 GUI 行为未获得额外授权。
- [x] **真实 Mac 系统 API 操作成功（不是鼠标拖动）：** 目标进程 PID=14254，窗口 ID=6458，ChatToHarness；操作前 System Events 查询大小为 1160×850。读到三显示器第二屏 Quartz 坐标 x=-1640, y=-1440, 2560×1440，按左边缘、上下居中计算目标 (-1640,-1145)；使用授权的 System Events Accessibility 窗口位置接口直接定位。
- [x] **独立位置校验：** 另行从 Core Graphics CGWindowListCopyWindowInfo 查询目标窗口 ID=6458/PID=14254，得到 Bounds X=-1640,Y=-1145,Width=1160,Height=850，完全符合目标；没有通过 shell 伪装可见鼠标拖动。移动前 Computer Use 的最后会话已处于 closed，无按住的鼠标残留。
- **注：** 系统 API 直接定位已证明该次任务可以在旧 0.7.2 运行环境下完成；将该兜底能力变成后续可独立授权的正式窗口 API MCP 工具仍是可选工程工作，不得把仓库中的文档规则描述成已经部署的工具能力。0.7.3 DMG 也未因此自动替换当前程序。


## 0.7.3 Mac installer / atomic drag fix acceptance — 2026-10-22

- **Source commit:** e5038b32d8964a8b27fe701bcea27c9325fcfd64, feat/computer-use, clean at build. Version 0.7.3.
- **Isolated build:** CTH_DIST_SUBDIR=0.7.3-occlusion-drag npm run dist EXIT 0；没有清理、覆盖当前运行中的旧 0.7.2 安装及其目录。
- **DMG:** dist/0.7.3-occlusion-drag/ChatToHarness-0.7.3-macos-arm64.dmg；SHA-256 7e2a79e72b6df729d23de80fce321e759a48d5bae93c50d95bdd2f0ccd36e76d。
- **Bundle:** build-info.json commit=e5038b3、dirty=false、version=0.7.3；codesign --verify --deep --strict EXIT 0（ad-hoc 签名，未 Apple notarize）。
- **Real isolated installer smoke:** CTH_SMOKE_OUTPUT=.cache/acceptance/installer-0.7.3-occlusion-drag npm run smoke:installer EXIT 0；hdiutil DMG CRC/挂载通过，独立已打包应用启动及 UI smoke 通过，卸载保留用户数据（installer=true / startup=true / uninstallRetainsData=true）。
- **Scope caveat:** 独立安装验收并不等于用户已升级。仍须在用户安装新版本并使 MCP 刷新后验证 ChatToHarness 本体跨屏拖动、遮挡元数据和完整 HUD 交互；不要自动升级或关闭 Issue #1。

## macOS CU_TARGET_OCCLUDED / 拖动状态恢复 — 2026-10-22

- **Issue/branch:** ChatToHarness #1, feat/computer-use；修复前工作区 clean；不覆盖当前运行版，不创建 worktree，不通过 setpos 伪装真实鼠标拖动。
- [x] **遮挡根因及诊断：** 原函数 isOccluded(at:) 对 CGWindow 仅做矩形测试，可能将透明/穿透重叠层误判为阻挡，且不报告挡住者。新 occluder(at:) 结合 AX 元素真实命中判断，只在命中当前目标进程且候选不是同应用其它窗口时放行；AX 未知 fail-closed，返回 ID/PID/owner/layer/alpha/bounds，隐去窗口标题。
- [x] **分步状态超时：** 旧 mouse_down — observe — mouse_drag 的 MCP 往返可能超过 30 秒原生保护，出现 CU_MOUSE_NOT_HELD / CU_DRAG_ABORTED。Mac-only drag_window 将真实 CGEvent 指针移动、按下、拖动、松开合并成一次调用，原生失败时也释放；按下之前最多探测三个候选落点，补偿目标坐标；按下后不重放。
- [x] **安全边界：** observe.window_bounds 公开 Quartz 窗口矩形供精准计算；原子拖动限定标题栏位置和物理存在的显示器目标，仍保留前台、进程身份、geometry、新鲜截图、用户未接管及 Esc/STOP；Windows 不广告、不接受该操作。
- [x] **自动测试：** npm test 388 total / 379 PASS / 0 FAIL / 9 SKIP；Mac 专项 25 total / 24 PASS / 0 FAIL / 1 SKIP；HUD 6 PASS。Swift 构建及 git diff --check 通过。
- [x] **真实 Mac GUI：** 临时 AppKit 测试窗口从 (200,791) 移至 (277,835)，目标位移 (78,45)、实际 (77,44)；随后跨屏移动至第二显示器 (-1624,-904)，精准匹配目标坐标；左键释放、close_session 和 Esc 全部验证。第一次跨屏测试轮次在前置点击遇到 CU_POINTER_OFF_PATH、未进入拖动，独立新 fixture 复测通过；不可将保护性失败隐去。
- [ ] **正式安装版待验收：** 当前运行中的 0.7.2 未被替换。新版本安装后的 MCP 工具刷新、ChatToHarness 主窗口操作和 HUD 实际视觉仍需验收；Command+A、STOP 按钮实际点击和 Glow 视觉效果保持开放。
- **下一步：** 隔离打包 0.7.3 Mac DMG 并验证签名与隔离安装，不主动覆盖运行版；同步 GitHub Issue #1。


## Isolated macOS HUD conversation and activity DMG — 2026-10-22

- **Build:** source commit `11132d85b36db8c28c57797e5e7c9d3df067eeb5` on `feat/computer-use`; `CTH_DIST_SUBDIR=0.7.2-hud-session npm run dist` PASS. Version stays 0.7.2; output isolated from prior and running installations.
- **Artifact:** `dist/0.7.2-hud-session/ChatToHarness-0.7.2-macos-arm64.dmg` (255 MiB). SHA-256 `2f4440d04d2ab54b53614d49d5158bf509c983ad395b9e2c45332b01d5fb7997`; embedded `build-info.json` records exact commit and `dirty=false`.
- **Code signing:** `codesign --verify --deep --strict` PASS, ad hoc signature; not notarized.
- **Isolated installer smoke:** `CTH_DIST_SUBDIR=0.7.2-hud-session CTH_SMOKE_OUTPUT=.cache/acceptance/installer-0.7.2-hud-session npm run smoke:installer` exit 0; DMG integrity/mount PASS; packaged GUI smoke PASS; data-preserving uninstall fixture PASS (`installer/startup/uninstallRetainsData=true`). No active ChatToHarness installation was overwritten.
- **Remaining acceptance:** A real GUI session using the new build has **not** yet visually confirmed the new current/previous rows or the optional client-supplied conversation name. The ChatGPT/Codex host currently does not automatically convey its chat display title to standalone MCP, so no live automatic-title acceptance is claimed.

## Mac Computer Use HUD conversation label and operation visibility — 2026-10-22

- **Request:** replace displayed native UUID with the ChatGPT/Codex visible chat name and make current/previous operations observable while preserving local STOP/Esc behavior.
- **Source boundary:** standalone MCP registration has no verified ChatGPT/Codex conversation-title field. ChatGPT/Codex chat sidebar titles cannot be read automatically from this local helper. A new optional Mac-only `open_session.session_title` accepts a client-supplied **known actual** title (1–80 safe characters); when absent HUD explicitly states title unavailable rather than fabricating a name. The native UUID remains internal and accessible only in a diagnostic tooltip. The optional title is delivered by an internal stdio handshake only after native ready, before the service is ready for input; no title in process args, environment, logs, or ordinary tool results. Public tool action set does not include the internal setter.
- **UI:** height 140 points; header/title, conversation label, **current native action** and **previous native result + local completion time** all have separate rows. The executing action appears immediately and persists until native completion; idle remains the accurate current state afterward while the prior action/result remains visible. Actual typed text, screenshot contents and key values are never displayed. Operations rejected before native invocation are not misrepresented as native actions.
- **Constraints:** Windows MCP input schema remains unchanged. ESC/STOP, permissions, one-use screenshots, session expiration, foreground and input safety remain unchanged. Optional title is not authenticated against the ChatGPT UI; trustworthy host propagation is necessary for automatic accurate naming.
- **Verification/remaining:** `npm run build:computer-use` native Swift PASS. `npm test` 385 total / 376 PASS / 0 FAIL / 9 SKIP (exit 0); scoped macOS/Windows HUD/API tests 43 PASS / 0 FAIL / 1 SKIP. New regression coverage verifies optional title handshake, bounded/non-control title validation, no title in normal tool output, separate operation rows, timestamp/outcome and shared core MCP schema. Package/installed visual verification reported separately. A real post-install HUD visual check is pending and must not be marked passed from source/static tests.

## Isolated macOS installer build for Computer Use corrections — 2026-10-22

- **Code commit:** `ff9577d` (version remains 0.7.2). Built with `CTH_DIST_SUBDIR=0.7.2-cu-fixes npm run dist` EXIT 0, preserving the active prior installation and its unpacked build directory.
- **DMG:** `dist/0.7.2-cu-fixes/ChatToHarness-0.7.2-macos-arm64.dmg` (about 255 MiB), SHA-256 `4ba888d9da42c4c16707951350bb9bf554337171d27710dd7792fb5354b88c27`.
- **Bundle:** CFBundleShortVersionString 0.7.2; embedded `build-info.json` has `commit=ff9577d21693759a57568ac5719ec83f2f8531ff`, `dirty=false`; `codesign --verify --deep --strict` PASS (ad hoc, **not notarized**).
- **Isolated installer smoke:** `CTH_DIST_SUBDIR=0.7.2-cu-fixes CTH_SMOKE_OUTPUT=.cache/acceptance/installer-0.7.2-cu-fixes npm run smoke:installer` EXIT 0. DMG verified/mounted, isolated app launch/GUI smoke passed, uninstall retains user data fixture. Report indicated `installer=true`, `startup=true`, `uninstallRetainsData=true`.
- **Limits:** The replacement DMG was built, not installed onto the user's currently running application. The real Computer Use HUD appearance and end-to-end automatic post-task close still require subsequent on-desktop observation; the smoke tested isolated app startup, not a new real mouse drag.

## macOS Computer Use parameter, cleanup and HUD corner fixes — 2026-10-22

- **Work item/branch:** ChatToHarness #1, `feat/computer-use`. User reported 11:25:49 `CU_INVALID_ARGUMENT` for drag button calls, STOP/HUD persisting after a completed task, and four pointed HUD corners. Initial worktree clean.
- **Cause #1 (confirmed):** public MCP schema advertised `button` for mouse actions, but the per-action validation whitelist excluded it from both `mouse_down` and `mouse_up`. Supplying `button: left` caused rejection before native input. Required screenshot `x,y` for down but not up was independently correct. Fixed action validation to accept optional explicit left and reject right for drag; normalize native command by removing the alias. Existing `click` right-button functionality is preserved.
- **Cause #2 (confirmed for incident):** final cross-display drag ended with `mouse_up`, but no `close_session` was invoked before user-facing completion. Helpers intentionally keep STOP/Esc active until explicitly closed, emergency-stopped or expired. Updated shared MCP guidance and `docs/computer-use-policy.md` to require close + verification **before** final completion wording. Added a 120-second no-tool-call shutdown watchdog to terminate orphaned native helper/HUD; it is a fallback, not a task-completion signal. Explicit close remains necessary to close immediately.
- **Cause #3 (source-based diagnosis):** rounded dark MacHUDSurface was nested inside an unmasked rectangular NSVisualEffectView backdrop and rectangular NSPanel window shadow. Removed both backing artifacts; direct MacHUDSurface root retains `cornerRadius`, `masksToBounds`, dark high-contrast backplate, STOP control and animated cyan orbit.
- **Verification:** `npm run build:computer-use` PASS, including native Swift helper. Targeted macOS/native/platform tests **54 total / 53 pass / 0 fail / 1 skip**. Shared policy tests **14/14 pass**. Full `npm test` **381 total / 372 pass / 0 fail / 9 skip**, exit 0. Added tests for explicit-left down/up, invalid right-button drag, independent idle cleanup, and corner layering invariant.
- **Limitations:** The new UI has not been viewed in an installed production 0.7.2 app or verified with a live ChatGPT-to-MCP GUI session. Existing installed/running app was not overwritten. Real cross-display drag was verified on the prior build, not repeated with the modified helper.


## ChatToHarness 0.7.2 Mac installer acceptance — 2026-10-22

- **Source/build:** `feat/computer-use`, committed source `5b4b34d` (clean), version `0.7.2`; `CTH_DIST_SUBDIR=0.7.2 npm run dist` PASS. DMG: `dist/0.7.2/ChatToHarness-0.7.2-macos-arm64.dmg`, approximately 255 MiB.
- **SHA-256:** `2e860e2a4f7f582afe67e4972cec465211c34ab20af4847402d64dbd7101b4eb`. `CFBundleShortVersionString=0.7.2`; packaged `build-info.json` commit `5b4b34dce4e9bc54ea515d805ad8c893da1a4def`, `dirty=false`. `codesign --verify --deep --strict` PASS; ad-hoc signature, **not Apple notarized**. Native helper includes `cyanPerimeterOrbit`.
- **Real isolated installer smoke:** `CTH_DIST_SUBDIR=0.7.2 CTH_SMOKE_OUTPUT=.cache/acceptance/installer-0.7.2 npm run smoke:installer` EXIT 0. DMG CRC verified and mounted; app copied to temporary install dir; GUI smoke PASS; uninstall-preservation fixture PASS: `installer=true`, `startup=true`, `uninstallRetainsData=true` in `.cache/acceptance/installer-0.7.2/installer-result.json`.
- **Tests:** prior to DMG build, `npm test` 375 total / 366 PASS / 0 FAIL / 9 SKIP; isolated-output unit tests 3/3 PASS. No Windows real GUI test.
- **Safety:** initial unisolated build failed `ENOTEMPTY` cleaning `dist/mac-arm64`, where the user's connected ChatToHarness app is **running**. Its directory was not moved or deleted. Subsequent build into `dist/0.7.2` succeeded. Old DMG remains unchanged. No application upgrade was performed or GitHub Release created.

## Release preparation 0.7.2 — 2026-10-22

- **Version bump:** `package.json` and `package-lock.json` to 0.7.2; notes `release-notes/v0.7.2.md`. Current branch `feat/computer-use`, work item ChatToHarness #1.
- **Scope:** Mac Computer Use HUD high-contrast text and orbiting cyan perimeter; device routing policy explicit > trusted current session > sole available > numbered selection, plus tools' visible real-input guidance.
- **Delivery:** build local macOS arm64 DMG from committed source (not GitHub Release), no changes to installed/running application. Validate signing, packaged native HUD and actual installer smoke. Keep Windows real GUI and ChatGPT-hosted router enforcement as pending.
- **Build isolation fix:** First `npm run dist` returned `ENOTEMPTY` while cleaning `dist/mac-arm64`, because the currently running ChatToHarness instance **is launched from that unpacked build directory**. Never remove, rename, or overwrite it while connected. Added `CTH_DIST_SUBDIR` output isolation for build + installer smoke: run `CTH_DIST_SUBDIR=0.7.2 npm run dist` then `CTH_DIST_SUBDIR=0.7.2 npm run smoke:installer`; outputs go to `dist/0.7.2/`. Old default remains unchanged for nonrunning builds. Path validation rejects traversal. Unit tests: `tests/output-directory.test.cjs` 3/3 PASS.




## Computer Use policy: session-first device routing and real input — 2026-10-22

- **Work item / branch:** ChatToHarness #1 / `feat/computer-use`. Canonical policy: `docs/computer-use-policy.md`; new root `AGENTS.md` directs development assistants to read it.
- **Multi-device selection:** explicit user device overrides all; if not explicit, choose the device **reliably associated with the current ChatGPT conversation** even when more than one Harness is connected; with no session binding choose the sole available device; if still ambiguous, list friendly connected devices as numbered choices `1、2、3…` (never request an internal device UUID). An unavailable explicitly named/bound device never silently falls back to a different one. The function `resolveComputerUseDevice` in `app/computer-use-devices.cjs` implements a pure, tested version of these rules for a trusted router; it cannot determine chat session binding from a standalone Harness.
- **GUI behavior:** visible native `computer_use` mouse/keyboard is the default for user requests to move/drag windows: `observe → mouse_move → mouse_down → observe → mouse_drag → mouse_up → verify`. Direct AppleScript/Accessibility or Win32 position APIs are not an implicit fallback. Explicit setpos/setsize permission remains separate; preserve Esc/STOP, window consent, screenshot freshness, no uncertain input replay.
- **Tool surfaces:** `registeredComputerUse` appends device-routing and visible-real-input rules to the platform-specific tool description, and publishes `_meta["com.chattoharness/computer-use-policy"]` (policy v1). `McpManager.visibleTools` attaches a guidance notice to command-capable `start_process`, `interact_with_process`, and `start_task` entries without altering their argument contracts.
- **Security boundary:** a local Harness does **not** see ChatGPT's entire list of connectors, cannot assert conversation association, and cannot force the ChatGPT UI to ask for device selection. This is guidance plus a pure routing contract, **not** implemented centralized session routing or technical restriction on arbitrary shell commands. Strong enforcement requires a trusted host/router capability boundary.
- **Validation:** `node --test tests/computer-use-policy.test.cjs tests/computer-use-devices.test.cjs tests/computer-use-toggle.test.cjs` 20/20 PASS; scoped MCP/Computer Use regression 96/96 PASS; full macOS `npm test` **375 total / 366 pass / 0 fail / 9 skip**. No Windows real-device acceptance and no reinstallation of the running app.



## Mac Computer Use HUD contrast and orbiting cyan border — 2026-10-22

- **Issue / branch:** ChatToHarness #1; `feat/computer-use`. User screenshot showed white title, session and activity text almost invisible on a pale green/tinted Computer Use panel.
- **Fix (P0 legibility):** New `native/MacHUDSurface.swift` applies a strongly opaque dark-navy layer (`alpha=0.97`) **above** NSVisualEffectView instead of relying on the effective system material behind the text. Title, session and activity use dedicated bright cyan, light-gray, and white high-contrast colors. STOP/Esc keeps its existing red-button presentation and callback.
- **Animation:** Base cyan rounded-rectangle border with a glowing cyan head and dimmer trailing segment. Two CAShapeLayers animate `lineDashPhase` in linear infinite loops, **3.5 seconds per full perimeter**; `layout()` recomputes the rounded path, dash lengths and animation for narrow monitors. No extra global timers/threads; no change to physical cursor, STOP, HUD placement, or window focus policy.
- **Build integration:** `scripts/build-computer-use.cjs` compiles the new Swift unit; dev rebuild watching and source inventory tests include it. `npm run build:computer-use` PASS (macOS native executable compiled). Dedicated AppKit acceptance checks live layers, infinite path animation, automatic border reflow and text contrast against a **worst-case white desktop**. Measured contrast: title 13.14:1, session 14.31:1, action 16.46:1 (all > WCAG AAA 7:1).
- **Tests:** `node --test tests/mac-hud-surface.test.cjs tests/mac-computer-use-indicator.test.cjs tests/macos-computer-use.test.cjs tests/mac-display-route.test.cjs tests/mac-permission-diagnostics.test.cjs tests/dev.test.cjs tests/computer-use-platform-packaging.test.cjs` => **39 PASS / 0 FAIL / 0 SKIP**. No running installed 0.7.1 app was replaced, and no Windows real-device test was performed. Visual acceptance of the animated border on the user's desktop is pending a fresh installation of a build containing this commit.
- **Packaged app verification:** `npm run build` EXIT 0; `dist/mac-arm64/ChatToHarness.app` has app version `0.7.1`, `build-info.json.commit=173b0fb`, `dirty=false`; ad-hoc `codesign --verify --deep --strict` PASS. Packaged native helper contains `cyanPerimeterOrbit`. This is an unpacked app build for inspection, **not a rebuilt DMG** and not installed over the running application.



## macOS 0.7.1 real cross-display Computer Use acceptance — 2026-10-22

- **Target/build:** running packaged ChatToHarness 0.7.1, build source `5bcca47`, device `unity.local` (macOS arm64). Mac Harness only; no Windows real-device testing.
- **User scenario:** move the ChatToHarness application window from the primary display onto the second (upper-left) display and leave the app frontmost. This time actual mouse input was exercised, not AppleScript window positioning.
- **Real control sequence:** native `list_windows` → `open_session` (target `ChatToHarness`, PID 69895) → `get_session` ready → `activate` → `observe` → `mouse_move` → `observe` → `mouse_down` → `observe` → `mouse_drag` (Quartz desktop destination `-500,-1220`) → `mouse_up` → `close_session`. All returned successful completion; mouse down/drag reported held=true and mouse up held=false.
- **OS verification after drag:** target window Quartz frame `X=-1100, Y=-1240, Width=1160, Height=850` fully within second display `X=-1640, Y=-1440, Width=2560, Height=1440`; `NSWorkspace.shared.frontmostApplication.processIdentifier == 69895`, `localizedName=ChatToHarness`. **Mac real pointer cross-display drag + foreground acceptance: PASS.**
- **Coverage limits:** This passes the above concrete scenario only, does not retroactively turn the macOS screenshot probe timeout in the 0.7.1 full suite into a PASS and does not establish Windows actual mouse/GUI acceptance. Explicit multi-device intent still depends on ChatGPT's tool selection behavior.
- **Git tracking:** current branch `feat/computer-use`; prior implementation and installer evidence already committed. This entry records the newly completed real-device acceptance, rather than creating an unnecessary code change.


## 0.7.1 macOS arm64 DMG acceptance evidence (2026-10-21)

- **Build source:** `5bcca47` on `feat/computer-use`; `npm run dist` EXIT 0, output `dist/ChatToHarness-0.7.1-macos-arm64.dmg`. Previous `0.7.0` DMG preserved; running installed application was not changed.
- **Bundle:** `CFBundleShortVersionString=0.7.1`, `CFBundleVersion=0.7.1`. `codesign --verify --deep --strict` EXIT 0; signature `adhoc` (no developer team, **not notarized**). File SHA-256 `505606a0a5920a861d0e668ba62e40d2fd1be48e6d3d2571e4716bcb4a1c18bb`.
- **Actual installer smoke:** `npm run smoke:installer` PASS; verified DMG checksum and mount, copied app to temporary isolated location, launched GUI/credential-isolation tests, and verified removal of app leaves fixture user data intact. Report `.cache/acceptance/installer/installer-result.json`: `installer=true`, `startup=true`, `uninstallRetainsData=true`.
- **Actual packaged MCP test:** Opened bundled `computer-use/app/macos-computer-use-stdio.cjs` with bundled Node using a temporary `LOCALHARNESS_HOME`; registered tool metadata includes `unity.local`, macOS, device UUID. `get_session` **without** `target_device_id` returned `state=none`; a wrong explicit ID returned `CU_TARGET_DEVICE_MISMATCH`. No native mouse session was opened.
- **Release limitations:** Full test suite `npm test` is **354 PASS / 1 FAIL / 9 SKIP**, with existing macOS real screenshot probe timeout. Real pointer drag and Windows real-device acceptance remain unverified. Client-side intent policy for multi-device ambiguous prompts cannot be enforced from an independent Harness server, only communicated through MCP tool discovery metadata/description. No GitHub release or remote push performed.

## Release 0.7.1 — automatic Computer Use device binding (2026-10-21)

- **Behavior:** device ID / name / OS advertised via MCP tool registration; ChatGPT chooses the connector based on available tools and user's requested target. `target_device_id` becomes optional and is not exposed to end users; selected connector binds the local ID automatically. An explicitly wrong ID is rejected before native input. Multiple connected computers with ambiguous intent require the chat client to ask for a friendly name; no false assertion of a host-level modal.
- **Entry points:** app-owned Computer Use and standalone Mac/Windows stdio registrations share `app/computer-use-devices.cjs`. The already authorized, platform-local window permissions remain unchanged.
- **Version:** `package.json` and `package-lock.json` = 0.7.1; release notes `release-notes/v0.7.1.md`. macOS-only build and tests; Windows real-device acceptance is explicitly pending.
- **Validation, macOS development checkout:** device/session routing and stdio discovery focused suite **25 PASS, 0 FAIL**. Full `npm test`: **354 PASS / 1 FAIL / 9 SKIP** of 364; failure: `tests/mac-native-observe-glow.test.cjs` helper `probe_window` timed out at 30 seconds (existing native ScreenCaptureKit issue; not represented as PASS). Real cross-display drag remains pending. Installer verification to be appended after build.


## Device-bound Computer Use tool registration — 2026-10-21

- **Request:** Replace conditional multi-device roster/dialog dependency with an unconditional requirement for an explicit target device. Every Harness reports its own stable `cu-UUID`, hostname and OS at MCP Computer Use registration.
- **Implementation:** `app/computer-use-devices.cjs` now owns identity, registration schema, target validation and standalone device home. App-owned tool and macOS/Windows standalone stdio tool both expose a device-specific title, `_meta["com.chattoharness/device"]`, and a JSON Schema **required** `target_device_id` with `const` set to the local ID. Wrong/missing IDs are rejected before native helper startup; native calls receive their original validated arguments.
- **Architecture:** No online roster or presumed device count. The chat client must ask which computer if the user did not choose one. A mere ID is not cryptographic proof that the user actually selected it, and an in-ChatGPT device picker is not implemented; see `docs/adr/0002-multi-device-computer-use-routing.md`.
- **Scope:** Only `macHarness` used. The Windows source contract is updated but **no Windows real-device validation** is claimed. The prior macOS `CU_USER_INPUT_ACTIVE` real-GUI acceptance issue remains open.
- **Validation:** `npm run build:computer-use` EXIT 0 (macOS native Swift binary). Mac-focused test set `node --test tests/computer-use-devices.test.cjs tests/computer-use-toggle.test.cjs tests/computer-use-permissions.test.cjs tests/computer-use-platform-packaging.test.cjs tests/macos-computer-use.test.cjs tests/mac-display-route.test.cjs tests/mac-permission-diagnostics.test.cjs tests/mac-computer-use-indicator.test.cjs` **41 PASS / 0 FAIL / 0 SKIP**; `node --test tests/mcp-gateway.test.cjs tests/mcp-manager.test.cjs tests/mcp-ui.test.cjs` **48 PASS / 0 FAIL / 0 SKIP**. The standalone macOS MCP SDK tool listing and missing-ID rejection were exercised; Mac real drag not reattempted.


## Multi-device Computer Use target guard — 2026-10-21

- Scope: only macHarness/macOS validation, no winHarness tool use. ADR `docs/adr/0002-multi-device-computer-use-routing.md`. Local host device ID persists; a supplied `target_device_id` mismatch rejects before native input. An injected, verified roster with 2+ live machines requires device selection and returns `CU_DEVICE_SELECTION_REQUIRED`; an untrusted or stale roster rejects.
- **Platform boundary:** Independent ChatGPT connectors have no shared online roster in this app. User-facing device choice dialog still requires ChatGPT router or an aggregate MCP broker, so do not mark global multi-device behavior accepted. The model-side prompt rule is documented, not treated as a technical enforcement. Device choice is bound to the active native session, so `mouse_up` still works without requerying a failed broker; a new session requires another choice.
- **Focused verification:** macOS build `npm run build:computer-use` PASS; `node --test tests/computer-use-devices.test.cjs tests/computer-use-toggle.test.cjs tests/macos-computer-use.test.cjs tests/mac-display-route.test.cjs tests/mac-permission-diagnostics.test.cjs tests/mac-computer-use-indicator.test.cjs` 27/27 PASS (0 skip). No Windows environment tools used.
- **Real desktop evidence: Native Mac Screen Recording and Accessibility were granted. An isolated native GUI click test failed `CU_USER_INPUT_ACTIVE` during pointer motion (no replay). Do not claim real drag PASS; Windows native tests expressly excluded by user.


## Cross-platform four-stage mouse control — 2026-10-21

- **Work item:** existing Computer Use issue #1; branch `feat/computer-use`. Added `mouse_move`, `mouse_down`, `mouse_drag`, `mouse_up` to the shared MCP schema and native Windows/macOS adapters. Ordinary move/down use fresh window screenshot pixels; drag uses fresh observation and global display coordinates (`screen_x`/`screen_y`, Windows virtual pixels, macOS Quartz points). `mouse_up` intentionally works without screenshot or geometry validation after a dragged window moves.
- **Safety:** explicit held-left-button state; disallow ordinary input during hold; no cross-display off-screen targets; preserve STOP/Esc, user-intervention detection, native target PID and foreground guards. Native release on stop, error, disconnect and 30-second inactivity. A failed drag terminates the session without replay. Existing uncommitted HUD edits preserved.
- **Status:** Mac native helper rebuilt; MCP simulation tests for both OS passed. Windows machine compiler/actual GUI validation not yet verified. Installed native binaries were not replaced.


## Mac Computer Use session indicator — 2026-10-21

- **Work item:** [ChatToHarness #1](https://github.com/watermoon/ChatToHarness/issues/1), branch `feat/computer-use`. The requested native Computer Use indicator is now a **530 × 108 pt, translucent NSVisualEffectView panel** with high-contrast cyan 3 pt border, a red **STOP · Esc** button, and a bright activity line. It is placed at the **top-center of the display containing the authorized window**, respecting the menu bar via `visibleFrame`, rather than the previous bottom-corner 320 × 52 pt button. It follows target-window screen moves without weakening input's screenshot-geometry checks.
- **Session identity:** `BaseComputerUse.open_session` creates the UUID first, passes that same identifier to the macOS native helper via a **new, optional fifth CLI argument**, and displays the actual full MCP Session ID on the HUD. Native CLI still accepts the original four-argument invocation for standalone backward compatibility. Windows native command arguments are unchanged.
- **Live action indicator:** native Swift updates status on `observe` (window screenshot), `activate` (focus window), `type_text`, `key_press`, `click` and `scroll`. For click/scroll the UI first reports **moving pointer**, then reports click or scroll after pointer motion finishes; restores **waiting for next action** when the request finishes. Chinese and English labels track local OS language. The indicator never exposes typed text, key names or screenshot bytes.
- **Narrow displays:** The STOP button is anchored to the HUD's trailing edge; titles and activity fields shrink/truncate while preserving the button's hit area when the authorized window moves to a narrower secondary display. Verified with native Swift compilation and focused layout-source regression.
- **Safety:** Existing Esc event tap and physical STOP callback still terminate the entire helper. Overlay is not a simulated cursor and has a real user-facing STOP button; window identity, foreground, fresh screenshot observation and explicit OS permissions remain mandatory. `activate` is not renamed to `move window` because no window-reposition API exists.
- **Verification:** native Swift compiled successfully with `swiftc`; dedicated `tests/mac-computer-use-indicator.test.cjs` and Mac native/controller tests passed. `npm run build:computer-use` PASS, macOS own-window real screenshot/glow test 2/2 PASS. `npm test` PASS: **356 total / 347 pass / 0 fail / 9 skip**. Native HUD visual placement and STOP click still require real desktop acceptance; cannot be claimed solely from compilation.


## Computer Use base + permission installer verified — 2026-10-21

- **Branch / source commit:** `feat/computer-use`, `ac9779388bf9d890be47ff7e6a6f75a563df8ed2`. Includes `BaseComputerUse`, OS-specific native adapter selection and packaging exclusions, read-only permission preflight and explicit user-initiated grant prompt, and permission loss notification that stops sessions.
- **Mac OS-specific verification:** `npm run test:computer-use-mac` exit 0. Native helper `permission_status` reported `screen_recording=false` and `accessibility=false` for the current Mac identity, so a full native input test was neither possible nor attempted; user consent must be explicit.
- **Mac application build:** `npm run build` PASS, package version `0.7.0`, build commit `ac9779388bf9d890be47ff7e6a6f75a563df8ed2`, `dirty=false`. Inspected `app.asar` for base, Mac controller, permission service, and switch; confirmed Windows controller/Windows stdio launcher absent. Native Resources contain Mac helper and Mac JS only, no Windows EXE. `codesign --verify --deep --strict` PASS with ad-hoc signature, not notarized.
- **Mac DMG:** `dist/ChatToHarness-0.7.0-macos-arm64.dmg` produced with macOS `hdiutil create -format UDZO`; `hdiutil verify` PASS; 397769063 bytes. SHA-256 generated by build task; no public checksum or Release published.
- **Installer acceptance:** `npm run smoke:installer` exit 0, on isolated user fixture; DMG mount, copy, launch, GUI workflow and retention of user data all PASS. Permission-denied UI checked without invoking `request_permissions` (no consent prompt triggered).
- **Source regression:** `npm test` 351 total / 341 PASS / 0 FAIL / 10 SKIP; `node scripts/release.cjs check` PASS.
- **Deployment:** Neither installed/running ChatToHarness nor its current ChatGPT connection was overwritten. No push/tag/GitHub Release. Windows platform-specific source assertions pass, but Windows installer/GUI requires validation on a Windows machine.
- **Outstanding Computer Use acceptance:** Mac Command+A reliability, user-visible STOP control, Glow and cross-display physical pointer checks; Windows native GUI acceptance. A real granted TCC run should confirm OS prompt identity and correct persistence.


## Computer Use cross-platform base and permission UX — 2026-10-21

- **Issue:** watermoon/ChatToHarness #1, **branch:** `feat/computer-use`. Both OS native controllers now inherit `BaseComputerUse` for session lifecycle, window/screenshot protocol, stale-observation protection, chunked images, cancellation and error handling. Mac no longer extends or imports `WindowsComputerUse`; native adapter selection is fixed to the host platform.
- **Build separation:** `scripts/packaging-platform.cjs` excludes opposite platform JS adapters and stdio entrypoints from `app.asar`, while `scripts/prepare-computer-use.cjs` stages only the current OS adapter + base + native executable and removes stale opposite OS files from resources. `electron-builder.config.cjs` applies the same filters to extraResources. `scripts/dev.cjs` fingerprint now includes both OS controller implementations and native Swift files; tests/dev.test.cjs fixture updated.
- **Permissions:** `app/computer-use-permissions.cjs` runs the native Mac helper in read-only `permission_status` before enabling the switch, checks Screen Recording + Accessibility and fails closed. Windows does not invoke TCC; per-window consent remains native. `request_permissions` is invoked **only after a direct click** on the app's permission dialog.
- **User flow:** MCP Servers checkbox stays off if Mac permissions are absent. A native app-owned Electron dialog appears with missing grants, explicit request, macOS Privacy & Security settings links, retry, and dismiss. Grant/recheck enables the tool and persists only if permission checks pass. Reboot with a saved enabled setting rechecks before registration. In-flight enable/disable operations are guarded against stale async completion.
- **Runtime revocation:** `BaseComputerUse` reports asynchronous session-start permission denials before the tool client has polled; synchronous tool-call permission errors and input-blocking session states are also reported. The switch stops native input, cancels sessions, removes `computer_use` from MCP tools/list, and signals the Electron UI; input is not auto-replayed. Windows consent denial has a Windows-specific prompt without Mac settings.
- **Verification:** `npm test` **351 total / 341 PASS / 0 FAIL / 10 SKIP**; `node scripts/release.cjs check` PASS. Real Electron development smoke passed with helper TCC grants absent (Screen Recording=false / Accessibility=false), showing local permission guidance without requesting native OS authorization. Windows behavior validated via simulated OS tests; live Windows GUI acceptance still pending.
- **Next:** Commit, build macOS arm64 app, verify `app.asar` and native resource platform isolation, and run isolated installer smoke. Do not push, tag, auto-install, or grant OS permissions on behalf of the user. macOS Command+A, STOP and Glow visual acceptance remain open.


## Computer Use MCP Servers toggle installer acceptance — 2026-10-21

- **Feature commit:** `0e73f1c`; **Electron UI follow-up commit:** `1a23c18`, local branch `feat/computer-use`. Windows/macOS each selects its own helper and stores the checkbox preference per device, not per Git project.
- **Real Electron dev UI:** `node scripts/ui-smoke.cjs --dev` PASS using an isolated configuration; the checkbox was checked and unchecked and persistence was verified without opening any real Computer Use session.
- **Clean macOS arm64 app build:** `npm run build` PASS from `1a23c185e6666d3e4349467314d79eadde11eee7`, `dirty=false`, app version `0.7.0`. Checked `app.asar` includes `app/builtin-computer-use.cjs`, Electron renderer and main integration files; Mac native helper exists in bundled resources and the app passes deep code signature validation. Uses ad-hoc signing, no Apple notarization.
- **Rebuilt local DMG:** `dist/ChatToHarness-0.7.0-macos-arm64.dmg`, **396774795 bytes**; `hdiutil verify` PASS. This replaces the older local DMG at the same path, not the existing /Applications application. No published GitHub Release, tag or push.
- **Installed-app smoke:** `npm run smoke:installer` PASS, temporary DMG mount/detach and isolated installed GUI launch. New checkbox checked/unchecked in the packaged application; preferences persisted; no extra external MCP Server; existing local MCP management and language settings passed. Final report `{"platform":"darwin-arm64","version":"0.7.0","credentialMode":"isolated fixtures","installer":true,"startup":true,"uninstallRetainsData":true}`.
- **Source checks:** `npm test` 336 total, 326 PASS / 0 FAIL / 10 SKIP. `npm run test:computer-use-mac` PASS. Windows platform selection and cancellation were tested in simulations, but not on a live Windows desktop.
- **Operational note:** The current installed `0.7.0` app still runs the older binary until manually replaced/restarted. The user must reopen the MCP Servers page after installing this updated local 0.7.0 package. A ChatGPT client may require tool list refresh to see the new built-in `computer_use`.
- **Remaining:** Real Computer Use cursor Glow and STOP button visual inspection and macOS Command+A defect; Windows actual on-screen Computer Use acceptance. Disabling the checkbox will not bypass any local TCC/foreground/user takeover guard.


## Computer Use MCP Servers opt-in toggle — 2026-10-21

- **Real Electron UI acceptance (latest):** `node scripts/ui-smoke.cjs --dev` PASS with an isolated test profile. It actually checked then unchecked the MCP Servers Computer Use checkbox, verified both persisted values in `preferences.json`, and confirmed no external MCP server was created. The event handler retains the clicked value during asynchronous state re-render, avoiding a momentary erroneous flip. No desktop input was injected during this test.

- **Issue / branch:** [#1](https://github.com/watermoon/ChatToHarness/issues/1), `feat/computer-use`. User requires a checkbox on **MCP Servers**, where checked automatically registers the current OS Computer Use tool; unchecked immediately terminates control and removes the tool.
- **UI / IPC:** `app/index.html` adds `mcp-computer-use`, `app/renderer.js` handles change with the checked value captured **before** UI refresh, `app/preload.cjs` exposes only `mcpSetComputerUse`, and `app/main.cjs` owns the permissioned IPC. No direct renderer filesystem/native helper control.
- **Device-local persistence:** `app/preferences.cjs` uses secure atomic `preferences.json` write, `computerUseEnabled=false` default. The new field does **not** modify third-party MCP trust, policy, credential encryption or any other computer's settings. Startup reads the saved preference and exposes it on `state().mcp.computerUse`.
- **Platform isolation:** `app/builtin-computer-use.cjs` exclusively imports `MacComputerUse` and uses `resources/computer-use/ChatToHarness.MacComputerUse` for `darwin`, or exclusively `WindowsComputerUse` and `ChatToHarness.ComputerUse.exe` for `win32`. Other platforms fail closed. The helper must exist before enabling. Native sessions are only created lazily on the first authorized tool call, not from opening the settings page.
- **First-party tool registration:** `app/harness-services.cjs` publishes a single `computer_use` tool only when opted in and the **matching local native helper exists**. `McpManager.changed()` immediately notifies clients via `notifications/tools/list_changed`; no manual `mcpServers` import, admin trust bypass for third-party servers, duplicated platforms, or tunnel restart is needed. Client may still need to refresh its tool catalog.
- **Disabling safety:** The Electron IPC checkbox uncheck synchronously calls `computerUse.setEnabled(false)` *before* waiting behind queued configuration actions; current native helper, outstanding inputs/screenshots and pending calls are aborted. Late replies fail closed with `CU_DISABLED` and no usable image data. `McpManager.stop()` stops control even when preference remains enabled, and connection can later restart with a fresh native controller.
- **Permissions:** Opting in does not bypass OS Screen Recording, Accessibility, local Esc/STOP, window identity/focus/geometry, or user-takeover safeguards. Enabling permits broad desktop-window access through the existing `all_windows` mode; the UI states this explicitly.
- **Automated verification:** `tests/computer-use-toggle.test.cjs` checks default-off, persisted on/off, macOS/Windows exclusive adapter selection, absent native helper, cancellation and stale response suppression, catalog notifications and denied disabled calls. `tests/mcp-ui.test.cjs` validates UI and restricted IPC, including the re-render race fix. macOS native `get_session` smoke check after enabling passed; full project `npm test` and `npm run test:computer-use-mac` passed.
- **Remaining:** No changes have been installed in the running 0.7.0 app. Build and install an updated local app before the actual settings checkbox can be seen and tested visually. Windows has source/model verification only; Windows real GUI acceptance remains pending. macOS Command+A, Glow, STOP visual acceptance also remain open.


## macOS 0.7.0 local installer completed — 2026-10-21

- **Version / branch / built Commit:** `0.7.0` on `feat/computer-use`; verified packaged build identity `15e0802613b1c951c8ba2954116adc059128c52e` with `dirty=false`. `package.json` and both lockfile versions match. Release notes `release-notes/v0.7.0.md`.
- **Tests:** `npm test`: 329 total, **320 PASS / 0 FAIL / 9 SKIP**, `node scripts/release.cjs check`: PASS. Never created a tag or GitHub Release.
- **App build:** `npm run build` completed successfully; `dist/mac-arm64/ChatToHarness.app` carries version `0.7.0`, native Mac Computer Use helper and supporting MCP resources. `codesign --verify --deep --strict` passed; signature is **ad-hoc**, not an Apple Developer ID, and **not notarized**.
- **DMG:** locally staged the signed application and /Applications shortcut, created `dist/ChatToHarness-0.7.0-macos-arm64.dmg` with `hdiutil create -format UDZO`; `hdiutil verify` passed. Size **387022786 bytes**. SHA-256 computed via `shasum -a 256` in the local build task; the checksum was not added to a published Release.
- **Isolated installer acceptance:** `npm run smoke:installer` completed **exit 0**. Mounted DMG, installed into a temporary directory, detached image, launched app through GUI smoke (zh-CN/en/ja, MCP management, update checks, settings persistence etc.). Report: `{"platform":"darwin-arm64","version":"0.7.0","credentialMode":"isolated fixtures","installer":true,"startup":true,"uninstallRetainsData":true}`.
- **Deployment:** Did **not** replace currently running ChatToHarness in /Applications; no Git push, tag, notarization, or public GitHub Release.
- **Open acceptance:** macOS Computer Use modifier shortcuts (Command+A), physical STOP button, cursor Glow appearance, and display-specific real input acceptance remain pending; do not claim they were verified by installer smoke.


## macOS 0.7.0 local installer — 2026-10-21

- **User request:** replace the previous local `0.7.0-beta` target with exact stable SemVer `0.7.0` for macOS arm64. Do not publish or create Git tag; work on `feat/computer-use`.
- **Version:** `npm version 0.7.0 --no-git-tag-version --ignore-scripts`, `package.json` and both lockfile version fields agree; `node scripts/release.cjs check` passed.
- **Build path:** Electron/electron-builder prepares the macOS `.app`; if DMG builder times out, use a macOS native `hdiutil create -format UDZO` staging the verified app plus Applications symlink. Always verify the DMG and installed app separately.
- **Existing Computer Use acceptance limitations:** macOS modifier shortcuts, GUI STOP, cursor Glow visual inspection and multi-display end-to-end still incomplete; preserve these warnings despite stable version number.
- **Tests:** `npm test` on macOS completed: 329 total, **320 PASS / 0 FAIL / 9 SKIP**; version check PASS.
- **Next:** commit clean versioned source, rebuild signed app, create 0.7.0 DMG, run installer smoke and capture SHA-256/size/version/build commit. No GitHub publishing.



## macOS 0.7.0-beta installer candidate — 2026-10-21

- **Issue:** #1 (Computer Use), **branch:** `feat/computer-use`. User requested a **local macOS arm64 DMG** with exact app version `0.7.0-beta`; this is not a public GitHub Release, and no version tag or push is authorized.
- **Version:** `package.json` / `package-lock.json` / lock root updated together via `npm version 0.7.0-beta --no-git-tag-version`.
- **Beta compatibility:** `app/updater.cjs` accepts an installed prerelease when comparing to a published **stable** version; it still rejects published prerelease assets. `scripts/release.cjs check` accepts local beta version, but publication still requires a stable `vX.Y.Z` tag. UI smoke's mocked stable release is now an older version for beta builds.
- **Cross-platform test precision:** Windows-only native packaging and stdio checks skip on macOS and continue running on Windows.
- **Source checks:** `npm test`: 328 total, **318 PASS / 0 FAIL / 10 SKIP**. `node scripts/release.cjs check`: `Version verified: 0.7.0-beta`. Signed distribution is not configured; default Mac build uses ad-hoc signing without notarization.
- **DMG:** Standard `npm run dist` produced a valid signed `.app`, but `dmgbuild` exceeded the local task time limit. A local macOS `hdiutil`-generated UDZO DMG, containing the signed app and an Applications shortcut, was created and verified successfully. A clean-commit rebuild and final installer smoke validation are required before this candidate is accepted.
- **Initial installer smoke:** DMG mounted, app was copied to an isolated directory and image detached. The UI smoke reached Help but timed out at Update Check because it mocked a prerelease tag; fixed in source. Repeat smoke after clean rebuild.
- **Remaining known Mac Computer Use limitations:** Command+A modifier shortcut, STOP button visual click, cursor Glow appearance and cross-display Retina visual acceptance still need independent acceptance. The beta package must not be advertised as a stable production release.


## Human-paced native pointer motion — 2026-10-21

- **Key implementation commit:** e0a0f6c (real pointer trajectory, physical multi-monitor routes, source and local acceptance tests).

- **Issue / branch:** [#1](https://github.com/watermoon/ChatToHarness/issues/1), feat/computer-use; no worktree. macOS is P0. The previously uncommitted Windows native pointer implementation is incorporated into this cross-platform motion fix (Windows GUI acceptance still deferred).
- **Issue:** previously both native helpers moved a real OS pointer in no more than 32 steps, sleeping about 12ms/frame, so full-screen travel could end in <400ms and pointer Glow was difficult to follow.
- **Both platforms now:** time-based motion using a monotonic clock and approximately 60 Hz physical OS pointer updates; quintic acceleration/deceleration; deterministic small lateral arc when safely inside a single display; duration max(240ms, 170ms + distance / 850 pixels-per-second), capped 3.6s. Examples: 100px ~0.29s, 500px ~0.76s, 1000px ~1.35s, 3000px ~3.6s. No synthetic cursor or click ring.
- **Multi-display correctness:** macOS MacCursorTrajectory routes through shared screen boundaries rather than passing through empty display-coordinate regions. Windows Screen.AllScreens bridge routing implements the same contract. Keep target/focus/geometry/user button and modifier checks; macOS OS-event latency is accounted for by comparing cursor position against recent actually emitted points instead of exact previous frame. Out-of-route movement fails closed with CU_POINTER_OFF_PATH.
- **Evidence:** macOS Swift native helper builds. Three-screen geometry test passes 4 layouts x 301 real-coordinate samples (1204 on-screen points). macOS default suite 13 pass / 0 fail / 2 skip (current app window not visible and negative permission scenario not applicable). Windows C# compiles with Mono's mcs and Windows source timing tests 2/2 pass. An opt-in Mac GUI acceptance run returned exit 0 with an enforced >240ms real motion duration and >=8 distinct sampled OS cursor locations; other interactive runs aborted CU_USER_INPUT_ACTIVE/CU_WINDOW_NOT_FOREGROUND because active-user and window safety guards triggered. These results do NOT establish repeatable visual acceptance.
- **Remaining:** real Mac Glow aesthetic/visual review, repeat Mac GUI trajectory under stable foreground conditions and multiple displays, Windows actual native pointer/glow visual acceptance, modifier shortcut and STOP button, signed-app packaging. Do not claim those gates passed.
- **Commands:** npm run test:computer-use-mac; npm run test:computer-use-mac:gui (explicit real GUI, user-local only); node --test tests/windows-cursor-motion.test.cjs; C# validation with mcs or Windows native build on Windows. User requested natural pointer trajectory; no mouse-position circle.


## macOS Computer Use real GUI acceptance — 2026-10-21

- **Key implementation/test commit:** 79c5f4c (native Mac GUI input, observation anti-replay, Esc listener real-device tests and opt-in script).

- **Priority / issue / branch:** macOS Computer Use P0; GitHub Issue #1; feat/computer-use. Windows acceptance explicitly deferred and its native/ComputerUse.cs change and Windows cursor test are not modified.
- **TCC verified on the current Mac:** Screen Recording GRANTED, Accessibility GRANTED. No Input Monitoring permission required. macOS native input session reported state=ready, input_enabled=true, stop_hotkey=Esc, with successful screenshot observation and clean session close.
- **Disposable AppKit fixture:** tests/mac-computer-use-gui-fixture.swift (only synthetic test controls and ephemeral state in system temp). Actual 480x368 native window, geometry [200,791,680,1159] in screenshot point space. Native CGEvent mouse click on fixture incremented click count to 1; Unicode text matched "MacCU-2026-OK"; BACKSPACE removed final character; scroll delta 3 generated one scroll event; consumed observation was refused with CU_STALE_OBSERVATION; close_session passed. No business window was mutated. GUI fixture and temp data were cleaned up.
- **Esc emergency stop:** tests/mac-computer-use-esc-fixture.swift emits a real system Esc event only if the fixture PID is foreground. The passive event tap shut down the control helper, while the fixture app remained open. This verifies synthetic Esc delivery and listener response, not a manual human keyboard press. The on-screen STOP button has not been individually clicked/accepted.
- **Test commands:** npm run test:computer-use-mac:gui (explicit, interactive, actual mouse/keyboard) PASS 2/2, 0 skipped, after running each GUI scenario in its own child process. Default npm run test:computer-use-mac PASS 12, FAIL 0, SKIP 2 (the existing ChatToHarness window was not visible during the run; the no-Accessibility test now correctly skips because Accessibility is granted).
- **Newly discovered defect:** cross-platform CTRL+A mapped to Command+A does not actually select all in a native NSTextField. Follow-on synthetic events sometimes trip CU_USER_INPUT_ACTIVE. Do NOT mark modified-shortcut support as accepted. The native key-event path has been adjusted to explicitly release modifier key state; the Command+A semantic failure still needs a dedicated fix and re-test.
- **Remaining real-device acceptance:** Command+A and other modifier shortcuts, on-screen STOP button, visual verification of pointer silhouette Glow, cross-display/Retina geometry and window movement, permission revocation, installed signed macOS build / DMG packaging.
- **Next:** address shortcut semantics without disabling any input-active safety checks; run targeted GUI fixture acceptance again; do not change or accept Windows for this Mac milestone.


## macOS Computer Use P0 permission correction — 2026-10-20

- User challenged why both Accessibility and Input Monitoring were required for Mac Computer Use. Apple Developer Technical Support confirms Accessibility grants both event posting and listening; separate Input Monitoring authorization is unnecessary when Accessibility is granted.
- Removed CGRequestListenEventAccess and CGPreflightListenEventAccess from native/MacComputerUse.swift diagnostics, removed the Input Monitoring grant request/status gate from scripts/mac-computer-use-permissions.cjs, and updated tests/mac-permission-diagnostics.test.cjs. The CGEvent passive Esc event tap remains mandatory for input to start; if it fails, control is denied. Mac read-only observation remains Screen Recording only.
- Only two OS grants are requested: Screen Recording for window observation, Accessibility for input and Esc interception. ChatGPT official Computer Use documentation describes the same permission model. The helper may still require OS approval for the actual signed process identity.
- Verification: npm run test:computer-use-mac PASS 14/14; permission status reports Screen Recording GRANTED and Accessibility MISSING on this Mac. Input Monitoring was not requested. Real input and Esc/STOP not yet accepted.
- Issue #1; branch feat/computer-use; Windows native acceptance remains deferred, native/ComputerUse.cs and tests/windows-cursor-motion.test.cjs not changed or included in Mac commit.


## macOS Computer Use P0 continued — 2026-10-20

- Issue #1; branch feat/computer-use. Windows native/visual acceptance remains deferred. Windows pointer changes in native/ComputerUse.cs and tests/windows-cursor-motion.test.cjs deliberately remain uncommitted and are not staged.
- Permission evidence: running native helper reports Screen Recording GRANTED, Accessibility MISSING, Input Monitoring MISSING. Added explicit permission status/request commands; OS grants are process-identity-specific and cannot be bypassed.
- Real ScreenCaptureKit: list_windows succeeded (27 entries); own ChatToHarness window screenshot 1160×850, 211,199 PNG bytes, negative-coordinate geometry [1759,-1328,2919,-478], without image files.
- Real MCP: observation-only session opens with Screen Recording alone and returns screenshot/chunks; type_text rejected CU_ACCESSIBILITY_REQUIRED. Status now exposes input_enabled=false, input_blocked_reason and null stop_hotkey in read-only mode.
- Swift implementation: native screenshot probe, per-frame identity/geometry validation without repeated ScreenCaptureKit round-trips; separate MacCursorGlow uses system cursor alpha/hotspot to paint a mouse-transparent light-blue outer silhouette, no synthetic cursor/click ring. Glow compiles but is not visually accepted.
- Automated evidence: npm run test:computer-use-mac PASS 14/14, 0 skipped, serial native GUI tests. Source build and staging succeed. Actual input, global Esc/STOP, glow appearance, multi-display and signed DMG acceptance remain pending.
- Next: user grants Accessibility and Input Monitoring to actual helper identity, restarts it, then validates real input and emergency stop on disposable app. No Windows acceptance at this milestone.


## macOS Computer Use P0 implementation — 2026-10-20

- **Priority:** user explicitly promoted macOS Computer Use to highest priority. Defer Windows native/installer/visual acceptance; preserve previous Windows source and pending tests without claiming acceptance.
- **Branch:** `feat/computer-use`, in-place; no worktree. **Issue:** [#1](https://github.com/watermoon/ChatToHarness/issues/1) (open).
- **Key implementation commit:** 31f03e9 (macOS Swift helper, MCP adapter, packaging and Mac 7/7 tests; local commit only).
- **Native implementation:** `native/MacComputerUse.swift` (macOS 14+, arm64): ScreenCaptureKit window listing/single-window capture; AppKit consent picker; guarded foreground/window identity/launchDate/geometry/occlusion checks; CGEvent pointer, click, scroll, Unicode typing and bounded keys (CTRL shortcuts map to Command). A local non-activating STOP panel and passive Esc event tap must both initialize before input; missing Screen Recording, Accessibility or Esc capabilities reject the session. Parent-process watchdog and 10-minute deadline close control.
- **MCP:** `app/macos-computer-use.cjs`, `app/macos-computer-use-stdio.cjs`; reuse existing one-use observation, image compression, SHA256, chunks, sessions and no-replay semantics via platform-qualified native connection. Windows tool name/policy remains separate.
- **Build/packaging:** `scripts/build-computer-use.cjs`, `scripts/prepare-computer-use.cjs`, `scripts/computer-use-config.cjs`, `electron-builder.config.cjs`, platform-dispatched `app/computer-use-stdio.cjs`; source `npm run computer-use:mac`, build `npm run build:computer-use`.
- **Mac verification:** `npm run test:computer-use-mac` exit **0**, **7/7** dedicated tests pass, including native binary launch and MCP stdio discovery. Swift optimized helper compilation exit 0. macOS native `list_windows` returned **`CU_SCREEN_RECORDING_REQUIRED`**, confirming fail-closed behavior on this host. Real window capture, input, Esc/STOP and Retina/multi-display are **not yet validated** because the required local TCC grants have not been established. Do not mark supported/released.
- **Acceptance still open:** real installed-app Screen Recording + Accessibility (+ Input Monitoring if event tap requires it), target consent, screenshot geometry/retina, visual overlay and native pointer silhouette glow, actual click/scroll/Unicode, Esc/STOP under focus/full-screen, permission revocation, signed DMG identity, screenshot persistence/no-replay, Mac packaging verification. Windows full acceptance postponed by user.
- **Next:** obtain interactive Mac TCC permission evidence for the executing app/helper; run disposable GUI fixture with global stop verified, then accept. Maintain `docs/computer-use-macos-plan.md` and Issue #1.


## Fix cursor-shaped Glow alignment — 2026-10-20

- User reported that Glow was not actually wrapped around the real mouse cursor. Root cause: the previous `MakeCursorGlow()` always drew a 76×76 radial disk centered on the pointer coordinate, ignoring cursor silhouette and hotspot.
- Replaced the disk with a silhouette-based outer halo: use `GetIconInfo` and `GetObjectW` for the active Windows cursor bitmap dimensions/hotspot; compare `DrawIconEx` results on white/black backgrounds to derive the actual visible cursor shape, including monochrome cursors; expand a soft light-blue gradient only *outside* the cursor's opaque pixels. Rendering uses premultiplied-alpha `WS_EX_LAYERED` and remains click-through. A cursor handle change invalidates the cached sprite; ordinary mouse movement only repositions the sprite. If cursor extraction is unsupported, hide the halo instead of drawing an incorrect circle.
- Reused the same silhouette/hotspot-based Glow for `observe` screenshots while continuing to show the real system cursor. No coordinate, authorization, stop-key, or capture-size contract changes.
- Before editing, committed the earlier five-file accepted change as `57c19d0` on `feat/computer-use`. Native code compiled. Source **and installed** fixture runs both exited 0 with `CURSOR_HOTSPOT=0,0`, `GLOW_OFFSET=-14,-14`, `GLOW_SIZE=60x60`, `REAL_MOUSE_GLOW_TRACKS_CURSOR=true`, `CLICK_THROUGH_GLOW=true` and `NATIVE_ACCEPTANCE_PASS`. The fixture asserts no old radial-corner fill and verifies actual overlay geometry against the Windows cursor hotspot. Contract tests: 20/20 pass; `git diff --check` pass.
- Deployed corrected native helper to `D:\\Program Files\\ChatToHarness\\resources\\computer-use\\ChatToHarness.ComputerUse.exe` after confirming no active helper session; updated installed bundle manifest. SHA-256 `2dda11074a10aa036b3dba961715ada874b58ca682bd6c1ce8a1198c5991176e`, manifest verified using the installed Node runtime. Previous helper and manifest backed up in `.cache/hotfix-backups/cursor-silhouette-glow-20261020/`. Did not restart the ChatToHarness application or its already connected MCP adapter (only native component changed). The full remote ChatGPT-to-MCP visual rendering path is not independently proven by fixture tests.

## Continuous real-pointer highlight, Esc-only stop — 2026-10-20

- Requested change: removed the previously introduced 1.4-second click-location ring entirely. Pointer input still uses the Windows system cursor through SetCursorPos; added a separate 76 x 76 click-through, non-activating WS_EX_LAYERED overlay with a soft light-blue radial alpha gradient, tracking the **real** GetCursorPos approximately every 40 ms while the controlled target is foreground. The gradient is continuously attached to the real cursor, not an alternate/fake cursor or a click indicator. It hides when the target is inactive, minimized, cursor leaves target, or the session ends.
- Screenshot observation continues to composite the **actual Windows cursor**, now with the same soft blue glow behind it. The target screenshot remains the same size and physical-pixel coordinate system.
- Removed Ctrl+Alt+F12 registration, UI instruction and MCP stop_hotkey return value; Esc is now the only keyboard shortcut and STOP button remains available. Remote key_press Esc removed from permitted keyboard commands to reserve it for local stop. Old historical acceptance records below remain as historical records, not current feature guidance.
- Actual source native fixture: exit 0. Verified mouse glow followed the physical mouse to two separate positions, did not intercept two consecutive native clicks, blue window outline followed moved target, real cursor overlay was rendered into captures, STOP and Esc terminated the helper. Contract tests 20/20 pass; app/windows-computer-use.cjs syntax and git diff --check pass.
- Installed hotfix completed: backed up both prior files and resources/bundle.json under .cache/hotfix-backups/real-pointer-esc-only-20261020, copied compiled helper plus revised app/windows-computer-use.cjs into D:\\Program Files\\ChatToHarness\\resources\\computer-use, and verified both SHA-256 values against the resource manifest (native 8f736187313193f30f4e5fe6b2edbe10b18db7024981113ce9122c06144686bb; adapter 84cd79abecf9f04cf261b9d53fd656fec1c1bdc72f0c3f0ac5be9f46a415c41e). The **installed** native fixture exited 0 with REAL_MOUSE_GLOW_TRACKS_CURSOR=true, CLICK_THROUGH_GLOW=true and NATIVE_ACCEPTANCE_PASS.\n- Restarted only the specifically identified installed Computer Use stdio node process; MCP manager automatically reconnected. Updating the tool definition revoked its previous tool permission, so restored exactly that existing computer_use tool to its prior direct-allow policy through the desktop application's MCP UI. Live plugin then reported ready with **46 tools** (tools_version 18). New `open_session` and `get_session` both reported **stop_hotkey=Esc**, and a test session against the ChatToHarness window closed cleanly. No full ChatToHarness restart or installer rebuild was performed; source remains uncommitted.

## Stronger light-blue boundary and pointer visibility — 2026-10-20

- User feedback: the translucent blue frame was too subtle, and the mouse was absent from Computer Use screenshots.
- Increased same-hue outline alpha from **12..102/255** to **25..178/255** without changing its light-blue color or blocking input.
- Native PrintWindow excludes the mouse cursor: observations now composite the actual visible Windows cursor using GetCursorInfo, GetIconInfo and DrawIconEx with proper cursor hotspot and GDI cleanup; original dimensions/coordinates unchanged.
- Successful click and scroll show a light-blue cursor-position ring for 1.4 seconds in the existing mouse-transparent, non-activating overlay. The ring hides on elapsed time, foreground change, physical cursor movement or session close.
- Local Windows fixture acceptance exit 0: screenshot cursor rendered 74 pixels; outline sampled RGB (192,225,248); blue mouse ring visibly captured; repeated click through overlay passed. Esc, STOP, Ctrl+Alt+F12 and window-follow checks also passed.
- Hot-deployed native helper to D:\\Program Files\\ChatToHarness\\resources\\computer-use\\ChatToHarness.ComputerUse.exe after verifying no active native session. Backup in .cache/hotfix-backups/computer-use-visible-pointer-20261020/ (binary and bundle.json). Installed helper SHA-256: 6cd6c3e91ddaa26528cc2acfef8633560d9627a4a891d15b1c5be3b2601a769e, bundled manifest synchronized and confirmed valid by installed Node. Re-ran the **installed** helper fixture: exit 0 with SCREENSHOT_NATIVE_CURSOR_PIXELS=74, OUTLINE_PIXEL_RGB=192,225,248, OUTLINE_FOLLOWS_WINDOW=true, MOUSE_FEEDBACK_VISIBLE=true, REPEATED_CLICK_WITH_OVERLAY=true and NATIVE_ACCEPTANCE_PASS. Computer-use interface tests 20/20 passed; git diff --check passed. No Git commit/push or full app installer build performed.
- Real ChatGPT-to-MCP screenshot presentation remains unverified by this fixture alone.

## Computer Use visibility / stop affordance — 2026-10-20

- User-requested local source change on `feat/computer-use`: add a non-activating, mouse-transparent, light-blue semi-transparent gradient outline around the controlled window, updated on the native UI timer; show a prominent control banner and STOP button. Closing the helper removes the outline.
- Register unmodified `Esc` as the session-wide stop hotkey. Retain `Ctrl+Alt+F12` as backup. If either reservation fails, do not start a controllable session. Esc is intentionally reserved for stopping and is not available for normal target-app keyboard use while control is active.
- Initial runtime acceptance (installed native helper) confirmed STOP, Ctrl+Alt+F12 and Esc, but exposed **RGB (228,43,255)** purple edge contamination from magenta `TransparencyKey`. Corrected the overlay to a true per-pixel-alpha `WS_EX_LAYERED` window with a premultiplied top-down DIB and `UpdateLayeredWindow`.
- Final source and **installed helper** acceptance: `resources/node/node.exe scripts/test-computer-use-native.cjs 'D:\\Program Files\\ChatToHarness\\resources\\computer-use\\ChatToHarness.ComputerUse.exe'` **exit 0**. Fixture confirmed light-blue displayed pixel **RGB (214,232,245)**, correct target-outline geometry, follow on actual window movement, and successful STOP, Ctrl+Alt+F12 and **Esc** session termination. Full native fixture output ended `NATIVE_ACCEPTANCE_PASS`. `resources/node/node.exe --test tests/windows-computer-use.test.cjs` earlier passed **20/20**. Windows source helper compiled successfully.
- Hot-deployed the corrected helper to `D:\\Program Files\\ChatToHarness\\resources\\computer-use\\ChatToHarness.ComputerUse.exe`, updated the installed `resources/bundle.json` SHA-256 (UTF-8 without BOM), and verified it is parsable by installed Node. Installed SHA-256: `7101fc9ce255b2e77bbd12819daf86f9c9dc25260f525604e9a4a5ead819af0f`. Pre-update backup: `.cache/hotfix-backups/visibility-esc-blue-fix-20261020/`. Full ChatGPT-to-MCP interactive presentation was not separately retested; native installed helper was tested directly. No Git commit or release was performed.



Date: 2026-10-19 (Asia/Shanghai). Checkout: ChatToHarness, package version 0.6.0. Node used: v24.19.0 on Windows x64 (repository recommends 24.22.0). No release, commit or remote changes were made.

## Implemented

- Optional independent stdio MCP server: `app/windows-computer-use-stdio.cjs`.
- Single `computer_use` endpoint: local window consent, observation PNG, click, Unicode literal input, bounded key presses, wheel input and session close.
- Native .NET Framework helper: `native/ComputerUse.cs`; fixed executable invocation with shell:false, environment allowlist, parent watchdog, ten-minute session lifetime, local STOP and Ctrl+Alt+F12.
- Strict per-action validation, one active native operation, one-use 30-second observation, geometry/foreground/occlusion checks, no replay after uncertain input, no image/text/title persistence by the standalone service.
- `npm run build:computer-use` compiles the helper and creates an importable `resources/computer-use/mcp-config.json` for this checkout. Generated resources are ignored by Git.
- Existing application MCP integration is reused without changing trust/policy defaults, directory grants or shell execution policy. This source preview is not bundled into released installers.

## Actual verification

1. `npm ci --ignore-scripts --no-audit --no-fund`: exit 0, 359 packages installed. Install lifecycle scripts were intentionally not run; this is not an Electron packaging/build acceptance.
2. `node --check` for `app/windows-computer-use.cjs`, `app/windows-computer-use-stdio.cjs`, `scripts/build-computer-use.cjs`, `scripts/test-computer-use-native.cjs`, `tests/windows-computer-use.test.cjs`: all exit 0.
3. `node --test tests/windows-computer-use.test.cjs tests/mcp-manager.test.cjs tests/mcp-gateway.test.cjs`: **44 tests, 44 pass, 0 fail, 0 skipped**, exit 0. Includes ten new computer-use tests; the remaining tests exercise existing gateway/manager behavior. The real standalone MCP stdio endpoint was initialized and listed/invoked for invalid-argument rejection without opening native UI.
4. `node scripts/test-computer-use-native.cjs`: helper and isolated fixture compiled, exit 0. Report: `NATIVE_ACCEPTANCE_PASS: PNG, Unicode literal input, Ctrl+A/Backspace, button click, wheel submission, geometry rejection, foreground rejection`. Only disposable fixture windows were targeted. Wheel submission was checked, not a particular application's resulting scroll offset.
5. Final `node --test tests/*.test.cjs`: **299 tests, 286 pass, 10 fail, 3 skipped**, exit 1. Eight failures report Windows `EPERM` for symbolic-link creation in existing history/log/settings/context tests. Two existing runtime tests failed: `real stdio MCP preflight strips runtime keys, retains HOME and shuts down its server` and `supervisor readiness, authorization failure and explicit stop use only local fixture processes`; their causes remain unresolved in this change. The full suite is not green. Earlier runs also showed variable whole-file runtime/transport failures, so counts vary with test completion; the totals above are the final run, not a combined count.
6. `git diff --check`: exit 0. Initial Git worktree was clean; changes are local and uncommitted.

## Local Windows packaging acceptance — 2026-10-20 (Asia/Shanghai)

This section supersedes the earlier source-only packaging and consent/STOP acceptance gaps, but not the remaining limitations below. Work began on October 19 and completed after local midnight.

- Added Windows-only resource staging for the helper, standalone service and production SDK dependencies; the developer's absolute source config is excluded from packaging. Staged code prefers its adjacent native helper. The bundled configuration generator resolves Node and service paths from the actual installation directory. Existing service trust/tool authorization remains unchanged.
- `node node_modules/electron/install.js`: exit 0, pinned Electron runtime prepared. `npm run dist`: exit 0. Node 24.22.0, Tunnel 0.0.16 and Desktop Commander 0.3.0 were prepared using existing pinned archive checksums. Post-package resource verification passed.
- Artifact: `dist/ChatToHarness-0.6.0-windows-x64-setup.exe`, **200251354 bytes**, SHA-256 **ac4322a65627d59ef330a697df1124cbf8eb2c4f1d8e3959e46a9ad071c6784d**, Authenticode status **NotSigned**. This is a local preview of uncommitted work, not a published release. Companion digest: `dist/SHA256SUMS-computer-use-preview.txt`.
- Fourteen changed/new JavaScript files checked with bundled Node `--check`: 14/14 pass. `git diff --check`: exit 0.
- `node --test tests/windows-computer-use.test.cjs tests/windows-computer-use-packaging.test.cjs tests/packaging.test.cjs tests/dev.test.cjs`: **32 total, 31 pass, 0 fail, 1 platform skip**, exit 0.
- `node scripts/smoke-computer-use.cjs`: final exit 0. Actual bundled Node v24.22.0 and service copied to an unrelated temporary directory with spaces/Chinese characters; MCP discovery and invalid-session rejection passed without source-checkout dependencies. Packaged native helper passed PNG, Unicode literal typing, Ctrl+A/Backspace, button click, wheel submission, geometry/focus rejection, real production consent picker, STOP button, and actual Ctrl+Alt+F12. An intermediate run could not activate the fixture; the test driver was adjusted to click only its own verified visible window when OS activation is denied. The production focus checks were not weakened. Report: `.cache/acceptance/computer-use/packaged-result.json`.
- `node scripts/ui-smoke.cjs`: exit 0 against `dist/win-unpacked/ChatToHarness.exe`. Passed three languages/persistence, navigation, synthetic encrypted config/replacement, reconnect, single instance, window hide, owned-process cleanup, logs, MCP management/default deny, tool/project approvals and auth recovery. 45 base tools observed; optional computer-use is independently enabled and tested above. Remote Tunnel uses a local fixture, not a live account. Report/screenshots: `.cache/acceptance/ui-report.json` and sibling PNGs.
- `npm run smoke:installer`: exit 1, deliberately refused before install/uninstall because this is not a dedicated CI profile. Exact reason: `Windows installer acceptance requires a dedicated CI profile.` No CI/profile protection was bypassed and no personal app data was replaced. Actual NSIS install/uninstall and preservation of real installation state remain unverified.
- Final `resources/node/node.exe --test tests/*.test.cjs`: **301 total, 287 pass, 11 fail, 3 skipped**, exit 1. Eight symbolic-link permission failures remain; two runtime preflight/supervisor failures remain; the owner-exit Windows Job Object test also failed. This record does not attribute the three process/runtime failures to the new feature or claim they are resolved. Full regression acceptance is still not green despite passing package-specific checks.
- No commit, tag, upload, deployment or public release was performed. Summary evidence: [package evidence](evidence/windows-computer-use-package-2026-10-20.json).

## Earlier source acceptance limits

Native input tests directly bound the implementation to the fixture's own window. Production consent picker usability, real hotkey/STOP activation, ten-minute expiry, owner death during consent, packaged delivery and real-client image rendering have not received end-to-end interactive acceptance. JavaScript tests cover consent refusal/timeout, cancellation, session close and no replay using a fake native connection. Arbitrary application compatibility, GPU/protected-window capture and privilege isolation remain unverified. This is not an OS sandbox.

Update: packaged delivery, production consent, STOP and the emergency hotkey now passed fixture acceptance as recorded above. Ten-minute expiry, owner death during consent, real remote-client rendering and arbitrary application compatibility remain outside that acceptance.

Setup and exact supported calls: [windows-computer-use.md](windows-computer-use.md). Decision: [ADR](adr/0001-windows-computer-use.md).

## Session recovery and authorization modes — 2026-10-20

- Reproduced the missing recovery path before editing: regression `recovers a lost open response` failed (expected `ready`, got no state). The original implementation waited for native consent before returning its routing ID and returned only `CU_SESSION_EXISTS` on retry; the cause of the remote client's original missing response itself was not proven. This was an API recovery defect regardless of transport cause.
- `open_session` now immediately returns `session_id` with `initializing`/`awaiting_consent`. `get_session` without an ID and repeat open recover the current session; close without an ID works during consent or active input. Wrong IDs/targets remain rejected. Consent/start timeouts and failures are retained as closed-session diagnostics. No click/text replay is introduced; old callbacks cannot invalidate a new session. Added an output schema exposing ID/state explicitly.
- Per the user's subsequent explicit request, configuration defaults to `all_windows`; `CTH_COMPUTER_USE_AUTHORIZATION_MODE=per_window` retains separate local consent for each window session. Global mode adds visible-window discovery and explicit `window_id` targeting. Client arguments cannot change the authorization mode. Foreground, geometry, observation freshness, input bounds and local emergency stop remain enforced.
- `resources/node/node.exe --test tests/windows-computer-use.test.cjs tests/windows-computer-use-packaging.test.cjs tests/mcp-manager.test.cjs tests/mcp-gateway.test.cjs`: **52/52 pass, 0 fail, 0 skipped**, exit 0. Computer-use-specific contract file now contains 16 tests.
- Nine affected JavaScript files passed bundled-Node `--check`; `git diff --check` passed. Sanitized evidence for both actual Harness modes is saved under `docs/evidence/computer-use-recovery-*-2026-10-20.json`.
- Actual end-to-end `scripts/test-computer-use-mcp.cjs` uses production `McpGateway`, authenticated stdio relay, `McpManager`, per-tool policy and the installed native service. The tool called is **windows-computer__computer_use**. A disposable fixture is selected; the tool itself performs screenshots/click/text, while fixture-only setup/consent is local test infrastructure. Both default global mode and `--per-window` passed real screenshot, Unicode literal text, lost-open recovery, repeated-open no replay and ID-less close/startup cleanup. Reports are `.cache/acceptance/computer-use/session-recovery-result.json` and `per-window-recovery-result.json`; final fixture image contains only synthetic text.
- Official computer-use was initially used only for application configuration/cleanup, then stopped when the user prohibited it. Subsequent full acceptance and app reconfiguration were performed through **local Harness computer_use**. The same namespaced tool successfully clicked the installed app's service enable/disable controls and adjusted its policy by keyboard. This is a local acceptance gateway using real Harness routing and installed service files, not a claim that the current chat acquired a freshly generated remote connector tool definition.
- Updated the already installed service adapter and native helper at the discovered installation, keeping originals under `.cache/hotfix-backups/session-recovery-20261020`. Resource hashes were updated for these local hotfixes. Restarted only that MCP service, with prior direct-call permission restored. Live plugin `get_harness_status` confirms **ready, 46 tools, tools_version 7**, including `windows-computer__computer_use`. The tool definition now describes recovery and configured modes. No terminal command was typed through GUI.
- A fixture output encoding issue was corrected to UTF-8. One intermediate input test detected extra characters during desktop input; the clean final runs passed. Shared-desktop user input can still race with global input; this remains a limitation rather than a sandbox guarantee.
- The earlier installer has not been rebuilt for this hotfix. Current installed service and repository source contain the fix; old release/build identity metadata still identifies the original application package. Prior full-suite failures and unrelated installer/remote-Tunnel acceptance gaps remain unresolved. No commit or public release was made.

## Explicit activation and structured PNG delivery — 2026-10-20

- Added `activate(session_id)`, which requires no old observation, restores minimized targets and verifies actual foreground after identity validation and bounded attempts. A temporary UI-thread input-queue attachment is always detached. No fake Alt keys/clicks or foreground-lock configuration changes are used. Failure reports `CU_ACTIVATION_FAILED`; lost-focus input errors recommend `activate`. Activation always invalidates old observations and never replays input. Windows can still deny activation or a hung target can time out.
- `observe` now exposes matching base64 PNG bytes in both native image content and `structuredContent.screenshot`, with explicit output schema, MIME/encoding, byte length and SHA-256. The text summary omits binary data. Reduced native/adapter PNG limit to 2 MiB and tested combined JSON below the existing 8 MiB gateway budget. No screenshot persistence or directory access changes were added to the service.
- `resources/node/node.exe scripts/build-computer-use.cjs`: exit 0; native helper compiled. `resources/node/node.exe --test tests/windows-computer-use.test.cjs tests/windows-computer-use-packaging.test.cjs tests/mcp-manager.test.cjs tests/mcp-gateway.test.cjs`: **54 tests, 54 pass, 0 fail, 0 skipped**, exit 0. Four affected JS files passed `--check`; `git diff --check` passed.
- Actual `scripts/test-computer-use-mcp.cjs` acceptance passed for source and installed service, each in default global and `--per-window` modes. Each uses the real production Harness manager, authenticated gateway, SDK relay and namespaced `windows-computer__computer_use`; no official computer-use provider was used. A disposable distractor steals focus; input is rejected with no distractor text. The tool reactivates the target, rejects the old observation, restores it after minimization, captures and types synthetic Chinese text. The fixture only establishes test conditions; focus recovery and typing are production tool calls.
- Decoded the structured-only fallback to `.cache/acceptance/computer-use/structured-screenshot-fallback.png`, verified its digest/length and byte equality with the MCP image block, and visually inspected it: the synthetic Chinese output and PASS are visible. Sanitized results: `docs/evidence/computer-use-focus-global-2026-10-20.json` and `computer-use-focus-per-window-2026-10-20.json`.
- Updated the previously installed adapter/helper and resource hashes; originals backed up under `.cache/hotfix-backups/focus-image-20261020`. Used only our Harness computer-use tool to disable/re-enable that MCP service and restore its previous direct-call permission after schema revocation. The same new `activate` action also succeeded against the installed app window. Controller and test sessions were closed. Live connector `get_harness_status`: **ready, 46 tools, tools_version 9**. Existing package build identity remains unchanged; no installer rebuild, commit or public release occurred.
- Remote connector rendering of the updated computer-use image remains **unverified**: this chat still lacks the regenerated callable computer-use definition. A separate live `get_file_result` attempt for the synthetic image returned `PATH_NOT_ALLOWED` because the actual source checkout is outside the app's configured authorized folders; no folder grants were widened. Native and structured PNG delivery through the real local Harness gateway passed, but this does not prove remote UI rendering. The original remote omission's exact layer has not been established. Earlier full-suite and installer acceptance limitations remain unchanged.
- The interactive acceptance controller initially kept its terminal input stream alive after reporting completed cleanup; its owned Node process was interrupted after the computer-use session had closed. Explicitly closing/pausing the controller input fixes that test-driver lifecycle. Retested installed service with a piped `quit` and `--control-app`: exit 0, focus/PNG/input checks and controller shutdown passed. Final syntax/diff checks passed.

## Lossless compression and large screenshot chunks — 2026-10-20

- Replaced the whole-image 2 MiB rejection with lossless adaptive encoding and bounded network chunks. sharp **0.35.5**, libvips **8.18.7**, bundled Node **24.22.0**. `format: auto` compares optimized PNG and lossless WebP against original PNG, retaining the smallest; explicit `png`/`webp` supports client compatibility. Original resolution and exact pixels are preserved, verified by decoding and comparing all pixels in contract tests. Automatic mode retains PNG if optional WebP encoding fails; PNG optimization can fall back to the valid original. There is no claim of a universally optimal format or silent lossy compression.
- Small compressed images (<=1 MiB) retain native image plus structured fallback. Larger images return a manifest. `read_screenshot` supports repeatable byte offsets, default 256 KiB/max 512 KiB, per-chunk and whole-image SHA-256, next offset and EOF. Clients decode each Base64 chunk separately before concatenation. Existing 8 MiB gateway result budget is unchanged. Only one snapshot stays in memory for 120 seconds, released by a timer or observation/activation/input/close. Chunk reads do not refresh input's separate 30-second authority. The local native IPC bound is 64 MiB, native PNG guard 40 MiB within the existing 8-megapixel geometry limit; no folder grants or persistence were added.
- Added the image module to optional-service resource staging and lockfile-pinned production dependencies, preserving sharp/native-library upstream licenses. `npm install --save-exact sharp@0.35.5 --ignore-scripts --no-audit --no-fund`: exit 0, 4 packages added. Production staging `prepareComputerUse` installed 107 packages with scripts/dev dependencies disabled, exit 0. Native helper compiled successfully. A temporary diagnostics command tried sharp's unexported package.json path and failed; corrected diagnostics use public `sharp.versions` and confirm the versions above.
- First expanded contract run exposed a manually copied malformed PNG test constant (13 pass/7 fail); replaced it with a generated valid 100x80 PNG. Final targeted regression: **56 tests, 56 pass, 0 fail, 0 skipped**, exit 0. Includes actual lossless pixel comparison, >2 MiB compressed image assembly/hash, uneven chunk boundaries, retries, invalid ranges/IDs, expiry, snapshot invalidation and unchanged input deadlines. Existing manager/gateway contracts also pass. Five affected JavaScript files passed `--check`; `git diff --check` passed.
- Real Harness SDK relay -> authenticated production gateway -> manager -> installed native service acceptance passed in both `all_windows` and `per_window`. It uses `windows-computer__computer_use`, without the official computer-use provider. Synthetic Chinese fixture: native PNG **7196 bytes**, optimized PNG **5765**, lossless WebP **2108** (selected). Large synthetic fixture: native PNG **9304486 bytes**, compressed WebP **8148258 bytes**, **32 chunks**, largest response **350988 bytes**, exact reconstructed length/hash and decodable 2000x1500 image. Small forced chunk mode and stale screenshot rejection also pass. The earlier smaller fixture (3.7 MB source/3.3 MB compressed) passed before increasing stress dimensions.
- Relocated production resources and bundled Node to an unrelated temporary directory: `scripts/smoke-computer-use.cjs` exit 0, portable/MCP/native all true. Production consent, STOP, Ctrl+Alt+F12, Unicode, clicks, wheel and existing focus/geometry rejections passed. This is resource staging/relocation acceptance, not a new installer build or NSIS install/uninstall acceptance.
- Updated the current installed optional service, helper, production dependencies and bundle hashes. Prior service directory/manifest are backed up under `.cache/hotfix-backups/compression-chunks-20261020`. Restarted only that configured service and restored its previous direct permission using our local Harness computer-use tool. Controller/test sessions closed normally. Live connector confirms **ready, 46 tools, tools_version 11**. The earlier installer/release assets and package build identity remain unchanged. No commit/public release was made. Remote chat rendering and remote chunk assembly remain unverified; actual local Harness transport and installed native implementation passed.

## 2026-10-23 Computer Use 交互与任务 ID 整改（Issue #2）

- **分支/范围**：feat/computer-use；Windows native/ComputerUse.cs、Mac native/MacComputerUse.swift / MacCursorGlow.swift、通用 app/base-computer-use.cjs / computer-use-agent-runner.cjs、MCP 验收与文档。
- [x] 会话 ready 后先激活窗口，失败时提示重试激活再截图；Agent 先激活后观察。原子拖动仍按标题栏真实鼠标移动→按下→拖动→释放→核验。
- [x] Windows 移除 6 像素硬失败；短暂外部指针偏移重新计算路径，持续用户接管时让渡控制；仅在原生确认 left-up 后保留会话继续观察。
- [x] Windows/macOS 源码改为全桌面光标辉光，不扩大输入窗口授权。HUD 新增目标窗口标题/PID、任务与聊天分离、STOP 圆角边距、阶段状态。
- [x] 真正聊天标题通过可选 conversation_title 从宿主传递；不可获取时保留明确缺失提示，不推测。session_title 继续表示任务。
- [x] Windows C# helper 编译及聚焦跨平台 JS 测试通过；真实 MCP Gateway 窗口夹具 node scripts/test-computer-use-mcp.cjs --atomic-drag 返回 Exit 0，报告 .cache/acceptance/computer-use/windows-atomic-drag-result.json。
- [x] 真实鼠标 (+36,+32) 位移验证、部分/全部标题栏遮挡处理、HUD 避挡、测试注入一次指针偏移后的重新规划、实际 STOP 按钮退出通过。
- [x] SDK→McpGateway→McpManager→native：start_task→get_task→submit_task_decision→succeeded→closed 的新任务 ID 完整链路通过。
- [ ] Mac Swift 本机编译和动态 HUD/鼠标视觉验收尚未做；Windows 上的 Mac JS 模拟测试不能替代原生验收。
- [ ] ChatGPT 宿主当前聊天真实标题元数据注入及客户端缓存工具 Schema 的刷新，需要实际客户端验证。
- [ ] 安装包构建与干净重装后验证，按后续构建结果更新；本轮尚未覆盖安装版。
- **Issue**：https://github.com/watermoon/ChatToHarness/issues/2。未通过项保持开放。

### 2026-10-23 后续回归缺陷（未完成）

- [ ] **Windows 鼠标位置/辉光跳回**：用户反馈启用 Computer Use 后，鼠标位于授权目标窗口之外时出现“移动一小段距离后立即跳回原位”的抖动。当前尚未确认是鼠标真实坐标被复位还是辉光视图位置错误；不宣称已解决。需优先在真实桌面做鼠标坐标与辉光位置独立采样，检查 `MoveCursorVisibleDuringDrag` 的用户输入接管逻辑和 HUD/光标跟踪、进程间位置控制冲突；修复后覆盖“窗口内→窗口外→跨屏”的人工/自动混合轨迹验收。
- **提交性质**：本次为当前实现检查点；包含未完成的 macOS 原生验收、外部 ChatGPT Schema 缓存端到端验收及上述抖动缺陷。关联 Issue #2。

## 2026-10-23 macOS Computer Use 按 Windows 基准对齐（Issue #2 后续）

- **基准**：Windows 与 macOS 均为 feat/computer-use / cd747f0，工作区起始干净；JavaScript BaseComputerUse、任务 ID Schema、Planner 和路由相同。差异在 macOS 原生 Quartz 实现。
- [x] **用户指针输入恢复**：macOS 不再因为一次超过 18pt 的偏移就终止拖动；先停止注入并等待 320ms 安静期（总等待上限约 1.8 秒），从实际鼠标位置重建剩余跨屏轨迹。持续鼠标移动/按键接管返回 CU_USER_INPUT_ACTIVE，向上层暴露 input_conflict.reason，由同一任务会话继续观察/恢复而不抢夺用户输入。
- [x] **左键释放确认**：Quartz mouse-up 使用上一次真实发送的 drag 终点坐标，避免事件排队中的位置滞后；等待连续三次系统按钮释放状态采样。只有确认释放才上报 mouse_released=true，未确认不得在原会话里盲目重放；STOP/Esc 保留独立释放兜底。
- [x] **真实前台验证**：activate 不再只信 NSRunningApplication.activate 返回值，还核对 NSWorkspace.shared.frontmostApplication 的 PID，失败仍可恢复。
- [x] **Native 构建**：Mac 本机 npm run build:computer-use Exit 0；生成资源目录的 ChatToHarness.MacComputerUse。
- [x] **Mac 非交互**：npm run test:computer-use-mac，30 测试 / 28 通过 / 2 按环境跳过 / 0 失败；增加 deviceId wrong-platform fixture 修正和 post-press release contract。
- [x] **Mac 真实 GUI**：npm run test:computer-use-mac:gui Exit 0；临时测试窗口真实点击、Unicode 输入/退格、滚动、鼠标可见轨迹、跨屏拖动、一次外部 pointer-nudge（+34,+19）后的路线恢复、mouse-up 状态和 close_session 均通过；分别测试全局 Esc 成功关闭原生 helper 而不关闭测试窗口。
- [ ] **未完成验收**：STOP 按钮的真实鼠标点击、不同鼠标/刷新率组合下的持续用户接管、HUD 外观人工视觉检查及安装后 ChatGPT 缓存 Schema 验收仍需独立确认。
- [ ] **交付**：尚未重新构建/安装正式 macOS DMG；运行中的应用包仍不等于当前源码。Windows 真实鼠标在目标窗口外偶发跳回的回归 Issue 保持开放。

## 2026-10-23 上游同步（DJ-Huang/ChatToHarness）

- **上游**：`https://github.com/DJ-Huang/ChatToHarness.git`；默认分支 `main`，获取时 `upstream/main=dd8a8925c473920e7470964ca27fd3451c9dbba6`。本地 `feat/computer-use` 合并前 HEAD 为 `bec76f60299fd3c618a8a57086d3bb7f95bf77ac`；共同祖先 `eb25b6f66c292b1d9a70013457b32744b47ef6f5`，上游独有 23 提交，开发分支独有 52 提交。
- [x] 在已有分支执行非破坏性 `git merge --no-commit --no-ff upstream/main`；7 个文件冲突逐项整合。保留分支版本 `0.7.3` 而不降级至上游 `0.6.2`；同时保留 Computer Use 注册/任务规划与上游新诊断、MCP 结果分页及恢复机制。
- [x] Mac 上执行 `npm test`：531 项，516 pass、15 skip、0 fail；为 Mac 上运行的 Windows 测试夹具配置稳定的测试设备 ID，避免将主机设备身份识别问题误报为功能回归。
- [x] `npm run test:computer-use-mac`：30 项，28 pass、2 environment skip、0 fail；Mac Swift 原生组件编译通过。
- [ ] 同步后的 Windows 原生安装包/完整真 GUI 回归仍需在 Windows 主机验证；当前 Mac 上的已安装版不等于新合并的工作区。
- [ ] 用户反馈的 Windows 鼠标在目标窗口外跳回/抖动仍未关闭；PR 应先保持 Draft，不应假称全部验收完成。
- **目标 PR**：`DJ-Huang/ChatToHarness:main` ← `watermoon/ChatToHarness:feat/computer-use`。提交前确认远程分支未被他人推进，避免强制推送。

## 2026-10-23 版本号对齐上游（PR #18）

- [x] 按用户要求，以 `DJ-Huang/ChatToHarness:main` 当前应用版本 `0.6.2` 为准，将 `package.json`、根目录 `package-lock.json` 的应用根版本统一从 `0.7.3` 调整为 `0.6.2`。此前合并记录中“保留开发分支 0.7.3”的说明仅是合并当时的历史状态，本条为后续覆盖决策。
- [x] 第三方依赖（如 `iconv-lite@0.7.3`）、既有旧版本安装验收报告与 `release-notes/v0.7.3.md` 均属于依赖数据或历史事实，不能作为当前应用版本直接替换。
- [ ] 本次版本声明同步不等于生成或安装 `0.6.2` 安装包；新安装包仍需单独构建验证。目标仍是上游 Draft PR [#18](https://github.com/DJ-Huang/ChatToHarness/pull/18)。

## 2026-10-23 Computer Use 被遮挡窗口的可见移动恢复规则（上游 Draft PR #18）

- [x] 针对 iTerm2 新建 Tab 验收中 `activate` 完成但点击被 `CU_TARGET_OCCLUDED` 拦截的场景，在 `docs/computer-use-policy.md` 补充跨平台策略：复查会话、目标身份、遮挡和安全落点；若控件仍不可达且授权目标的标题栏有可见安全落点，可使用真实 Computer Use 鼠标临时移动同一目标窗口，核验后继续原任务。
- [x] 不允许操控遮挡方、不绕过用户接管和 STOP/Esc、不自动使用未授权 AppleScript/Accessibility/Win32 直接定位；标题栏不可达或执行结果不确定时不得盲目重放。
- [ ] 这次是操作规范更新，不代表原生执行器已具备自动移动逻辑；Mac/Windows 实际遮挡恢复仍需独立验收。
- [x] 同步把上游 Draft PR #18 的说明改为中文，保留现有测试与待验收项。

## 2026-10-23 Computer Use 聊天名称来源整改

- [x] 禁止在公开 MCP 工具中把 AI 自填的 `conversation_title` 当作 ChatGPT 真实标题；`session_title` 仅表示任务。
- [x] 增加可选宿主元数据 `_meta["com.chattoharness/conversationTitle"]` 在 MCP Gateway / Manager / 内置 Computer Use 间转发，并校验内容；没有宿主提供的标题时显示不可获取。
- [x] 增加针对错误标题隔离、元数据提取以及 macOS/Windows 共享链路的单元测试。
- [ ] 当前 ChatGPT 未验证会发送此自定义元数据，`openai/session` 只是匿名 ID；真实聊天标题自动填充仍受 ChatGPT 客户端能力限制，不能宣称已通过端到端验收。
- [ ] 新改动尚未重新构建/安装 DMG；保留上游 PR #18 Draft，关联 Issue #2。

## 2026-10-24 Computer Use 旧版 MCP schema 会话标题兼容（Issue #2）

- [x] 复现：当前连接器公开的 `computer_use` schema 缺少 `session_title`，而 native `open_session` 要求该字段，导致 `CU_SESSION_TITLE_REQUIRED`；已安装的 `app.asar` 实际已有新字段，确认是连接器侧 stale schema。
- [x] `app/harness-services.cjs` 在调用 native 前通过 `computer-use-compat.cjs` 给旧 schema 的 `open_session` 补入明确标记的任务标题；不会伪造 ChatGPT 会话名称，也不会改写显式传入的标题或绕过 STOP/Esc 等保护。
- [x] 回归测试 `node --test tests/computer-use-policy.test.cjs tests/macos-computer-use.test.cjs tests/computer-use-compat.test.cjs`：36/36 通过。
- [x] Mac 构建：`CTH_DIST_SUBDIR=title-schema-fix node scripts/build.cjs` 成功，生成 `dist/title-schema-fix/mac-arm64/ChatToHarness.app`，签名校验通过。
- [ ] 更新本机安装后，以旧 schema 再次调用 `open_session` 验证真实 Computer Use，并完成 iTerm2 移到第 2 屏中央；若发现 stale schema 持续存在，另行追踪 ChatGPT 端工具缓存刷新机制。
