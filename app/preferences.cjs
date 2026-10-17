'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { languages, normalize } = require('./i18n.js');
// A separate, non-secret preference file avoids keychain access and connection
// changes when switching language, including before directories are configured.
class Preferences {
  constructor(directory, systemLanguage) {
    this.file = path.join(directory, 'preferences.json');
    this.locale = normalize(systemLanguage);
    try {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return;
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (languages.includes(saved.locale)) this.locale = saved.locale;
    } catch { /* A missing or unreadable UI preference never blocks credentials. */ }
  }
  setLocale(locale) {
    if (!languages.includes(locale)) throw new Error('语言设置无效。');
    const temporary = path.join(path.dirname(this.file), `.preferences-${crypto.randomBytes(12).toString('hex')}.tmp`);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, JSON.stringify({ locale }) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
      this.locale = locale;
    } catch { throw new Error('语言设置无法保存，请重试。'); }
    finally { try { fs.unlinkSync(temporary); } catch {} }
    return this.locale;
  }
}
module.exports = { Preferences };
