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
    const caption = { en: 'Earlier interface demonstration', 'zh-CN': '历史界面演示', ja: '以前の画面例' };
    assert.ok(management.includes(caption[locale]), 'older screenshots must not be presented as the current navigation');
  });
}

for (const locale of ['en', 'zh-CN', 'ja']) {
  test(`${locale} permission troubleshooting names the released panels and labels its historical image`, t => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-permission-guide-'));
    t.after(() => fs.rmSync(output, { recursive: true, force: true }));
    const source = fs.readFileSync(path.join(root, 'docs', locale, 'permission-problems.md'), 'utf8');
    for (const key of ['插件', '管理', '连接配置', '概览与权限']) {
      assert.ok(source.includes(`**${translate(locale, key)}**`), `missing current UI label: ${key}`);
    }
    assert.ok(source.includes('https://github.com/DJ-Huang/ChatToHarness/releases/tag/v0.8.1'));
    assert.ok(source.includes('](manage-services.md)'));
    assert.ok(source.includes(`](../images/help/${locale}/mcp-approval.png)`), 'keep the existing demonstration image');
    const caption = { en: 'Earlier interface demonstration', 'zh-CN': '历史界面演示', ja: '以前の画面例' };
    assert.ok(source.includes(caption[locale]), 'old screen must not be described as the current interface');
    assert.doesNotMatch(source, /MCP Servers|0\.6\.0/);
    const safeguards = {
      en: ['check whether execution started', 'independent client confirmation', 'Do not use chat tools to change the folder allowlist'],
      'zh-CN': ['检查请求是否尚未执行', '独立的客户端权限', '不要让聊天工具直接改目录白名单'],
      ja: ['実行済みかを調べてから', '独立したクライアント側の許可', 'チャットから許可フォルダーを書き換えたり'],
    };
    for (const text of safeguards[locale]) assert.ok(source.includes(text), `preserve safeguard: ${text}`);
    buildHelp(output);
    const html = fs.readFileSync(path.join(output, 'docs', locale, 'permission-problems', 'index.html'), 'utf8');
    const search = JSON.parse(fs.readFileSync(path.join(output, 'docs', locale, 'search.json'), 'utf8'));
    const indexed = search.articles.find(article => article.slug === 'permission-problems').text;
    for (const key of ['插件', '管理', '连接配置', '概览与权限']) {
      assert.ok(html.includes(translate(locale, key).replaceAll('&', '&amp;')), `rendered label missing: ${key}`);
      assert.ok(indexed.includes(translate(locale, key)), `indexed label missing: ${key}`);
    }
    assert.ok(html.includes(`/ChatToHarness/docs/${locale}/manage-services/`));
    assert.ok(html.includes(caption[locale]));
    assert.ok(indexed.includes(caption[locale]));
    assert.doesNotMatch(indexed, /MCP Servers/);
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

for (const locale of ['en', 'zh-CN', 'ja']) {
  test(`${locale} console, remote service and transfer guides preserve distinct plugin paths`, t => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-plugin-entrypoints-'));
    t.after(() => fs.rmSync(output, {recursive: true, force: true}));
    buildHelp(output);
    const pathLabel = keys => keys.map(key => translate(locale, key)).join(' → ');
    const expected = {
      'console-tour': [pathLabel(['插件']), pathLabel(['添加插件']), pathLabel(['管理'])],
      'remote-services': [pathLabel(['插件', '添加插件', '接入 MCP 服务'])],
      'local-services': [],
      'import-export': [pathLabel(['插件', '添加插件', '导入配置']), pathLabel(['插件', '插件设置', '导出配置'])],
    };
    const search = JSON.parse(fs.readFileSync(path.join(output, 'docs', locale, 'search.json'), 'utf8'));
    for (const [slug, labels] of Object.entries(expected)) {
      const source = fs.readFileSync(path.join(root, 'docs', locale, slug + '.md'), 'utf8');
      const html = fs.readFileSync(path.join(output, 'docs', locale, slug, 'index.html'), 'utf8');
      const indexed = search.articles.find(article => article.slug === slug).text;
      for (const label of labels) {
        assert.ok(source.includes(`**${label}**`), `${slug}: missing exact navigation ${label}`);
        assert.ok(html.includes(label), `${slug}: rendered navigation missing`);
        assert.ok(indexed.includes(label), `${slug}: indexed navigation missing`);
      }
      assert.doesNotMatch(source, /MCP Servers|0\.6\.0/);
      assert.ok(source.includes('https://github.com/DJ-Huang/ChatToHarness/releases/tag/v0.8.1'));
      const caption = {en: 'Earlier interface demonstration', 'zh-CN': '历史界面演示', ja: '以前の画面例'};
      assert.ok(source.includes(caption[locale]), `${slug}: retained screenshot must be labelled historical`);
    }
  });
}
