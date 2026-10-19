# 使用前需要准备什么

[English](../en/requirements.md) | [简体中文](../zh-CN/requirements.md) | [日本語](../ja/requirements.md)

> 适用于 ChatToHarness 0.6.0。

## 使用目标

在安装前确认电脑、账号与连接资料，减少首次配置时的中断。

## 开始前

使用 macOS 14 或更新版本的 Apple 芯片 Mac，或 Windows 11 x64 电脑。

## 操作步骤

1. 确认账号提供 Tunnel 接入入口；没有入口时先联系工作区管理员。
2. 在 OpenAI Platform 的 Tunnels 页面创建或选择通道，关联目标组织和 ChatGPT 工作区。
3. 创建或修改通道需要 Tunnels Read + Manage；运行和使用通道需要 Read + Use。
4. 准备 Tunnel ID 和 Runtime API Key，并选一个用于首次试用的空文件夹。

![使用前需要准备什么](../images/help/zh-CN/connection.png)

1 通道标识；2 本机运行密钥；3 保存并连接。 界面演示：使用当前仓库界面与隔离示例数据，不代表真实通道或工具调用成功。

## 完成后的表现

你能打开通道配置页，知道要连接哪个通道，并持有相应使用权限。安装包已包含运行组件，无需另装开发环境。

## 没有成功时

账号权限由服务方和管理员控制，安装本应用不会自动开通权限。Runtime API Key 只填到本机应用，不要发进聊天。外部工具可能需要单独安装或账号。

[OpenAI 官方接入说明](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels#permissions-and-access)

## 下一步

- [安装 ChatToHarness](installation.md)
- [连接 ChatGPT](chatgpt.md)
