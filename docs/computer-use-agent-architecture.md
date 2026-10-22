# Computer Use 通用 GUI Agent 架构（2026-10-22）

目标：**Windows / macOS 通用自主 GUI 执行器**。窗口移动只是兼容用例，不是系统架构。

## 架构

\`\`\`mermaid
flowchart TD
  A[用户目标与已有授权会话] --> B[观察截图和目标窗口]
  B --> C[可信 Planner / 模型决策]
  C --> D{下一步}
  D -->|GUI 操作| E[ActionExecutor 验证并执行原生鼠标/键盘]
  E --> F[持久检查点和新观察]
  F --> C
  D -->|恢复/等待| B
  D -->|已核验完成| G[关闭会话与 STOP HUD]
  B --> H{STOP/Esc/会话已终止?}
  H -->|是| I[结束且禁止重放]
\`\`\`

## 通用 MCP API

| Action | 用途 |
|---|---|
| \`start_task(session_id, observation_id, goal, idempotency_key)\` | 创建带既有授权的通用 GUI 任务，异步推进 |
| \`get_task(session_id, task_id)\` | 查询状态；待决策时返回最新截图、decision_id |
| \`submit_task_decision(session_id, task_id, decision_id, decision_json)\` | 可信调用端提交**一个**经约束的 GUI 动作/完成判断 |
| \`cancel_task(session_id, task_id)\` | 终止任务、释放原生鼠标、关闭会话 |

合法单步决定包括 \`{"action":{"action":"click","x":20,"y":30}}\`、其它既有安全 GUI 输入动作（移动、按键、输入、滚动、拖动、激活），或者 \`{"done":true}\` / \`{"wait":true}\`。Runner 为动作附加当前会话和新鲜 observation；不接受由 Planner 伪造会话、窗口和设备标识。

\`ComputerUseAgentRunner\` 负责 \`observe → decide → act → observe\` 的执行循环、错误恢复、持久化检查点、取消、重试退避。可注入 \`agentPlanner({goal, step, observation, last_error, last_action})\` 进行真正连续的动态决策。若无已配置 Planner，进入 \`awaiting_decision\` 并提供截图，由 ChatGPT/Codex 等可信调用端回传下一步；**不能把这种等待状态说成已经具有无人值守的模型规划能力**。

## 决策时效与停止机制

- 一次 `observe` 的原生输入有效期为 30 秒。通用 Agent 最迟在 28 秒主动淘汰该截图对应的外部 `decision_id`，清理内存引用并重新观察；旧动作或旧完成判断在进入原生层前即被拒绝。
- Planner 决策有 15 秒超时，但决策完成后必须清理超时定时器。STOP/Esc 或原会话终止会向待决策模型请求传递 `AbortSignal`，迟到的返回值不得驱动鼠标或键盘。
- Windows/macOS 共用这些 JavaScript 任务规则；模型客户端支持 MCP Sampling 与否仍需在真实安装版分别验收。已新增分块截图处理：由同一原授权会话通过 `read_screenshot` 分块取回内存数据，逐块和整体验证 SHA-256、长度、offset、EOF；若采样图过大，仅为模型生成有尺寸映射的 JPEG 预览，所有点击的模型图片坐标由执行器映射回原生窗口截图像素。原始截图不写入磁盘。较大截图仍须验证真实客户端的图像输入能力。

## 安全与持久化

- 原生 Esc/STOP、用户接管、授权和目标窗口作用域继续生效；不会自动恢复已终止的原生会话。
- 可恢复错误不会按固定次数放弃，重新观察后动态决策，不盲目重放可能已经生效的点击、输入或拖动。
- 同一原生控制器只允许一个活动 GUI 任务；原有独立输入和旧窗口移动任务不能与之争夺鼠标。
- 本地原子 JSON 检查点只存状态、目标摘要、动作名称、步数及观察到的窗口几何；不保存截图、输入的文字或原始目标。
- 进程重启后未完成任务只能查询为 interrupted，不会在新会话中自动注入输入；完成后退出并清除 HUD。

## 实施阶段与验收

- **已实现**：动态动作执行内核、可插拔 Planner、MCP Sampling 可选适配器、调用端决策桥、通用任务状态、重观察/错误恢复、取消和安全检查点；Windows/macOS 公共 schema 与资源清单。
- **已集成可选 MCP Sampling Planner**：win/mac MCP stdio 服务检查客户端是否声明 `sampling`，若支持则通过 SDK `createMessage` 把既有授权窗口的内存截图和目标发送给同一 MCP 客户端，请求 JSON 单步决策；不支持、拒绝、响应不合法时安全进入 `awaiting_decision`，不向任意外部模型 URL 发送请求。
- **待实现/核验**：真实 ChatGPT/Codex 客户端是否支持服务端异步 sampling（尤其在启动请求已返回后）；模型对 JPEG 预览及坐标变换的实际效果；跨多应用/窗口的逐目标授权切换；Windows 与 macOS 原生 GUI 实机验收；模型对完成条件的严格视觉验证；高频输入占用、停止竞争及稳定性。
- **兼容层**：\`start_move_task/get_move_task/cancel_move_task\` 仍可用，仅用来兼容和专项回归，不再代表主要架构。

所有日常自动化回归必须使用 mock 原生设备，不得未经明确说明操作用户真实鼠标。
