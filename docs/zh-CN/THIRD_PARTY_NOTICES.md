# 第三方组件说明

[English](../en/THIRD_PARTY_NOTICES.md) | [简体中文](../zh-CN/THIRD_PARTY_NOTICES.md) | [日本語](../ja/THIRD_PARTY_NOTICES.md)

ChatToHarness 使用正式发布的 Desktop Commander npm 包，不重新实现其工具功能。

| 组件 | 固定版本 | 上游 | 许可证 |
| --- | --- | --- | --- |
| Node.js | 24.22.0 | https://nodejs.org/ | MIT 及其随附依赖许可证 |
| OpenAI Tunnel client runtime | 0.0.16 | https://github.com/openai/tunnel-client | 参见上游版本的许可证报告 |
| Desktop Commander | 0.3.0 | https://github.com/wonderwhy-er/DesktopCommanderMCP | MIT 及其随附依赖许可证 |
| Electron | 44.7.2 | https://www.electronjs.org/ | MIT、Chromium 及其随附依赖许可证 |
| electron-builder（仅构建使用） | 26.15.3 | https://github.com/electron-userland/electron-builder | MIT |

安装包包含 Electron 的许可证文件，以及 `resources/licenses`（Windows）或 `Contents/Resources/licenses`（Mac）目录，内含 Node.js 声明、官方 Tunnel runtime 许可证报告、收集的 Desktop Commander 依赖声明。依赖包中也保留原始许可证文件。

Desktop Commander 有一处 ChatToHarness 专用的构建时适配：`dist/config.js` 必须使用绝对路径 `LOCALHARNESS_DC_HOME`，而不是把配置写入 `~/.claude-server-commander`。构建在应用补丁前检查原始表达式是否精确匹配，实际用户 `HOME` 不变。适配代码位于仓库的 `scripts/prepare-resources.cjs`。

下载的发布组件按版本和 SHA-256 固定；npm 依赖由已提交的锁文件和 npm 完整性校验固定。Tunnel 的校验值和许可证报告来自[官方版本](https://github.com/openai/tunnel-client/releases/tag/v0.0.16)，Node.js 校验值来自[官方校验清单](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt)。第三方许可证原文保留，不以本说明代替。
