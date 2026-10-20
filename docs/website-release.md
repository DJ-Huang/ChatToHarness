# Website release delivery

The website derives versions and public installer/checksum URLs from GitHub Releases. It does not use the application manifest as a substitute for a published release.

## Deployment contract

- Main pushes can deploy website content and style revisions using the newest published stable release metadata, even while the application package version is ahead. Website delivery is independent of the next application release.
- After its `release` job, `Desktop installers` dispatches `pages.yml` on `main`, passes the required release tag and a unique request ID, and waits for that exact run with `gh run watch --exit-status`. A failed website verification still fails the caller. Keep this explicit dependency: releases published with `GITHUB_TOKEN` do not independently start a release-event workflow.
- Direct release events also dispatch the main workflow, using a separate concurrency group so the relay cannot block its child. The actual build/deploy runs in `workflow_dispatch` context. See [actions/deploy-pages #383](https://github.com/actions/deploy-pages/issues/383); changing or inventing `GITHUB_SHA` is not required.
- Release callbacks wait up to six API reads for the published release assets. They fail rather than publish the preceding stable release. Replaying an older release callback still selects the newest stable release.
- The build exports its selected public version as a job output. `pages.yml` passes that version to the production check. Only PR events skip deployment.
- After the Pages action succeeds, run `node scripts/verify-site.cjs "$EXPECTED_VERSION"` with the build's version. All eight normal/cache-busted URLs (root English, `/en/`, Chinese and Japanese) start in parallel. Every page must show that version and link to its Windows installer, Mac installer and SHA256SUMS.txt. Transient failures retry every five seconds within a two-minute total budget, including HTTP time. Failures report observed versions, ETag, cache age and cache state, plus the main-dispatch recovery action. Persistent stale content cannot turn green by exhausting retries.
- PRs build and test without deploying. Existing Pages permissions remain confined to the deployment job.

Run local regression checks with `node --test tests/site*.test.cjs`. The verifier is read-only and can also be run manually with a numeric stable version.

## Incident evidence: 2026-10-17

The actual latest stable release was **v0.4.0**, published at 07:49:12 UTC. The initial Chinese, English and Japanese production HTML still linked to v0.3.1. A screenshot of the v0.4.0 app did not establish the website's download version.

The [main-push Website run](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39014598588) deployed before publication. The [release run](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39014606580) then built `Website built: 0.4.0` and successfully invoked Pages with artifact **12094303734**, but used the same `pages_build_version` **4d7fccdfc7732acd3b7d0ce426101e3a4460027f**. Production continued serving HTML last modified at 07:42:17 UTC with v0.3.1 downloads even after cache-busted reads. The existing pipeline had no production content check.

The deployments reused the Pages build identity across different release data, but whether that caused the stale response is not proven. Cache propagation or a Pages-side issue remains possible. Verify actual content instead of treating the deployment API status as sufficient; do not restrict ordinary website updates based on this unproven cause.

Recovery used the existing [Website workflow dispatch on main](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39016518129), at commit **5818c32956196da5fc48649143a28e98772da76b**. All three languages then returned v0.4.0 downloads and displayed versions; both installer URLs and the checksum URL returned HTTP 200. No release was recreated or edited.

Local website regressions: **12 passed**, including an actual main-event build while the application version is ahead of the public release. The initial full suite had **125 passed, 7 failed, 3 skipped** on this Windows host. The unchanged main baseline reproduced the same seven failures: five symbolic-link permission errors and two HOME-environment assertions. These are outside the website change.

The initial PR's macOS application check passed its unit tests (130 passed, 5 skipped), then failed packaging: electron-builder skipped signing in a PR, while the existing build script required `codesign --verify --deep --strict` to pass. No signing policy or packaging code is changed here.

## Incident evidence: v0.5.0 release deployment

On 2026-10-17, the `v0.5.0` release workflow successfully built the site using the published installers and Pages reported deployment success, but all four production routes continued returning v0.4.0 HTML. The production verifier correctly failed after 20 attempts, including cache-busted requests. Both v0.5.0 installers and `SHA256SUMS.txt` were independently confirmed publicly downloadable with matching sizes and SHA-256 digests.

The release and main branch pointed at the same commit (`c860427cd0a294e0737691526cf1a3778ee9d555`) for both the pre-release main deployment and the release-triggered deployment. A follow-up main commit that changes website-owned content is required to give Pages a new build identity and trigger a fresh production deployment; rerunning the same deployment job alone did not fix the stale HTML. Keep the post-deployment content check mandatory and do not report the release as fully delivered until all four locale routes serve the published version and download links.

## Incident evidence: v0.6.1, 2026-10-20

The [tag workflow's production check](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39365023717/job/118442715613) checked from 03:45:44.705 to 03:56:30.618 UTC: **645.9 seconds**, 44 failed attempts. Every route still served v0.6.0. Independent reads included cache misses with `Age: 0` and the old version, so a long CDN wait alone did not explain recovery.

The [independent main dispatch](https://github.com/DJ-Huang/ChatToHarness/actions/runs/39366860997/job/118445846915) used the **same** commit and Pages build version, `835948c54aef2352c282dad30269cfbbfe4a69cf`. Its production check started at 03:57:17.299 and reported success at 03:57:17.582 UTC (**about 0.28 seconds**, first attempt). All public locale routes then displayed v0.6.1 and the matching installer/checksum links. Thus a new source commit is not necessary for this recovery; the earlier incident's fresh-commit workaround is historical, not the current deployment contract. The evidence supports dispatching the website on main instead of inheriting a release/tag caller's event context; it does not identify GitHub's internal server-side cause.

The v0.6.1 installers and checksum file were published successfully before website recovery. The supplied comparison image is embedded in the three-language notes and separately attached; its SHA-256 is `5c5093a82fbe11a52d01f41f6cb97159991d50dfc366a389af52d365b53ab1c7`.

Local website regressions after the workflow/verifier change: **27 passed**. They cover dispatch correlation, caller failure propagation, required release metadata, stale locale/cache variants, eight concurrent requests and the total verification budget. The changed verifier also passed against the live v0.6.1 website. Automated relay deployment still requires the workflow change to be merged and exercised on main.
