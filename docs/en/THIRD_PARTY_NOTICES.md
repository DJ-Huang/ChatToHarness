# Third-party components

[English](../en/THIRD_PARTY_NOTICES.md) | [简体中文](../zh-CN/THIRD_PARTY_NOTICES.md) | [日本語](../ja/THIRD_PARTY_NOTICES.md)

ChatToHarness uses the actual Desktop Commander npm release. It does not reimplement Desktop Commander's tools.

| Component | Pinned version | Upstream | License |
| --- | --- | --- | --- |
| Node.js | 24.22.0 | https://nodejs.org/ | MIT and bundled dependency licenses |
| OpenAI Tunnel client runtime | 0.0.16 | https://github.com/openai/tunnel-client | See upstream release license report |
| Desktop Commander | 0.3.0 | https://github.com/wonderwhy-er/DesktopCommanderMCP | MIT and bundled dependency licenses |
| Electron | 44.7.2 | https://www.electronjs.org/ | MIT, Chromium and bundled dependency licenses |
| electron-builder (build only) | 26.15.3 | https://github.com/electron-userland/electron-builder | MIT |

The packaged application includes Electron's license files and a `resources/licenses` (Windows) or `Contents/Resources/licenses` (Mac) directory containing Node.js notices, the official Tunnel runtime license report, and collected Desktop Commander dependency notices. Original package license files are also retained inside the bundled dependencies.

Desktop Commander has one ChatToHarness-specific build-time modification: `dist/config.js` requires the absolute `LOCALHARNESS_DC_HOME` path instead of storing its configuration under `~/.claude-server-commander`. The build asserts the original expression before applying this patch. The real user `HOME` remains unchanged. This local adaptation is described in `scripts/prepare-resources.cjs`.

Release downloads are fixed by version and SHA-256. npm dependencies are fixed by committed lockfiles and npm integrity hashes. The Tunnel checksum and license report originate from the [official release](https://github.com/openai/tunnel-client/releases/tag/v0.0.16); Node.js hashes originate from the [official checksum list](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt).

Original third-party license texts are retained; this overview does not replace them.
