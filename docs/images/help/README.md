# Help illustration provenance

- **Source:** actual `app/index.html`, styles and renderer from this repository, version label 0.6.0, captured on 2026-10-19 in a disposable Electron window. Existing uncommitted source changes were retained; these images are not a claim that every pictured detail shipped in the public release.
- **Isolation:** `scripts/capture-help.cjs` supplies synthetic state through a dedicated preload. It does not launch the real app main process, read an existing profile, open the keychain, connect a tunnel, launch an external service or execute business tools.
- **Disclosure:** every screenshot includes a localized demonstration banner. Service names, paths, request IDs, timestamps, status and records are examples. No real ChatGPT or Codex call is depicted. The app's fixed footer can be partly outside a scrolled view; the disclosure banner remains visible.
- **Annotations:** numbered markers are capture-only DOM overlays. The adjacent article caption explains each marker. They do not alter product behavior.
- **Languages:** `en/`, `zh-CN/` and `ja/` contain matching scene names. Foreign proper names, example paths and commands intentionally stay unchanged.
- **Diagrams:** SVGs are editable source assets showing user workflows. They are illustrations, not execution evidence or installation screenshots. Platform install steps are described in prose; the macOS capture environment does not verify Windows native operation.

To refresh screenshots after a relevant interface change:

```sh
node scripts/capture-help.cjs en
node scripts/capture-help.cjs zh-CN
node scripts/capture-help.cjs ja
```

Use a GUI-capable host with the pinned Electron and Playwright dependencies installed. Review the resulting images before publishing; never substitute your personal configuration or credentials. Keep the numbered captions in the articles aligned with the captures.

## Computer Use management screenshots — 2026-10-24

The three `computer-use.png` files were captured from the v0.8.1 application renderer at commit `733f3fdc1f5ccd3dc55f8bd9ff1a3b129eee3483`, using the same isolated documentation harness. They show the macOS management interface with Computer Use **off** and Screen Recording / Accessibility **not checked**. These states are synthetic; no native helper, system-permission prompt, desktop input, existing profile or live client connection was used.

The screenshots are 1160 × 900 pixels. Each image has its own localized interface and visible demonstration notice. The capture notice is placed inside an open modal dialog so it remains visible above the backdrop. The older scenes retain the provenance recorded above.

Capture only this scene without replacing the existing screenshots:

```sh
node scripts/capture-help.cjs en computer-use
node scripts/capture-help.cjs zh-CN computer-use
node scripts/capture-help.cjs ja computer-use
```

Omitting the scene argument captures all 16 scenes. New captures read the version label from `package.json`.
