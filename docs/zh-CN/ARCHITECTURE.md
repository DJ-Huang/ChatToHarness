# ChatToHarness 架构

[English](../en/ARCHITECTURE.md) | [简体中文](../zh-CN/ARCHITECTURE.md) | [日本語](../ja/ARCHITECTURE.md)

执行链路为支持的客户端 → OpenAI Secure MCP Tunnel → 本机 Tunnel runtime → 工程规范协议代理 → Desktop Commander。面向客户端只提供 Tunnel 接入；内部 stdio 和 loopback 健康端点不是新增的对外 MCP 服务。

## 桌面层

Electron 主进程管理配置、系统加密存储、单实例、窗口、后台图标和连接队列。HTML/CSS/JavaScript 提供四个真实页面；受限 preload 暴露设置、目录选择、状态订阅及连接操作。渲染器禁用 Node，启用沙箱、上下文隔离、导航限制和外部链接白名单。

窗口关闭只隐藏。停止与退出增加 actionEpoch，取消排队的自动连接及保存后的连接续步。窗口完成加载后才开始自动读取密钥，避免系统授权挡住初次呈现。状态只包含密钥是否保存，不返回明文或密文。

Mac 保留 LocalHarness 的内部名称、应用标识和状态目录，显示名称为 ChatToHarness；Windows 使用独立系统数据目录。系统加密不可用时拒绝明文回退，读取失败保留原设置。Windows 的用户级系统加密不表示同用户其他程序无法访问。

## 平台与受管进程

平台适配层提供组件位置、默认 Shell、用户环境、通道命令及进程监督。Mac 使用进程组和拥有进程清理；Windows 用编译的 Job Object 辅助进程约束受管子树，进程退出关闭 Job。Tunnel 密钥只通过环境传入，工具代理启动 Desktop Commander 前移除该变量。

平台组件由固定版本和校验值准备，自带 Node；工具配置与日志位于私有数据目录，保留用户真实 HOME／USERPROFILE，遥测关闭。Desktop Commander 配置目录适配只接受已知源码匹配，失配停止构建。

## 规范代理

`get_project_context(project_path, target_paths?, rule_paths?)` 返回工程根、适用 AGENTS、规则索引、所选正文及版本标识。文件、搜索、写入和终端工具要求 `project_context_tokens`；Shell 额外声明目标 `context_paths`。缺少或过期上下文时不执行操作，由调用方加载后明确重试。

根到目标目录的 AGENTS 支持大小写兼容并检测候选冲突。根 rules 索引递归 Markdown，AGENTS 可引用工程内文本规范；realpath 检查防止链接越界。正文总计最多 64 KiB，不静默截断。上下文按工程、作用范围和内容版本绑定，每次调用显式传递，避免并发聊天串用。取消、通知、请求 ID 和并发调用保持协议语义。可选网页预览提示被移除，使用普通工具结果。

## 构建与交付

GitHub Actions 在原生 Windows x64、Mac arm64 构建，校验打包资源、运行隔离窗口和安装检查。只有双平台通过后生成带 SHA-256 的草稿；公开 Release 不覆盖。Pages 独立构建，首页下载只使用已公开稳定 Release，源码和页面均不保存用户配置或凭据。

运行和验收边界见 [VERIFICATION.md](VERIFICATION.md)，维护流程见 [docs/RELEASING.md](RELEASING.md)。
