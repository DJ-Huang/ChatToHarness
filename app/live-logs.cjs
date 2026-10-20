'use strict';

// A read-only, bounded tail of the two application JSONL files. The API never
// accepts a path from the renderer, and never reads task content or credentials.
const fs = require('node:fs');
const path = require('node:path');
const {safeFields, sanitize} = require('./diagnostic-budget.cjs');
const {recoveryKind} = require('./tool-recovery.cjs');

const MAX_BYTES = 128 * 1024;
const MAX_LINES = 200;
const SOURCES = ['app.log.previous', 'app.log'];

function openLog(home, name) {
  let fd;
  try {
    const directory = path.join(home, 'logs');
    const folder = fs.lstatSync(directory);
    if (!folder.isDirectory() || folder.isSymbolicLink()) return null;
    fd = fs.openSync(path.join(directory, name), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1) { fs.closeSync(fd); return null; }
    return {fd, size: stat.size, identity: [stat.dev, stat.ino, stat.birthtimeMs].join(':'), name};
  } catch {
    if (fd !== undefined) try { fs.closeSync(fd); } catch {}
    return null;
  }
}
function format(line, source, offset) {
  let data;
  try { data = JSON.parse(line); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const safe = safeFields(data);
  // Older releases serialized absent execution metadata as [omitted]. This is
  // not an error code or state, and must not obscure the real transition.
  if (safe.event === 'execution') for (const key of ['state', 'phase', 'error_code', 'errorCode', 'code', 'error', 'delivery', 'execution_state', 'recovery_kind']) {
    if (safe[key] === '[omitted]') delete safe[key];
  }
  const event = sanitize(safe.event || 'event', 120);
  const state = String(safe.state || safe.phase || '');
  const code = String(safe.error_code || safe.errorCode || safe.code || safe.error || '');
  const recovery = event === 'execution' ? recoveryKind(safe) : undefined;
  const active = ['received', 'waiting_approval', 'submitted', 'running', 'cancelling'].includes(state);
  const delivery = safe.delivery === 'unknown' && active ? '' : safe.delivery;
  const severity = recovery ? 'info' : /(?:fail|error|timeout|denied|disconnect|interrupted|unknown)/i.test([event, state, code, delivery].join(' ')) ? 'error' : 'info';
  const category = event === 'execution' || /^mcp-(?:call|tool|catalog|session|list)/.test(event) ? 'tool'
    : /(?:connection|connect|runtime|tunnel|gateway|start|stop)/i.test(event) ? 'connection' : 'system';
  const extra = {...safe};
  delete extra.time; delete extra.event;
  let message;
  if (event === 'execution') {
    message = [extra.service, extra.tool, extra.state].filter(Boolean).join(' · ');
    if (extra.error_code) message += ' · ' + extra.error_code;
    if (extra.delivery && extra.delivery !== 'unknown') message += ' · ' + extra.delivery;
  } else {
    const detail = Object.keys(extra).length ? sanitize(JSON.stringify(extra), 900) : '';
    message = detail ? event + ' · ' + detail : event;
  }
  return {
    id: source.identity + ':' + offset,
    at: typeof safe.time === 'string' ? sanitize(safe.time, 40) : '',
    event, category, severity,
    message: sanitize(message, 1100),
    ...(event === 'execution' ? {request_id: safe.request_id, service: safe.service, tool: safe.tool,
      state, error_code: code, delivery: safe.delivery, recovery_kind: recovery} : {}),
  };
}
function take(source, offset, {tail = false, limit = MAX_LINES} = {}) {
  const from = tail ? Math.max(0, source.size - MAX_BYTES) : Math.max(0, Math.min(offset, source.size));
  const length = Math.min(MAX_BYTES, source.size - from);
  if (!length) return {entries: [], offset: from, more: false};
  const bytes = Buffer.alloc(length);
  const count = fs.readSync(source.fd, bytes, 0, length, from);
  let start = 0;
  // A tail that starts inside an old line must skip that incomplete line.
  if (tail && from > 0) {
    const newline = bytes.indexOf(10);
    if (newline < 0) return {entries: [], offset: from + count, more: from + count < source.size};
    start = newline + 1;
  }
  const entries = [];
  let consumed = start;
  for (let end = bytes.indexOf(10, start); end >= 0; end = bytes.indexOf(10, start)) {
    if (end - start <= 16 * 1024) {
      const entry = format(bytes.subarray(start, end).toString('utf8'), source, from + end + 1);
      if (entry) entries.push(entry);
    }
    consumed = end + 1;
    start = consumed;
    if (!tail && entries.length >= limit) break;
  }
  // Do not loop forever on a malformed/oversize line with no newline.
  if (consumed === 0 && count === MAX_BYTES) consumed = count;
  return {entries, offset: from + consumed, more: from + consumed < source.size};
}

class LiveLogs {
  constructor(home) { this.home = home; }
  read(input = {}) {
    const limit = Math.max(1, Math.min(MAX_LINES, Number.isInteger(input?.limit) ? input.limit : 120));
    const files = new Map(SOURCES.map(name => [name, openLog(this.home, name)]));
    try {
      const current = files.get('app.log');
      const previous = files.get('app.log.previous');
      const cursor = input && typeof input.cursor === 'object' && input.cursor;
      const valid = cursor && SOURCES.includes(cursor.file) && typeof cursor.identity === 'string'
        && cursor.identity.length < 120 && Number.isSafeInteger(cursor.offset) && cursor.offset >= 0;
      const matching = valid && [current, previous].find(file => file && file.identity === cursor.identity && cursor.offset <= file.size);
      let entries = [], next = null, reset = Boolean(cursor && !matching), more = false;
      if (!matching) {
        // Initial view: show only the latest complete lines, bounded even when
        // a previous release left a very large old log file.
        if (previous) entries.push(...take(previous, 0, {tail: true}).entries);
        if (current) entries.push(...take(current, 0, {tail: true}).entries);
        const latest = current || previous;
        if (latest) {
          const data = take(latest, 0, {tail: true});
          next = {file: latest.name, identity: latest.identity, offset: data.offset};
          more = data.more;
        }
      } else if (matching.name === 'app.log') {
        const data = take(matching, cursor.offset, {limit});
        entries = data.entries;
        next = {file: matching.name, identity: matching.identity, offset: data.offset};
        more = data.more;
      } else {
        const remaining = take(matching, cursor.offset, {limit});
        entries = remaining.entries;
        next = {file: matching.name, identity: matching.identity, offset: remaining.offset};
        more = remaining.more;
        if (!more && current && entries.length >= limit) more = true;
        if (!more && current && entries.length < limit) {
          const currentData = take(current, 0, {limit: limit - entries.length});
          entries.push(...currentData.entries);
          next = {file: current.name, identity: current.identity, offset: currentData.offset};
          more = currentData.more;
        }
      }
      return {entries: matching ? entries : entries.slice(-limit), cursor: next, reset, more};
    } finally {
      for (const item of files.values()) if (item) fs.closeSync(item.fd);
    }
  }
}
module.exports = {LiveLogs, MAX_BYTES, MAX_LINES};
