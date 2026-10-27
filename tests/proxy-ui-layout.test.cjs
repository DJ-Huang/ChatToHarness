'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app/style.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'app/renderer.js'), 'utf8');
const locales = require('../app/locales.js');

test('manual proxy settings use two aligned inline rows', () => {
  const start = html.indexOf('<div id="proxy-manual-fields"');
  const end = html.indexOf('<div class="proxy-bypass-options">', start);
  assert.ok(start >= 0 && end > start, 'manual proxy section exists');
  const manual = html.slice(start, end);
  assert.match(manual, /class="proxy-manual-row proxy-connection-row"/);
  assert.match(manual, /class="proxy-manual-row proxy-credentials-row"/);
  for (const id of ['proxy-type', 'proxy-host', 'proxy-port', 'proxy-username', 'proxy-password']) assert.match(manual, new RegExp('id="' + id + '"'));
  for (const label of ['类型：', '服务器地址：', '端口：', '用户名（选填）：', '密码：']) assert.ok(manual.includes(label), 'missing inline label: ' + label);
  assert.match(manual, /id="proxy-show-password" class="password-toggle" type="button"/);
  assert.doesNotMatch(manual, /proxy-remember-password|proxy-clear-password|proxy-auth-options|proxy-password-status|记住密码|清除密码|自动记住/);
});

test('password visibility is an accessible icon button and password is remembered automatically', () => {
  assert.match(renderer, /rememberPassword:true/);
  assert.match(renderer, /proxy-show-password'\)\.addEventListener\('click'/);
  assert.match(renderer, /setAttribute\('aria-pressed',String\(show\)\)/);
  assert.match(renderer, /proxyPasswordInput\.type=show\?'text':'password'/);
  assert.doesNotMatch(renderer, /proxy-remember-password|proxy-clear-password|proxy-password-status/);
});

test('compact rows have balanced desktop columns and a narrow-screen fallback', () => {
  assert.match(css, /\.proxy-connection-row\s*\{[^}]*grid-template-columns:\s*minmax\(200px,\s*\.8fr\)\s+minmax\(300px,\s*1\.1fr\)\s+minmax\(155px,\s*\.6fr\)/s);
  assert.match(css, /\.proxy-credentials-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)/);
});

test('new inline labels and password button states have English and Japanese translations', () => {
  for (const key of ['类型：', '服务器地址：', '端口：', '用户名（选填）：', '密码：', '隐藏密码']) { assert.ok(Array.isArray(locales[key]), 'missing locale entry: ' + key); assert.equal(locales[key].length, 2); }
});
