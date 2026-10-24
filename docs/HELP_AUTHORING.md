# Maintaining the repository-driven help center

The website renders articles from `docs/en/`, `docs/zh-CN/` and `docs/ja/` at build time. Do not copy article bodies into `site/`. `docs/navigation.json` defines the ordered topics and language correspondence; article titles come from their Markdown headings. `site/help/` contains presentation and interface translations only.

## Editing an article

1. Edit the same filename in all three language folders. Organize sections to fit the topic; goal, preparation, steps, expected result, troubleshooting and next steps are a suggested outline, not a required section count or order. Sections may be added, omitted or reordered. Write user actions and observable outcomes, not implementation explanations.
2. Use repository-relative links such as `first-task.md` and `../images/help/en/connection.png`. These also work in GitHub. During the website build, article links become help-center URLs; developer references remain repository links.
3. Maintain translated terms using `docs/terminology.json`, and match the actual app labels. Existing standard section titles retain the website links `#goal`, `#before`, `#steps`, `#result`, `#troubleshooting`, `#next` regardless of their position. Other level-two headings receive independent `#section-…` links and appear in the contents; repeated headings receive unique suffixes. Preserve published links when renaming a standard section. For links intended to work in both GitHub and the website, link to the article without a section fragment because GitHub generates localized heading anchors.
4. Put images in `docs/images/`. Use corresponding-language app captures, explanatory alt text and numbered captions. Do not embed remote images or raw HTML. Follow `docs/images/help/README.md` for provenance and disclosure.
5. Update `docs/feature-coverage.json` when adding a user-facing action or built-in tool. A topic should cover its subordinate actions, not expose implementation parameters as the manual.

## Preview and focused checks

```sh
npm ci --ignore-scripts
node scripts/build-site.cjs --fixture tests/fixtures/no-releases.json
node --test tests/*site*.test.cjs tests/help-links.test.cjs tests/i18n.test.cjs
```

The fixture build is an offline preview. Its download controls deliberately show no published release. Serve `dist/site/` under `/ChatToHarness/` and open `/ChatToHarness/docs/en/`, `/ChatToHarness/docs/zh-CN/` or `/ChatToHarness/docs/ja/`. `scripts/preview-help.cjs` provides that local server and prints its URL.

Changes under `docs/**` trigger the existing Pages workflow. The workflow builds the repository articles and assets alongside the existing website, checks its links and deploys only on the existing allowed events. Pull requests build without publishing. The static pages do not request GitHub article bodies at browsing time.

## Compatibility and publication

- Existing `GUIDE.md` and `CLIENTS.md` remain available, including their original sections. Add migration notices without deleting existing anchors or unrelated edits.
- The first help edition covers v0.6.0. Screenshots show the current repository interface using isolated synthetic state. They are demonstrations, not acceptance evidence for an actual tunnel, client, external service, Windows or macOS installer.
- Keep official service instructions linked rather than inventing client settings. Availability differs by account and product version. Official OpenAI connection guides were consulted on 2026-10-19.
- Language URLs are explicit. Switching languages keeps the article and the website's stable section; the landing website keeps its existing English-default behavior. App help links use the current app language.
