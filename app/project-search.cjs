'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { inside, ContextError } = require('./project-context.cjs');
const MAX_MATCHES = 1000, MAX_BYTES = 2 * 1024 * 1024, PAGE_BYTES = 64 * 1024, MAX_LINE = 1024 * 1024;
const CURSOR_TTL = 5 * 60 * 1000;
const SEARCH_TOOL = {
  name: 'search_project', title: 'Search project files and text',
  description: 'Search local project text with ripgrep. Returns matching paths, 1-based lines and nearby context in one bounded call. Default queries are literal. File mode accepts filename globs. Use next_cursor for stored pages, or narrow the query after a timeout or limit. No project context token is required.',
  inputSchema: { type: 'object', properties: {
    project_path: { type: 'string', description: 'Absolute task project directory, within authorized folders.' },
    pattern: { type: 'string', description: 'Text query, or a filename/glob in files mode. Required for a new search.' },
    search_type: { type: 'string', enum: ['content', 'files'], default: 'content' }, regex: { type: 'boolean', default: false, description: 'Use a ripgrep regular expression for content searches.' },
    include_globs: { type: 'array', items: { type: 'string' }, maxItems: 32 }, exclude_globs: { type: 'array', items: { type: 'string' }, maxItems: 32 },
    include_hidden: { type: 'boolean', default: false }, ignore_case: { type: 'boolean', default: false }, context_lines: { type: 'integer', minimum: 0, maximum: 10, default: 2 },
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 }, timeout_ms: { type: 'integer', minimum: 1, maximum: 10000, default: 2000 },
    cursor: { type: 'string', description: 'Opaque next_cursor; use the same project_path and omit pattern to read the saved search.' },
    project_context_tokens: { type: 'array', items: { type: 'string' }, maxItems: 128, description: 'Optional tokens from previous guidance delivery to reuse unchanged bodies.' },
  }, required: ['project_path'], additionalProperties: false },
  outputSchema: { type: 'object', properties: {
    project_path: { type: 'string' }, results: { type: 'array', items: { type: 'object', properties: {
      path: { type: 'string' }, relative_path: { type: 'string' }, line: { type: 'integer' }, text: { type: 'string' },
      context: { type: 'array', items: { type: 'object', properties: { line: { type: 'integer' }, text: { type: 'string' }, match: { type: 'boolean' } }, required: ['line', 'text', 'match'] } },
      truncated: { type: 'boolean' },
    }, required: ['path', 'relative_path'] } },
    complete: { type: 'boolean' }, reason: { type: 'string' }, truncated: { type: 'boolean' }, has_more: { type: 'boolean' }, next_cursor: { type: 'string' },
    searched_at: { type: 'string' }, diagnostics: { type: 'array', items: { type: 'object' } }, project_contexts: { type: 'array', items: { type: 'object' } },
  }, required: ['project_path', 'results', 'complete', 'reason', 'truncated', 'has_more', 'searched_at', 'diagnostics'] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
function error(code, message, details = {}) { return new ContextError(code, message, details); }
function integer(value, fallback, min, max, field) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw error('INVALID_SEARCH_ARGUMENTS', `${field} must be ${min}–${max}.`);
  return value;
}
function globs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32 || value.some(item => typeof item !== 'string' || !item || item.length > 1024 || item.includes('\0'))) throw error('INVALID_SEARCH_ARGUMENTS', 'Globs must be up to 32 nonempty strings.');
  if (value.reduce((sum,item) => sum + item.length, 0) > 8192) throw error('INVALID_SEARCH_ARGUMENTS', 'Combined globs exceed the 8192-character budget.');
  return value;
}
function options(args) {
  if (typeof args.pattern !== 'string' || !args.pattern || args.pattern.length > 4096 || args.pattern.includes('\0')) throw error('INVALID_SEARCH_ARGUMENTS', 'Provide a nonempty pattern of up to 4096 characters.');
  const type = args.search_type || 'content';
  if (!['files', 'content'].includes(type) || ['regex','include_hidden','ignore_case'].some(key=>args[key]!==undefined&&typeof args[key]!=='boolean')) throw error('INVALID_SEARCH_ARGUMENTS', 'Invalid search mode or boolean option.');
  if (type === 'files' && args.regex) throw error('INVALID_SEARCH_ARGUMENTS', 'File searches use globs; regex is for content searches.');
  return { pattern: args.pattern, type, regex: args.regex === true, hidden: args.include_hidden === true, ignoreCase: args.ignore_case===true, includes: globs(args.include_globs), excludes: globs(args.exclude_globs),
    context: integer(args.context_lines, 2, 0, 10, 'context_lines'), timeout: integer(args.timeout_ms, 2000, 1, 10000, 'timeout_ms') };
}
function argumentsFor(query) {
  const args = ['--no-config', '--color=never', '--threads=2'];
  if (query.type === 'content') {
    args.push('--json', '--line-number', '-m', String(MAX_MATCHES), '-C', String(query.context));
    if (!query.regex) args.push('-F');
    if(query.ignoreCase)args.push('-i');
  } else {
    args.push('--files', '--null');
  }
  if (query.hidden) args.push('--hidden');
  for (const glob of query.includes) args.push('-g', glob);
  for (const glob of query.excludes) args.push('-g', `!${glob.replace(/^!/, '')}`);
  if (query.type === 'content') args.push('--', query.pattern, '.'); else args.push('--', '.');
  return args;
}
function resolveRipgrep(entry) {
  const platform = `@vscode/ripgrep-${process.platform}-${process.arch}`;
  const binary = process.platform === 'win32' ? 'rg.exe' : 'rg';
  // Match the platform-specific binary checked by prepare-resources.cjs.
  const candidate = path.resolve(path.dirname(entry), '../../../', platform, 'bin', binary);
  if (fs.existsSync(candidate)) return candidate;
  try { const resolved = require(require.resolve('@vscode/ripgrep', { paths: [path.dirname(entry)] })).rgPath; if (fs.existsSync(resolved)) return resolved; } catch {}
  throw error('SEARCH_UNAVAILABLE', 'The bundled ripgrep binary is missing; repair the application components.');
}

