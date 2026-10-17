# Build, Release, and Website Maintenance

[English](../en/RELEASING.md) | [简体中文](../zh-CN/RELEASING.md) | [日本語](../ja/RELEASING.md)

Repository: `DJ-Huang/ChatToHarness`; default branch: `main`. Commit only source, lockfiles, component checksums, assets, and documentation.

## Three workflows

- **Application checks** runs for PRs, application-related updates on main, and manual dispatch. It checks units, native packages, and isolated windows on Windows x64 and Mac arm64.
- **Desktop installers** runs for `vX.Y.Z` tags or manual dispatch. It builds installers, checks real windows and installation, verifies uploaded checksums, and automatically publishes a stable Release with release notes. Manual runs on a branch produce Actions artifacts only; selecting a matching version tag publishes that version.
- **Website** runs for website-related main changes, public Release changes, or manual dispatch. PRs build without deployment. Release events always use the current main branch's website source.

## Release a version

1. Update `package.json`, the root version in `package-lock.json`, and the lockfile's root package version together, then merge into main.
2. Push a matching `vX.Y.Z` tag. Workflows do not change versions or create tags automatically.
3. Wait for both platforms to pass. The public Release contains `ChatToHarness-X.Y.Z-windows-x64-setup.exe`, `ChatToHarness-X.Y.Z-macos-arm64.dmg`, and `SHA256SUMS.txt`.
4. Publication is automatic after all uploaded assets pass size and SHA-256 verification. A failed build or upload never publishes an incomplete release.
5. Website updates the download links from published stable Releases. Before a public version exists it shows unavailable downloads. Drafts and prereleases are excluded.

Fix source and retry failures. Published assets must not be overwritten; release a new version instead. Uploads are verified by size and SHA-256. GitHub API and download failures must stop the process rather than masquerade as an empty release history.

## Signing

Default Windows packages are unsigned; Mac packages use ad-hoc signing without Apple notarization. Release notes state this explicitly. Enabling the manual workflow's `signed` option requires:

- Windows: `WINDOWS_CSC_LINK`, `WINDOWS_CSC_KEY_PASSWORD`.
- Mac: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

Store certificates and passwords in repository Actions Secrets, never in source. Explicit production-signing mode fails on missing configuration. Mac signatures and notarization are verified. Adding certificates does not automatically change the default build mode.

## Website

Set Pages Source to GitHub Actions. Deployment uses the `github-pages` environment and only the necessary permissions. Production website builds and deployments are serialized. The environment must allow main and version tags so publishing a Release can update the site.

Static source lives in `site/`, with output in `dist/site/`. `node scripts/build-site.cjs` reads public stable Releases from GitHub, supports the repository subpath, and links installers directly to Releases. For offline checks use `--fixture tests/fixtures/no-releases.json`.

Use application screenshots from isolated verification settings. Hide real Tunnel IDs, keys, usernames, and project content. The site never provides a credential input or storage feature. Keep the three documentation languages aligned and link to the matching language from the website.

CI uses only simulated tunnels and temporary data directories. Never run a personal Tunnel simultaneously in CI or on another computer. Record real client end-to-end checks separately in [VERIFICATION.md](VERIFICATION.md).

Maintain all app and website translations together. Recapture all three sets of screenshots after visible changes; use isolated credentials and a simulated tunnel. UI smoke checks generate one image per page and language.

Release notes combine GitHub-generated changes with optional `release-notes/vX.Y.Z.md` content. Provide authored notes in all three languages. A draft is used only as a private upload stage; after verification the workflow publishes it automatically. The release workflow then calls the Website workflow directly, because events created with `GITHUB_TOKEN` do not start ordinary release-triggered workflows. See [GitHub token behavior](https://docs.github.com/en/actions/concepts/security/github_token). No personal token is required.
