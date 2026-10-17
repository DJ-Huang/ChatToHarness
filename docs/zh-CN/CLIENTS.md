# 客户端接入

[English](../en/CLIENTS.md) | [简体中文](../zh-CN/CLIENTS.md) | [日本語](../ja/CLIENTS.md)

执行链路：客户端 → Secure MCP Tunnel → 本机工具代理 → Desktop Commander。先打开 ChatToHarness，选择工作目录、保存通道配置，确认“通道就绪”。同一 Tunnel 的本机 stdio 运行实例保持单个，切勿在其他工具中再启动第二个 runtime。

## ChatGPT

在支持自定义 MCP 的设置中添加应用，连接类型选择 Tunnel，关联相同 Tunnel ID。确认目标工作区与 Tunnel 关联，操作者具有使用权限。完成工具发现后，在新任务中给出工程路径，先只读检查，再在专用临时目录测试读写。

[官方通道接入说明](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

工具开关、调用确认和对可疑描述的检查是不同事项。若出现“存在可疑指令”，先查看警告指出的描述和实际工具参数。旧版 Harness 重复要求自动加载规范、传递令牌，本轮已改为客观接口说明，并保留服务端校验。任意终端仍标注为可写入和访问网络，不能因为某次命令只读就将整个工具标成只读。服务端无法关闭 ChatGPT 的安全检查，也不保证所有确认消失。

更新正在运行的 Harness 后，在插件详情中刷新工具，获取新的描述、参数和服务器说明。仅修改源码不会更新已运行的进程或客户端工具目录。完成刷新后再用只读任务验证。OpenAI 官方文档还说明，记住的调用确认可能只适用于当前对话，新对话或刷新对话后可能重新确认。[工具管理与确认说明](https://developers.openai.com/api/docs/guides/custom-mcp-server)

## Codex

官方列明 Codex 是支持的通道调用产品。使用当前产品版本所提供的通道支持入口／插件接入流程，并核对 Platform 组织关联和使用权限。可以复用已由 ChatToHarness 管理的 Tunnel，无需再创建 Tunnel，也不要另外启动 runtime。

不同 Codex 产品入口、账号和版本可能提供不同配置方式。本说明不生成未经验证的本地 MCP 配置或把托管通道地址当作普通公开服务地址。完成工具发现与实际调用前，只标记“官方支持”，不标记“本机已验证”。

[官方通道指南](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) · [Codex 文档](https://developers.openai.com/codex/)

## Responses API

在 MCP 工具声明中使用 `tunnel_id`，不要将托管通道地址填写为 `server_url`：

```json
{
  "type": "mcp",
  "server_label": "chat_to_harness",
  "tunnel_id": "替换为应用中配置的 Tunnel ID"
}
```

该片段放入调用方 Responses 请求的 `tools` 中，模型、输入和审批处理由调用方配置。API 调用密钥由调用方管理，不能使用本机的 Runtime API Key 替代。应用帮助页面会显示带当前 Tunnel ID 的片段，不包含任何密钥。

[Responses API 接入示例](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#connect-from-the-responses-api)

## AgentKit

官方发布记录列出 AgentKit 支持安全通道。按账户和产品实际提供的通道选择入口配置，保持同一 Tunnel runtime 运行。本版提供官方指引，不生成缺少官方依据的专属配置。

[官方发布记录](https://developers.openai.com/api/docs/changelog) · [通道指南](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

其他厂商的客户端目前没有列入本产品兼容清单。通道官方支持、账号可用性、工具发现成功、真实调用成功是不同状态。

已记录的实际验证结果见[验证记录](VERIFICATION.md)。