class ProjectSearch {
  constructor({ contexts, binary, spawnProcess = spawn, now = Date.now }) {
    Object.assign(this, { contexts, binary, spawnProcess, now }); this.active = new Set(); this.snapshots = new Map(); this.closed = false;
  }
  prune() {
    for (const [id, snapshot] of this.snapshots) if (this.now() - snapshot.touched >= CURSOR_TTL) this.snapshots.delete(id);
    let bytes = [...this.snapshots.values()].reduce((sum, item) => sum + item.bytes, 0);
    while (this.snapshots.size > 32 || bytes > 16 * 1024 * 1024) { const id = this.snapshots.keys().next().value; bytes -= this.snapshots.get(id).bytes; this.snapshots.delete(id); }
  }
  async search(args, { signal } = {}) {
    signal?.throwIfAborted();
    if (this.closed) throw error('SEARCH_UNAVAILABLE', 'The search service stopped; reconnect and start a new search.');
    const root = await this.contexts.resolveProject(args.project_path), limit = integer(args.limit, 100, 1, 200, 'limit'); this.prune();
    if (args.cursor !== undefined) {
      const match = /^([A-Za-z0-9_-]{32})\.(\d+)$/.exec(args.cursor), snapshot = match && this.snapshots.get(match[1]);
      if (!snapshot) throw error('SEARCH_CURSOR_EXPIRED', 'This search snapshot expired; start a new search.');
      if (snapshot.root !== root || (args.pattern !== undefined && JSON.stringify(options(args)) !== snapshot.query)) throw error('SEARCH_CURSOR_MISMATCH', 'Use the original project and query for this cursor.');
      const offset = Number(match[2]);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= snapshot.results.length) throw error('INVALID_SEARCH_CURSOR', 'Invalid search cursor.');
      snapshot.touched = this.now(); return this.page(match[1], snapshot, offset, limit);
    }
    const query = options(args);
    if (this.active.size >= 4) throw error('SEARCH_BUSY', 'Four searches are already running; retry shortly.', { retry_after_ms: 250 });
    const task = { child: null, stop: null }; this.active.add(task);
    try {
      const snapshot = await this.run(root, query, task, signal);
      const id = crypto.randomBytes(24).toString('base64url');
      snapshot.query = JSON.stringify(query); snapshot.touched = this.now(); this.snapshots.set(id, snapshot); this.prune();
      return this.page(id, snapshot, 0, limit);
    } finally { this.active.delete(task); }
  }
  page(id, snapshot, offset, limit) {
    const results = []; let bytes = 0, index = offset;
    const page = { project_path: snapshot.root, results, complete: snapshot.complete, reason: snapshot.reason, truncated: snapshot.truncated,
      has_more: false, searched_at: snapshot.searched_at, diagnostics: [...snapshot.diagnostics] };
    // Account for UTF-8 paths and diagnostics as well as snippets. Reserve the
    // bounded cursor before adding each row so even unusual paths fit the wire budget.
    const overhead = () => Buffer.byteLength(JSON.stringify(page)) - bytes + 128;
    if (overhead() > PAGE_BYTES) throw error('SEARCH_PAGE_TOO_LARGE', 'Search metadata exceeds the page budget; choose a shorter project path.');
    let skipped = false;
    while (index < snapshot.results.length && results.length < limit) {
      const next = snapshot.results[index], size = Buffer.byteLength(JSON.stringify(next));
      if (overhead() + bytes + size + (results.length ? 1 : 0) > PAGE_BYTES) {
        if (results.length) break;
        skipped = true; index++;
        if (!page.diagnostics.some(item => item.code === 'SEARCH_PAGE_ROW_TOO_LARGE')) page.diagnostics.push({code:'SEARCH_PAGE_ROW_TOO_LARGE',message:'A result was omitted because its paths and content exceed the page budget.'});
        continue;
      }
      results.push(next); bytes += size + (results.length > 1 ? 1 : 0); index++;
    }
    page.has_more = index < snapshot.results.length;
    if (page.has_more) page.next_cursor = `${id}.${index}`;
    if (skipped) Object.assign(page, {complete:false,reason:'byte_limit',truncated:true});
    if (Buffer.byteLength(JSON.stringify(page)) > PAGE_BYTES) throw error('SEARCH_PAGE_TOO_LARGE', 'Search metadata exceeds the page budget; narrow the search scope.');
    return page;
  }
  run(root, query, task, signal) {
    return new Promise((resolve, reject) => {
      let reason = '', bytes = 0, count = 0, stderr = '', buffer = '', skipping = false, settled = false, forced;
      const rows = [], diagnostics = [], decoder = new StringDecoder('utf8');
      const note = (code,message) => { const existing=diagnostics.find(item=>item.code===code);if(existing)existing.count++;else if(diagnostics.length<32)diagnostics.push({code,message,count:1}); };
      const child = this.spawnProcess(this.binary, argumentsFor(query), { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); task.child = child;
      const stop = why => {
        reason ||= why;
        try { child.kill(); } catch {}
        if (!forced) { forced = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 250); forced.unref?.(); }
      };
      task.stop = () => stop('cancelled');
      const cancel = () => stop('cancelled'); signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => stop('timeout'), query.timeout); timer.unref?.();
      const finish = (failure, code) => {
        if (settled) return; settled = true; clearTimeout(timer); clearTimeout(forced); signal?.removeEventListener('abort', cancel);
        if (signal?.aborted || reason === 'cancelled') { reject(signal?.reason || error('SEARCH_CANCELLED', 'The search was cancelled.')); return; }
        if (failure) { reject(error('SEARCH_UNAVAILABLE', 'The search process could not start.', { cause: failure.code })); return; }
        if (!reason && code !== 0 && code !== 1) {
          if (!count) { reject(error('SEARCH_FAILED', 'ripgrep could not complete this search.', { detail: stderr.slice(0, 4096) })); return; }
          reason = 'partial';
        }
        if (stderr) note('SEARCH_PARTIAL', stderr.slice(0, 4096));
        if (!reason && diagnostics.length) reason = 'partial';
        const byFile = new Map();
        for (const row of rows) { if (!byFile.has(row.path)) byFile.set(row.path, []); byFile.get(row.path).push(row); }
        const results = []; let resultBytes = 0;
        for (const row of rows) if (row.match) {
          const surrounding = byFile.get(row.path).filter(item => Math.abs(item.line - row.line) <= query.context);
          const context = []; let contextBytes = 0;
          for (const item of surrounding.slice().sort((a,b) => Math.abs(a.line-row.line)-Math.abs(b.line-row.line))) {
            const size = Buffer.byteLength(item.text) + 64;
            if (contextBytes + size > 16384) continue;
            context.push({ line: item.line, text: item.text, match: item.match }); contextBytes += size;
          }
          context.sort((a,b) => a.line-b.line);
          const result = { path: row.path, relative_path: path.relative(root, row.path), ...(query.type === 'content' ? {
            line: row.line, text: row.text, context,
          } : {}), ...(row.truncated || context.length < surrounding.length ? { truncated: true } : {}) };
          const size = Buffer.byteLength(JSON.stringify(result));
          if (resultBytes + size > MAX_BYTES) { reason ||= 'byte_limit'; break; }
          results.push(result); resultBytes += size;
        }
        resolve({ root, results, bytes: resultBytes, complete: !reason, reason: reason || (results.length ? 'completed' : 'no_matches'),
          truncated: ['max_results', 'byte_limit', 'timeout'].includes(reason) || results.some(row => row.truncated), searched_at: new Date(this.now()).toISOString(), diagnostics });
      };
      const collect = line => {
        if (reason) return;
        let file, text = '', lineNumber, match = true;
        if (query.type === 'files') {
          file = line;
          let relative = line.replace(/^\.\//, '').replace(/\\/g, '/'),pattern=query.pattern;
          if(query.ignoreCase){relative=relative.toLowerCase();pattern=pattern.toLowerCase();}
          if (/[*?{}[\]]/.test(pattern)) {
            if (!path.matchesGlob(pattern.includes('/') ? relative : path.posix.basename(relative), pattern)) return;
          } else if (!relative.includes(pattern)) return;
        }
        else {
          let parsed; try { parsed = JSON.parse(line); } catch { note('SEARCH_INVALID_OUTPUT', 'Skipped invalid search output.'); return; }
          if (!['match', 'context'].includes(parsed.type)) return;
          file = parsed.data?.path?.text; text = parsed.data?.lines?.text; lineNumber = parsed.data?.line_number; match = parsed.type === 'match';
          if (typeof text !== 'string' || !Number.isInteger(lineNumber)) { note('SEARCH_ENCODING', 'Skipped non-UTF-8 search content.'); return; }
          text = text.replace(/\r?\n$/, '');
        }
        if (typeof file !== 'string') return;
        const absolute = path.resolve(root, file);
        if (!inside(root, absolute)) { stop('partial'); return; }
        const truncated = text.length > 2048;
        const row = { path: absolute, line: lineNumber, text: text.slice(0, 2048), match, truncated };
        const size = Buffer.byteLength(row.text) + Buffer.byteLength(absolute) + 64;
        if (bytes + size > MAX_BYTES) { stop('byte_limit'); return; }
        rows.push(row); bytes += size;
        if (match && ++count >= MAX_MATCHES) stop('max_results');
      };
      child.stdout.on('data', chunk => {
        const separator = query.type === 'files' ? '\0' : '\n';
        buffer += decoder.write(chunk); let end;
        while ((end = buffer.indexOf(separator)) !== -1) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (!skipping && Buffer.byteLength(line) <= MAX_LINE) collect(line);
          else note('SEARCH_LONG_LINE', 'Skipped a search output line larger than 1 MiB.');
          skipping = false;
        }
        if (Buffer.byteLength(buffer) > MAX_LINE) { buffer = ''; skipping = true; }
      });
      child.stderr.on('data', chunk => { if (stderr.length < 4096) stderr += chunk.toString().slice(0, 4096 - stderr.length); });
      child.once('error', failure => finish(failure));
      child.once('close', code => { const tail = decoder.end(); if (!skipping && (buffer || tail)) collect(buffer + tail); finish(null, code); });
      if (signal?.aborted) cancel();
    });
  }
  dispose() { this.closed = true; for (const task of this.active) task.stop?.(); this.snapshots.clear(); }
}
module.exports = { ProjectSearch, SEARCH_TOOL, resolveRipgrep, argumentsFor, MAX_MATCHES, MAX_BYTES, PAGE_BYTES, CURSOR_TTL };
