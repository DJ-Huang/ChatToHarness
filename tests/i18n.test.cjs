'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Preferences } = require('../app/preferences.cjs');
const { normalize, translate } = require('../app/i18n.js');
const messages = require('../app/locales.js');
test('language preference persists independently and never modifies saved credentials', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-language-'));
  t.after(() => fs.rmSync(directory, {recursive:true,force:true}));
  const file = path.join(directory, 'settings.json');
  const encrypted = '{"encryptedKey":"opaque-existing-data"}';
  fs.writeFileSync(file, encrypted);
  const preferences = new Preferences(directory, 'ja-JP');
  assert.equal(preferences.locale, 'ja');
  preferences.setLocale('en');
  assert.equal(new Preferences(directory, 'zh-CN').locale, 'en');
  assert.throws(() => preferences.setLocale('../invalid'));
  assert.equal(fs.readFileSync(file,'utf8'), encrypted);
  fs.writeFileSync(path.join(directory,'preferences.json'),'invalid');
  assert.equal(new Preferences(directory, 'zh-TW').locale, 'zh-CN');
});
test('catalog covers source UI messages, placeholders and locale fallbacks', () => {
  assert.equal(normalize('en-US'),'en');assert.equal(normalize('fr-FR'),'en');
  assert.equal(translate('en','移除目录 {directory}',{directory:'/项目/English'}),'Remove directory /项目/English');
  assert.equal(translate('ja','通道就绪'),'トンネル準備完了');
  for (const [key, translations] of Object.entries(messages)) for (const value of translations) {
    assert.ok(value.trim(), key);
    assert.deepEqual([...value.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(),[...key.matchAll(/\{\w+\}/g)].map(m=>m[0]).sort(),key);
  }
  // Catch newly introduced source messages without English/Japanese entries.
  for (const file of ['renderer.js','main.cjs','settings.cjs','runtime.cjs','platform.cjs','preload.cjs','updater.cjs','preferences.cjs','mcp-settings.cjs','mcp-manager.cjs','mcp-gateway.cjs','mcp-transport.cjs']) {
    const source=fs.readFileSync(path.join(__dirname,'../app',file),'utf8');
    for(const match of source.matchAll(/'(?:\\.|[^'\\\n])*'/g)) {
      const key=match[0].slice(1,-1);
      if(!/[\u3400-\u9fff]/u.test(key))continue;
      assert.ok(Object.hasOwn(messages,key),`${file}: missing ${key}`);
    }
  }
});
