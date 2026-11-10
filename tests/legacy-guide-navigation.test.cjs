'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {translate} = require('../app/i18n.js');
for (const locale of ['en', 'zh-CN', 'ja']) {
  test(`${locale} comprehensive guide preserves its anchor but uses released plugin navigation`, () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'docs', locale, 'GUIDE.md'), 'utf8');
    assert.ok(source.includes('## MCP Servers\n'), 'preserve existing section links');
    assert.doesNotMatch(source, /\*\*MCP Servers\*\*/);
    for (const keys of [['插件'], ['管理'], ['连接配置'], ['概览与权限'], ['插件', '添加插件', '接入 MCP 服务'], ['插件', '添加插件', '导入配置'], ['插件', '插件设置', '导出配置']]) {
      assert.ok(source.includes(`**${keys.map(key => translate(locale, key)).join(' → ')}**`), `missing navigation: ${keys}`);
    }
    for (const file of ['manage-services.md', 'import-export.md']) {
      assert.ok(source.includes(`](${file})`));
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs', locale, file)));
    }
    assert.ok(source.includes('https://github.com/DJ-Huang/ChatToHarness/releases/tag/v0.8.1'));
  });
}
