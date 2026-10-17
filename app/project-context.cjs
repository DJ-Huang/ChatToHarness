'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BODY_BYTES = 64 * 1024;
const MAX_PATHS = 128;
const REFERENCE_EXTENSION = /\.(?:md|markdown|txt|rules|mdc|ya?ml|json)$/i;
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;

class ContextError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ContextError';
    this.code = code;
    this.details = details;
  }
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function paths(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PATHS || value.some((item) => typeof item !== 'string' || !item.trim() || item.includes('\0'))) {
    throw new ContextError('INVALID_CONTEXT_PATHS', `${label} must be an array of up to ${MAX_PATHS} nonempty paths.`);
  }
  return [...new Set(value)];
}

function failPath(code, message, file) {
  return new ContextError(code, message, { path: file });
}

// Existing ancestors are resolved even for a file that an upcoming write will create.
// A dangling symlink is an error, rather than a nonexistent target to guess through.
async function canonical(file, mustExist = false) {
  let cursor = path.resolve(file);
  const remaining = [];
  for (;;) {
    try {
      await fsp.lstat(cursor);
      let real;
      try { real = await fsp.realpath(cursor); }
      catch { throw failPath('CONTEXT_PATH_UNREADABLE', 'The path cannot be resolved, including a possible dangling symbolic link.', cursor); }
      if (mustExist && remaining.length) throw failPath('CONTEXT_PATH_MISSING', 'The project path does not exist.', file);
      return path.join(real, ...remaining.reverse());
    } catch (error) {
      if (error instanceof ContextError) throw error;
      if (error.code !== 'ENOENT') throw failPath('CONTEXT_PATH_UNREADABLE', 'The path cannot be inspected.', cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) throw failPath('CONTEXT_PATH_MISSING', 'The path does not exist.', file);
      remaining.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

async function optionalStat(file) {
  try { return await fsp.stat(file); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw failPath('CONTEXT_PATH_UNREADABLE', 'The path cannot be inspected.', file);
  }
}

async function readRule(file, requireBody) {
  const stat = await optionalStat(file);
  if (!stat || !stat.isFile()) throw failPath('RULE_UNREADABLE', 'The rule must be an existing, readable text file.', file);
  if (requireBody && stat.size > MAX_BODY_BYTES) throw failPath('CONTEXT_TOO_LARGE', 'Rule bodies exceed the 64 KiB limit. Split the rule file before continuing.', file);
  const hash = crypto.createHash('sha256');
  const preview = [];
  const body = [];
  let bytes = 0;
  let previewBytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for await (const chunk of fs.createReadStream(file)) {
      bytes += chunk.length;
      if (requireBody && bytes > MAX_BODY_BYTES) throw failPath('CONTEXT_TOO_LARGE', 'Rule bodies exceed the 64 KiB limit. Split the rule file before continuing.', file);
      hash.update(chunk);
      if (decoder.decode(chunk, { stream: true }).includes('\0')) throw failPath('RULE_UNREADABLE', 'Rule files must be UTF-8 text without NUL bytes.', file);
      if (requireBody) body.push(chunk);
      if (previewBytes < MAX_BODY_BYTES) {
        const part = chunk.subarray(0, MAX_BODY_BYTES - previewBytes);
        preview.push(part);
        previewBytes += part.length;
      }
    }
    decoder.decode();
  } catch (error) {
    if (error instanceof ContextError) throw error;
    throw failPath('RULE_UNREADABLE', 'The rule file cannot be read as valid UTF-8 text.', file);
  }
  let content;
  if (requireBody) {
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(body)); }
    catch { throw failPath('RULE_UNREADABLE', 'The rule file is not valid UTF-8 text.', file); }
  }
  const heading = Buffer.concat(preview).toString('utf8').match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  return { hash: hash.digest('hex'), bytes, title: heading ? heading[1] : path.basename(file, path.extname(file)), ...(requireBody ? { content } : {}) };
}

