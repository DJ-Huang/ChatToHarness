# Website release delivery

The website derives versions and public installer/checksum URLs from GitHub Releases. It does not use the application manifest as a substitute for a published release.

## Deployment contract

- Main pushes while the application version is not yet published build a preview only. Deploy after publication, when the release API exposes both native installers and SHA256SUMS.txt. This avoids deploying old release data under the commit SHA that the upcoming tag will use.
- `Desktop installers` calls `pages.yml` after its `release` job. Keep this explicit dependency: releases published with `GITHUB_TOKEN` do not independently start a new release-event workflow.
- Release callbacks wait up to six API reads for the published release assets. They fail rather than publish the preceding stable release. Replaying an older release callback still selects the newest stable release.
- The build exports its selected version and deployment eligibility as job outputs. `pages.yml` must gate deployment with `needs.build.outputs.deploy == 'true'`.
- After the Pages action succeeds, run `node scripts/verify-site.cjs "$EXPECTED_VERSION"` with the build's version. Check normal URLs and cache-busted URLs for Chinese, English and Japanese. All pages must show that version and link to its Windows installer, Mac installer and SHA256SUMS.txt. The check retries CDN propagation for approximately five minutes and fails on a persistent mismatch.
- PRs build and test without deploying. Existing Pages permissions remain confined to the deployment job.

Run local regression checks with `node --test tests/site*.test.cjs`. The verifier is read-only and can also be run manually with a numeric stable version.

## Incident evidence: 2026-10-17

The actual latest stable release was **v0.4.0**, published at 07:49:12 UTC. The initial Chinese, English and Japanese production HTML still linked to v0.3.1. A screenshot of the v0.4.0 app did not establish the website's download version.

The [main-push Website run](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39014598588) deployed before publication. The [release run](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39014606580) then built `Website built: 0.4.0` and successfully invoked Pages with artifact **12094303734**, but used the same `pages_build_version` **4d7fccdfc7732acd3b7d0ce426101e3a4460027f**. Production continued serving HTML last modified at 07:42:17 UTC with v0.3.1 downloads even after cache-busted reads. The existing pipeline had no production content check.

The evidence points to reuse of the Pages build identity across different release data; GitHub's internal reason is not directly observable. Avoid the prepublication deployment and verify actual content instead of treating the deployment API status as sufficient.

Recovery used the existing [Website workflow dispatch on main](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39016518129), at commit **5818c32956196da5fc48649143a28e98772da76b**. All three languages then returned v0.4.0 downloads and displayed versions; both installer URLs and the checksum URL returned HTTP 200. No release was recreated or edited.

Local website regressions: **11 passed**. The full suite had **125 passed, 7 failed, 3 skipped** on this Windows host. The unchanged main baseline reproduced the same seven failures: five symbolic-link permission errors and two HOME-environment assertions. These are outside the website change.
