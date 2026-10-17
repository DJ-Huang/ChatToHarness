'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {inside} = require('./project-context.cjs');

const MAX_OUTPUT = 512 * 1024;
const PAGE_BYTES = 48 * 1024;
const fail = (code, message, details = {}) => Object.assign(new Error(message), {code, details});
function integer(value, fallback, max) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw fail('INVALID_ARGUMENT', `Choose an integer from 1 to ${max}.`);
  return value;
}
function gitEnvironment(source = process.env) {
  return {...Object.fromEntries(Object.entries(source).filter(([key]) => !/^GIT_/i.test(key))), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C'};
}
// Fixed argv only. No aliases, hooks, external diff drivers, text converters,
// fsmonitor or shell interpolation are needed for these read-only operations.
function gitRead(root, args, {signal, maxBytes = MAX_OUTPUT} = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn('git', ['--no-pager', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', '-C', root, ...args],
      {env: gitEnvironment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    const chunks = []; let bytes = 0, stderr = '', limited = false, timedOut = false;
    const stop = () => child.kill();
    const timer = setTimeout(() => { timedOut = true; stop(); }, 10000);
    signal?.addEventListener('abort', stop, {once: true});
    child.stdout.on('data', chunk => { const room = maxBytes - bytes; if (room > 0) { chunks.push(chunk.subarray(0, room)); bytes += Math.min(room, chunk.length); } if (chunk.length > room) { limited = true; stop(); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(0, 4096); });
    child.once('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', stop); reject(fail('GIT_UNAVAILABLE', 'Git could not start. Install Git or check the application PATH.', {cause: error.code})); });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', stop);
      if (signal?.aborted) return reject(signal.reason);
      if (timedOut) return reject(fail('GIT_TIMEOUT', 'Git exceeded 10 seconds. Narrow the requested paths.'));
      if (code !== 0 && !limited) return reject(fail('GIT_READ_FAILED', 'Git could not read this project. Check that it is a repository and accessible.', {detail: stderr}));
      resolve({text: Buffer.concat(chunks).toString('utf8'), truncated: limited});
    });
  });
}
class ProjectInspector {
  constructor(contexts) { this.contexts = contexts; this.pages = new Map(); }
  async root(input) {
    if (typeof input.project_path !== 'string') throw fail('PROJECT_PATH_REQUIRED', 'Pass the absolute project directory.');
    const root = await this.contexts.resolveProject(input.project_path);
    if (!(await fs.stat(root)).isDirectory()) throw fail('PROJECT_PATH_REQUIRED', 'Choose an existing project directory.');
    return root;
  }
  async repository(root, signal) {
    const result = await gitRead(root, ['rev-parse', '--show-toplevel'], {signal, maxBytes: 32768});
    const repository = await this.contexts.authorize(result.text.trim(), true);
    if (!inside(repository, root)) throw fail('GIT_ROOT_MISMATCH', 'Git resolved an unexpected repository root.');
    return repository;
  }
  page(kind, root, rows, metadata, input) {
    const limit = integer(input.limit, 60, 200);
    let key, record, offset = 0;
    if (input.cursor) {
      const match = /^([a-f0-9]{32}):(\d+)$/.exec(input.cursor);
      record = match && this.pages.get(match[1]); offset = Number(match?.[2]); key = match?.[1];
      if (!record || record.kind !== kind || record.root !== root || record.expires < Date.now() || !Number.isSafeInteger(offset) || offset >= record.rows.length)
        throw fail('CURSOR_EXPIRED', 'The saved page expired. Repeat the original read to create a fresh snapshot.');
    } else {
      key = crypto.randomBytes(16).toString('hex'); record = {kind, root, rows, metadata, expires: Date.now() + 300000};
      this.pages.set(key, record); while (this.pages.size > 32) this.pages.delete(this.pages.keys().next().value);
    }
    const items = []; let bytes = 0;
    while (offset < record.rows.length && items.length < limit) {
      const row = record.rows[offset], size = Buffer.byteLength(JSON.stringify(row));
      if (items.length && bytes + size > PAGE_BYTES) break;
      items.push(row); bytes += size; offset++;
    }
    const more = offset < record.rows.length;
    return {...record.metadata, items, returned: items.length, has_more: more, ...(more ? {next_cursor: `${key}:${offset}`} : {})};
  }
  async git(kind, input, {signal} = {}) {
    const root = await this.root(input);
    if (input.cursor) return this.page(kind, root, null, null, input);
    const repository = await this.repository(root, signal);
    const requested = input.paths ?? [];
    if (!Array.isArray(requested) || requested.length > 64 || requested.some(item => typeof item !== 'string' || !item || item.includes('\0')))
      throw fail('INVALID_ARGUMENT', 'paths must contain at most 64 project-relative filenames.');
    const selected = [];
    for (const item of requested) {
      const file = await this.contexts.authorize(path.resolve(root, item));
      if (!inside(root, file)) throw fail('TARGET_OUTSIDE_PROJECT', 'A Git path is outside the selected project.');
      selected.push(`:(literal)${path.relative(root, file).split(path.sep).join('/')}`);
    }
    let result, rows, metadata;
    if (kind === 'status') {
      result = await gitRead(root, ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=normal', '--', ...(selected.length ? selected : ['.'])], {signal});
      const parts = result.text.split('\0'); const branch = parts[0]?.startsWith('## ') ? parts.shift().slice(3) : null; rows = [];
      for (let i = 0; i < parts.length; i++) if (parts[i]) {
        const value = parts[i]; if (value.length < 3) continue;
        rows.push({index: value[0], worktree: value[1], path: value.slice(3), ...(/[RC]/.test(value.slice(0, 2)) ? {original_path: parts[++i]} : {})});
      }
      metadata = {branch, clean: !result.truncated && rows.length === 0, summary: result.truncated ? 'Git status reached its output limit.' : `${rows.length} changed entries.`};
    } else if (kind === 'diff') {
      if (input.staged !== undefined && typeof input.staged !== 'boolean') throw fail('INVALID_ARGUMENT', 'staged must be a boolean.');
      result = await gitRead(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', ...(input.staged ? ['--cached'] : []), '--', ...(selected.length ? selected : ['.'])], {signal});
      rows = result.text.split('\n').map((text, i) => ({line: i + 1, text: text.slice(0, 8192), ...(text.length > 8192 ? {truncated: true} : {})}));
      metadata = {staged: Boolean(input.staged), summary: result.text ? 'Diff snapshot; line numbers refer to this diff output.' : 'No diff in the selected scope.'};
    } else if (kind === 'log') {
      result = await gitRead(root, ['log', '-100', '--no-show-signature', '--format=%H%x00%P%x00%an%x00%aI%x00%s%x00', '--', ...(selected.length ? selected : ['.'])], {signal});
      const fields = result.text.split('\0'); rows = [];
      for (let i = 0; i + 4 < fields.length; i += 5) rows.push({commit: fields[i].trim(), parents: fields[i + 1].split(' ').filter(Boolean), author: fields[i + 2], date: fields[i + 3], subject: fields[i + 4].slice(0, 8192)});
      metadata = {summary: `Up to 100 recent commits in the selected scope.`, history_limit: 100};
    } else throw fail('INVALID_ARGUMENT', 'Unsupported Git read.');
    return this.page(kind, root, rows, {project_path: root, git_root: repository, complete: !result.truncated, reason: result.truncated ? 'output_limit' : 'complete', ...metadata}, input);
  }
  async overview(input, {signal} = {}) {
    const root = await this.root(input), depth = integer(input.depth, 2, 3), entries = [], diagnostics = [];
    const ignored = new Set(['.git', '.cache', 'node_modules', 'Library', 'Temp', 'obj', 'bin']);
    let truncated = false;
    const walk = async (directory, level) => {
      signal?.throwIfAborted();
      const children = []; for await (const item of await fs.opendir(directory)) { if (children.length >= 200) { truncated = true; break; } children.push(item); }
      for (const item of children.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entries.length >= 200) { truncated = true; break; }
        if (ignored.has(item.name)) continue;
        const file = path.join(directory, item.name);
        entries.push({path: path.relative(root, file), type: item.isSymbolicLink() ? 'symlink' : item.isDirectory() ? 'directory' : 'file'});
        if (item.isDirectory() && level < depth) try { await walk(file, level + 1); } catch (error) { diagnostics.push({path: file, code: error.code || 'READ_FAILED'}); }
      }
    };
    await walk(root, 1);
    let git;
    try { git = await this.git('status', {project_path: root, limit: 30}, {signal}); } catch (error) { diagnostics.push({code: error.code, message: error.message}); }
    const guidance = await this.contexts.getContext({project_path: root, target_paths: input.target_paths, task: input.task}, {signal});
    return {summary: `${path.basename(root)}: ${entries.length} visible entries${truncated ? ' (bounded)' : ''}${git ? `; ${git.summary}` : ''}`,
      project_path: root, entries, truncated, excluded_directories: [...ignored], git, guidance, diagnostics};
  }
  dispose() { this.pages.clear(); }
}
module.exports = {ProjectInspector, gitRead, gitEnvironment, integer, fail};
