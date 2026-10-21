'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { languages, normalize } = require('./i18n.js');
// A separate, non-secret preference file avoids keychain access and connection
// changes when switching language or update checks, even before setup.
class Preferences {
  constructor(directory, systemLanguage) {
    this.file = path.join(directory, 'preferences.json');
    this.locale = normalize(systemLanguage);
    this.autoCheckUpdates = true;
    this.computerUseEnabled = false;
    try {
      const stat = fs.lstatSync(this.file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return;
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (languages.includes(saved.locale)) this.locale = saved.locale;
      if (typeof saved.autoCheckUpdates === 'boolean') this.autoCheckUpdates = saved.autoCheckUpdates;
      if (typeof saved.computerUseEnabled === 'boolean') this.computerUseEnabled = saved.computerUseEnabled;
    } catch { /* A missing or unreadable UI preference never blocks credentials. */ }
  }
  setLocale(locale) {
    if (!languages.includes(locale)) throw new Error('语言设置无效。');
    this.save({ locale });
    return this.locale;
  }
  setAutoCheckUpdates(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('自动检查更新设置无效。');
    this.save({ autoCheckUpdates: enabled });
    return this.autoCheckUpdates;
  }
  setComputerUseEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Computer Use requires a boolean setting.');
    this.save({computerUseEnabled: enabled});
    return this.computerUseEnabled;
  }
  save(changes) {
    const next = { locale: this.locale, autoCheckUpdates: this.autoCheckUpdates, computerUseEnabled: this.computerUseEnabled, ...changes };
    const temporary = path.join(path.dirname(this.file), `.preferences-${crypto.randomBytes(12).toString('hex')}.tmp`);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporary, JSON.stringify(next) + '\n', { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, this.file);
      Object.assign(this, next);
    } catch { throw new Error('偏好设置无法保存，请重试。'); }
    finally { try { fs.unlinkSync(temporary); } catch {} }
  }
}
module.exports = { Preferences };
