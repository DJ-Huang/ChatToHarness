'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {buildHelp, readArticle} = require('../scripts/help-site.cjs');
const root = path.resolve(__dirname, '..');
const release = 'https://github.com/DJ-Huang/ChatToHarness/releases/tag/v0.8.1';
const installers = ['ChatToHarness-0.8.1-macos-arm64.dmg', 'ChatToHarness-0.8.1-windows-x64-setup.exe'];
const examples = {
  sh: 'shasum -a 256 "$HOME/Downloads/' + installers[0] + '"\ncat "$HOME/Downloads/SHA256SUMS.txt"',
  powershell: '(Get-FileHash -Algorithm SHA256 -LiteralPath "$HOME\\Downloads\\' + installers[1] + '").Hash\nGet-Content -LiteralPath "$HOME\\Downloads\\SHA256SUMS.txt"',
};
const boundaries = {
  en: ['same release', '64-character', 'do not open the installer', 'does not replace code signing'],
  'zh-CN': ['同一 Release', '64 个字符', '不要打开安装包', '不能代替代码签名'],
  ja: ['同じリリース', '64 桁', 'インストーラーを開かず', 'コード署名の代わりには'],
};

for (const [locale, phrases] of Object.entries(boundaries)) {
  test(locale + ' installation explains read-only checksum verification and its limits', () => {
    const source = fs.readFileSync(path.join(root, 'docs', locale, 'installation.md'), 'utf8');
    assert.ok(source.includes(release));
    for (const [language, command] of Object.entries(examples)) {
      assert.ok(source.includes('```' + language + '\n' + command + '\n```'));
    }
    for (const phrase of phrases) assert.ok(source.includes(phrase), locale + ': ' + phrase);
    assert.ok(source.includes('0.8.1'));
    assert.ok(!source.includes('0.6.0'));
    assert.doesNotMatch(source, /(?:xattr|spctl|Set-ExecutionPolicy|Unblock-File)/);
  });
}

test('installation checksum instructions survive help rendering and search indexing', t => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-install-checksum-site-'));
  t.after(() => fs.rmSync(output, {recursive: true, force: true}));
  buildHelp(output);
  for (const [locale, phrases] of Object.entries(boundaries)) {
    const article = readArticle(locale, 'installation');
    const html = fs.readFileSync(path.join(output, 'docs', locale, 'installation/index.html'), 'utf8');
    const index = JSON.parse(fs.readFileSync(path.join(output, 'docs', locale, 'search.json'), 'utf8'));
    const indexed = index.articles.find(item => item.slug === 'installation');
    for (const phrase of [...installers, ...phrases, 'shasum -a 256', 'Get-FileHash']) {
      assert.ok(html.includes(phrase), locale + ' HTML: ' + phrase);
      assert.ok(indexed.text.includes(phrase), locale + ' index: ' + phrase);
    }
    for (const id of ['goal', 'before', 'steps', 'result', 'troubleshooting', 'next']) {
      assert.ok(article.toc.some(section => section.id === id));
    }
  }
});

test('documented platform checksum commands read a spaced-path fixture and expose changed bytes', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cth checksum commands '));
  t.after(() => fs.rmSync(home, {recursive: true, force: true}));
  const downloads = path.join(home, 'Downloads');
  fs.mkdirSync(downloads);
  const payload = Buffer.from('Inert checksum fixture, not an installer.\n');
  const expected = crypto.createHash('sha256').update(payload).digest('hex');
  for (const name of installers) fs.writeFileSync(path.join(downloads, name), payload);
  fs.writeFileSync(path.join(downloads, 'SHA256SUMS.txt'), installers.map(name => expected + '  ' + name + '\n').join(''));
  const language = process.platform === 'win32' ? 'powershell' : 'sh';
  const source = fs.readFileSync(path.join(root, 'docs/en/installation.md'), 'utf8');
  const command = source.match(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```'))?.[1];
  assert.equal(command, examples[language]);
  const run = () => process.platform === 'win32'
    ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command.replaceAll('$HOME', '$env:CTH_CHECKSUM_TEST_HOME')], {encoding: 'utf8', env: {...process.env, CTH_CHECKSUM_TEST_HOME: home}})
    : execFileSync('sh', ['-c', command], {encoding: 'utf8', env: {...process.env, HOME: home}});
  const firstHash = result => result.match(/[0-9a-f]{64}/i)?.[0].toLowerCase();
  assert.equal(firstHash(run()), expected);
  for (const name of installers) fs.appendFileSync(path.join(downloads, name), 'Changed bytes');
  assert.notEqual(firstHash(run()), expected);
  assert.equal(fs.readFileSync(path.join(downloads, 'SHA256SUMS.txt'), 'utf8').split('\n')[0], expected + '  ' + installers[0]);
});
