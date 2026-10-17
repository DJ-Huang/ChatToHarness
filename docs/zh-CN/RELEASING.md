# 构建、发布与网站维护

[English](../en/RELEASING.md) | [简体中文](../zh-CN/RELEASING.md) | [日本語](../ja/RELEASING.md)

仓库：`DJ-Huang/ChatToHarness`，默认分支 `main`。只有源码、锁文件、组件下载校验、资源和文档进入 Git。

## 三条工作流

- **Application checks**：PR、main 应用相关更新和手动触发；原生 Windows x64、Mac arm64 单元检查、打包及隔离配置窗口验收。
- **Desktop installers**：`vX.Y.Z` 标签或手动触发；两平台生成安装包、检查真实窗口和安装过程，最后生成草稿。手动在分支运行仅生成 Actions 产物，在标签运行才生成 Release 草稿。
- **Website**：main 网站相关更新、公开 Release 变化或手动触发；PR 仅构建不部署。发布事件始终读取当前 main 的网站源码。

## 发布一个版本

1. 同时更新 `package.json`、`package-lock.json` 根版本及包版本，合并到 main。
2. 推送与应用版本一致的 `vX.Y.Z` 标签。工作流不会自动改版本或创建标签。
3. 等待双平台检查通过。草稿包含 `ChatToHarness-X.Y.Z-windows-x64-setup.exe`、`ChatToHarness-X.Y.Z-macos-arm64.dmg` 和 `SHA256SUMS.txt`。
4. 核对构建报告、签名状态及实际验收记录，再在 GitHub 正式发布草稿。
5. Website 工作流自动更新公开稳定版本下载链接。没有公开版本时显示“暂未发布”，草稿和预发布不进入首页。

失败可修复源码后重试；已公开版本不能覆盖产物，需发布新版本。Release 上传校验大小及 SHA-256。GitHub API 或下载失败必须中止，不伪装成没有版本。

## 签名配置

默认 Windows 未签名、Mac 临时签名且未 Apple 公证。草稿明确记录此状态。开启手动构建的 `signed` 选项后必须提供：

- Windows：`WINDOWS_CSC_LINK`、`WINDOWS_CSC_KEY_PASSWORD`。
- Mac：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。

证书和口令只放仓库 Actions Secrets，不提交源码。正式签名模式缺少配置直接失败；Mac 验证签名和公证。上传证书不会自动改变默认构建模式。

## 网站

Pages Source 设置为 GitHub Actions。官方环境使用 `github-pages`，部署作业仅拥有必要权限。生产网站的构建和部署串行运行，环境须允许 main 和版本标签，以便正式发布 Release 后更新网站。

静态源在 `site/`，构建输出 `dist/site/`。`node scripts/build-site.cjs` 读取 GitHub 公开稳定 Release，支持仓库子路径，安装包直接链接 Releases。离线构建检查使用 `--fixture tests/fixtures/no-releases.json`。

应用截图必须来自临时验收配置，隐藏真实 Tunnel ID、密钥、用户名和工程内容。站点不提供密钥填写或保存入口。三种语言的文档保持一致，网站链接指向相应语言。

CI 仅使用模拟通道和临时数据目录；真实个人 Tunnel 不得同时部署到 CI 或其他电脑。工具调用端到端验收另记入 [VERIFICATION.md](VERIFICATION.md)。