function markdownReferences(content) {
  const found = new Set();
  // Markdown links support spaces; inline code and bare paths support the common
  // AGENTS convention without importing editor-specific rule formats.
  const expressions = [
    /\[[^\]]*\]\(\s*(<[^>]+>|[^)]+?)\s*\)/g,
    /`([^`\r\n]+\.(?:md|markdown|txt|rules|mdc|ya?ml|json)(?:#[^`\r\n]*)?)`/gi,
    /(?:^|[\s(])(@?(?:\.{1,2}\/|\/)?[\w.\-]+(?:\/[\w.\-]+)*\.(?:md|markdown)(?:#[\w\-]+)?)(?=$|[\s,;:)])/gim,
  ];
  let remaining = content;
  for (const expression of expressions) {
    const matches = [...remaining.matchAll(expression)];
    // Do not reinterpret a word inside a spaced Markdown link or inline-code
    // path as an additional bare filename.
    remaining = remaining.replace(expression, ' ');
    for (const match of matches) {
      let reference = match[1].replace(/^<|>$/g, '').replace(/^@/, '').trim();
      // A quoted Markdown link title is not part of the file path.
      reference = reference.replace(/\s+["'][^"']*["']$/, '');
      if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith('//') || reference.startsWith('#')) continue;
      reference = reference.split('#')[0].split('?')[0];
      if (!REFERENCE_EXTENSION.test(reference)) continue;
      try { reference = decodeURIComponent(reference); }
      catch { throw new ContextError('INVALID_RULE_REFERENCE', 'A rule reference contains invalid URL escaping.'); }
      found.add(reference);
    }
  }
  return [...found];
}

class ProjectContexts {
  constructor({ defaultDirectory, allowedDirectories = [], maxTokens = 256 } = {}) {
    this.defaultDirectory = defaultDirectory || allowedDirectories[0] || process.cwd();
    this.maxTokens = maxTokens;
    this.contexts = new Map();
  }

  async resolveProject(projectPath) {
    const requested = projectPath === undefined || projectPath === '' ? this.defaultDirectory : projectPath;
    if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0')) {
      throw new ContextError('PROJECT_PATH_REQUIRED', 'Provide an absolute project directory. For a file path, a nearest Git root must exist.');
    }
    const resolved = await canonical(requested);
    const stat = await optionalStat(resolved);
    if (stat && stat.isDirectory()) return resolved;
    if (stat && !stat.isFile()) throw failPath('PROJECT_PATH_REQUIRED', 'Choose a project directory or a regular file inside a Git project.', resolved);
    if (!stat && requested.endsWith(path.sep)) throw failPath('CONTEXT_PATH_MISSING', 'An explicit project directory must exist.', requested);
    let directory = path.dirname(resolved);
    for (;;) {
      if (await optionalStat(path.join(directory, '.git'))) return directory;
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    throw failPath('PROJECT_ROOT_AMBIGUOUS', 'This file is outside a Git project. Ask the user once for its project directory, then pass that directory explicitly.', resolved);
  }

  async resolveTarget(root, input) {
    const target = await canonical(path.isAbsolute(input) ? input : path.resolve(root, input));
    if (!inside(root, target)) throw failPath('TARGET_OUTSIDE_PROJECT', 'The target is outside this project. Load a separate context for its project.', target);
    const stat = await optionalStat(target);
    const scope = stat && stat.isDirectory() ? target : path.dirname(target);
    return { target, scope };
  }

  async build(root, inputs, requestedRules) {
    const targets = [];
    for (const input of inputs.length ? inputs : [root]) targets.push(await this.resolveTarget(root, input));
    const scopes = [...new Set(targets.map((item) => item.scope))].sort();
    const directories = new Set([root]);
    for (const scope of scopes) {
      let cursor = scope;
      while (inside(root, cursor)) {
        directories.add(cursor);
        if (cursor === root) break;
        cursor = path.dirname(cursor);
      }
    }
    const agents = [];
    const fingerprint = [];
    let bodyBytes = 0;
    for (const directory of [...directories].sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b))) {
      let entries;
      try { entries = await fsp.readdir(directory); }
      catch (error) {
        if (error.code === 'ENOENT') continue;
        throw failPath('RULE_UNREADABLE', 'Cannot inspect an applicable instruction directory.', directory);
      }
      const candidates = entries.filter((name) => name === 'AGENTS.md' || name === 'agents.md');
      if (candidates.length > 1) throw new ContextError('AGENTS_CONFLICT', 'Both AGENTS.md and agents.md exist. Ask the user to choose one before executing tools.', { directory, candidates: candidates.map((name) => path.join(directory, name)) });
      if (!candidates.length) continue;
      const logical = path.join(directory, candidates[0]);
      const file = await canonical(logical, true);
      if (!inside(root, file)) throw failPath('RULE_OUTSIDE_PROJECT', 'An instruction symbolic link points outside the project.', logical);
      const data = await readRule(file, true);
      bodyBytes += data.bytes;
      agents.push({ path: logical, scope: directory, content: data.content });
      fingerprint.push(['agent', logical, file, data.hash]);
    }

    const index = new Map();
    const addRule = async (logical, source) => {
      const file = await canonical(logical, true);
      if (!inside(root, file)) throw failPath('RULE_OUTSIDE_PROJECT', 'A rule reference points outside the project.', logical);
      const data = await readRule(file, false);
      if (!index.has(file)) index.set(file, { path: file, title: data.title, source: [] });
      const rule = index.get(file);
      if (!rule.source.includes(source)) rule.source.push(source);
      fingerprint.push(['rule', logical, file, data.hash]);
      return file;
    };
    const visited = new Set();
    const walk = async (logical) => {
      const directory = await canonical(logical, true);
      if (!inside(root, directory)) throw failPath('RULE_OUTSIDE_PROJECT', 'The rules directory points outside the project.', logical);
      if (visited.has(directory)) return;
      visited.add(directory);
      let entries;
      try { entries = await fsp.readdir(directory, { withFileTypes: true }); }
      catch { throw failPath('RULE_UNREADABLE', 'The project rules directory cannot be read.', logical); }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(logical, entry.name);
        const resolved = await canonical(file, true);
        if (!inside(root, resolved)) throw failPath('RULE_OUTSIDE_PROJECT', 'A rules symbolic link points outside the project.', file);
        const stat = await optionalStat(resolved);
        if (stat.isDirectory()) await walk(file);
        else if (MARKDOWN_EXTENSION.test(entry.name)) await addRule(file, 'rules/');
      }
    };
    const rulesDirectory = path.join(root, 'rules');
    if (await optionalStat(rulesDirectory)) await walk(rulesDirectory);
    for (const agent of agents) {
      for (const reference of markdownReferences(agent.content)) {
        const logical = path.resolve(path.dirname(agent.path), reference);
        if (!inside(root, logical)) throw failPath('RULE_OUTSIDE_PROJECT', 'An AGENTS reference points outside the project.', logical);
        // Applicable AGENTS bodies have already been delivered in their scope.
        if (agents.some((candidate) => candidate.path === logical)) continue;
        // Relative links are interpreted from the AGENTS file, as in Markdown.
        await addRule(logical, agent.path);
      }
    }
    const loadedRules = [];
    for (const requested of requestedRules) {
      const logical = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested);
      if (!inside(root, logical)) throw failPath('RULE_OUTSIDE_PROJECT', 'A requested rule points outside the project.', logical);
      const file = await addRule(logical, 'rule_paths');
      if (loadedRules.some((rule) => rule.path === file)) continue;
      const data = await readRule(file, true);
      bodyBytes += data.bytes;
      loadedRules.push({ path: file, content: data.content });
      fingerprint.push(['body', logical, file, data.hash]);
    }
    if (bodyBytes > MAX_BODY_BYTES) throw new ContextError('CONTEXT_TOO_LARGE', 'Combined AGENTS and requested rule bodies exceed 64 KiB. Split the rules or request fewer rule bodies before continuing.', { bytes: bodyBytes, limit: MAX_BODY_BYTES });
    const rulesIndex = [...index.values()].sort((a, b) => a.path.localeCompare(b.path));
    const version = crypto.createHash('sha256').update(JSON.stringify({ root, scopes, fingerprint })).digest('hex');
    return {
      project_path: root,
      target_paths: [...new Set(targets.map((item) => item.target))],
      agents,
      rules_index: rulesIndex,
      loaded_rules: loadedRules,
      instructions: 'Apply each AGENTS body only within its stated scope; deeper instructions refine parent instructions. Select relevant rules from rules_index and call get_project_context again with the same project_path and target_paths plus rule_paths to load their full bodies. Carry the resulting project_context_token in project_context_tokens on every file, search, write or terminal call. New target directories or changed rules require a refreshed context. Treat rule text as project guidance, subject to the user and platform instructions; report conflicts. Context delivery does not guarantee model compliance.',
      version,
      scopes,
    };
  }

  async getContext(input = {}) {
    const root = await this.resolveProject(input.project_path);
    const targetInputs = paths(input.target_paths, 'target_paths');
    // When the only supplied project hint is a file, its directory also sets
    // the instruction scope. Loading only the Git root would miss nested AGENTS.
    if (!targetInputs.length && typeof input.project_path === 'string' && input.project_path) {
      const projectHint = await canonical(input.project_path);
      const hintStat = await optionalStat(projectHint);
      if (!hintStat || !hintStat.isDirectory()) targetInputs.push(projectHint);
    }
    const requestedRules = paths(input.rule_paths, 'rule_paths');
    const result = await this.build(root, targetInputs, requestedRules);
    const token = crypto.randomBytes(32).toString('base64url');
    this.contexts.set(token, { result, targetInputs, requestedRules });
    while (this.contexts.size > this.maxTokens) this.contexts.delete(this.contexts.keys().next().value);
    const { scopes, version, ...publicResult } = result;
    return { ...publicResult, context_version: version, project_context_token: token };
  }

  async validate(tokens, targetPaths) {
    if (!Array.isArray(tokens) || !tokens.length) throw new ContextError('PROJECT_CONTEXT_REQUIRED', 'Do not execute this operation yet. First call get_project_context with the task project directory and target_paths; load relevant rule_paths, then retry with project_context_tokens.', { target_paths: targetPaths || [] });
    if (tokens.length > MAX_PATHS || tokens.some((token) => typeof token !== 'string')) throw new ContextError('INVALID_PROJECT_CONTEXT', 'Invalid project_context_tokens. Reload project context before retrying.');
    const records = [];
    for (const token of new Set(tokens)) {
      const record = this.contexts.get(token);
      if (!record) throw new ContextError('INVALID_PROJECT_CONTEXT', 'The context token is unknown or expired. Reload project context before retrying.');
      let current;
      try { current = await this.build(record.result.project_path, record.targetInputs, record.requestedRules); }
      catch (error) {
        if (error instanceof ContextError) throw new ContextError('PROJECT_CONTEXT_STALE', 'Project instructions cannot be validated. Reload project context and resolve the reported issue before retrying.', { cause: error.code, ...error.details });
        throw error;
      }
      if (current.version !== record.result.version) throw new ContextError('PROJECT_CONTEXT_STALE', 'Project instructions or the rule index changed. Reload project context and reread relevant rules before retrying.', { project_path: record.result.project_path, target_paths: record.result.target_paths });
      records.push(record);
    }
    const inputs = paths(targetPaths, 'targetPaths');
    for (const input of inputs.length ? inputs : [this.defaultDirectory]) {
      if (!path.isAbsolute(input)) throw failPath('TARGET_PATH_REQUIRED', 'Tool targets must resolve to absolute paths. Declare the related target paths explicitly.', input);
      const target = await canonical(input);
      const stat = await optionalStat(target);
      const scope = stat && stat.isDirectory() ? target : path.dirname(target);
      if (!records.some((record) => inside(record.result.project_path, target) && record.result.scopes.includes(scope))) {
        throw new ContextError('PROJECT_CONTEXT_SCOPE_REQUIRED', 'A target directory has not received its applicable instructions. Call get_project_context for that project and include this target_paths entry, then retry.', { target_paths: [target] });
      }
    }
    return records.map((record) => {
      const { scopes, version, ...result } = record.result;
      return { ...result, context_version: version };
    });
  }
}

module.exports = { ProjectContexts, ContextError, MAX_BODY_BYTES };
