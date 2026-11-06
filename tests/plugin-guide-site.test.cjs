'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { translate } = require('../app/i18n.js');
const { buildHelp, readArticle } = require('../scripts/help-site.cjs');
const root = path.resolve(__dirname, '..');

for (const locale of ['en', 'zh-CN', 'ja']) {
  test(`${locale} client and service guides use the released plugin navigation`, () => {
    const clients = fs.readFileSync(path.join(root, 'docs', locale, 'CLIENTS.md'), 'utf8');
    const management = fs.readFileSync(path.join(root, 'docs', locale, 'manage-services.md'), 'utf8');
    const addPath = ['插件', '添加插件', '接入 MCP 服务'].map(key => translate(locale, key)).join(' → ');
    assert.ok(clients.includes(`**${addPath}**`), 'client guide must name the complete add path');
    for (const target of ['local-services.md', 'remote-services.md', 'import-export.md']) {
      assert.ok(clients.includes(`](${target})`), `missing current guide: ${target}`);
      assert.ok(fs.existsSync(path.join(root, 'docs', locale, target)));
    }
    for (const key of ['插件', '管理', '连接配置', '概览与权限']) {
      assert.ok(management.includes(`**${translate(locale, key)}**`), `missing current UI label: ${key}`);
    }
    assert.ok(management.includes('https://github.com/DJ-Huang/ChatToHarness/releases/tag/v0.8.1'));
    for (const source of [clients, management]) assert.doesNotMatch(source, /MCP Servers/);
    assert.doesNotMatch(management, /0\.6\.0/);
  });
}

test('released plugin steps reach the generated help and search index in every language', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-plugin-guide-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  buildHelp(output);
  for (const locale of ['en', 'zh-CN', 'ja']) {
    const article = readArticle(locale, 'manage-services');
    const html = fs.readFileSync(path.join(output, 'docs', locale, 'manage-services/index.html'), 'utf8');
    assert.ok(html.includes(article.html));
    assert.ok(html.includes('releases/tag/v0.8.1'));
    const index = JSON.parse(fs.readFileSync(path.join(output, 'docs', locale, 'search.json'), 'utf8'));
    const text = index.articles.find(item => item.slug === 'manage-services').text;
    for (const key of ['插件', '管理', '连接配置', '概览与权限']) assert.ok(text.includes(translate(locale, key)));
    assert.doesNotMatch(text, /MCP Servers/);
  }
});
