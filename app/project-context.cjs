'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BODY_BYTES = 64 * 1024;
const MAX_PATHS = 128;
const MAX_INDEX_FILES = 1024;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const REFERENCE_EXTENSION = /\.(?:md|markdown|txt|rules|mdc|ya?ml|json)$/i;

class ContextError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'ContextError'; this.code = code; this.details = details; }
}
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function paths(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PATHS || value.some(item => typeof item !== 'string' || !item.trim() || item.includes('\0'))) throw new ContextError('INVALID_CONTEXT_PATHS', `${label} must contain up to ${MAX_PATHS} nonempty paths.`);
  return [...new Set(value)];
}
function failPath(code, message, file) { return new ContextError(code, message, { path: file }); }
async function canonical(file, mustExist = false) {
  let cursor = path.resolve(file); const remaining = [];
  for (;;) {
    try {
      await fsp.lstat(cursor);
      let real;
      try { real = await fsp.realpath(cursor); } catch { throw failPath('CONTEXT_PATH_UNREADABLE', 'Cannot resolve the path or its symbolic link.', cursor); }
      if (mustExist && remaining.length) throw failPath('CONTEXT_PATH_MISSING', 'The path does not exist.', file);
      return path.join(real, ...remaining.reverse());
    } catch (error) {
      if (error instanceof ContextError) throw error;
      if (error.code !== 'ENOENT') throw failPath('CONTEXT_PATH_UNREADABLE', 'Cannot inspect the path.', cursor);
      const parent = path.dirname(cursor);
      if (parent === cursor) throw failPath('CONTEXT_PATH_MISSING', 'The path does not exist.', file);
      remaining.push(path.basename(cursor)); cursor = parent;
    }
  }
}
async function optionalStat(file) {
  try { return await fsp.stat(file, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw failPath('CONTEXT_PATH_UNREADABLE', 'Cannot inspect the path.', file); }
}
function signature(stat) { return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':'); }
function aborted(signal) { signal?.throwIfAborted(); }
function waitFor(promise, signal) {
  if (!signal) return promise;
  // Cancellation can precede subscription to a shared read. Its eventual
  // rejection still needs an observer after the last subscriber leaves.
  if (signal.aborted) { void promise.catch(() => {}); aborted(signal); }
  aborted(signal);
  return new Promise((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}
// Front matter is a bounded discovery hint. It never changes authorization.
function guidanceMetadata(content) {
  const metadata = {}, header = content.slice(0, 4096).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!header) return metadata;
  let listKey = null;
  const scalar = value => value.trim().replace(/^(['"])([\s\S]*)\1$/, '$2').slice(0, 1024);
  for (const line of header[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && listKey) { if (metadata[listKey].length < 32) metadata[listKey].push(scalar(item[1]).slice(0, 256)); continue; }
    const field = line.match(/^([A-Za-z_]+):\s*(.*?)\s*$/);
    listKey = null;
    if (!field) continue;
    const key = field[1], value = field[2];
    if (['name', 'description'].includes(key)) metadata[key] = scalar(value);
    if (key === 'alwaysApply') metadata.alwaysApply = value === 'true';
    if (['globs', 'paths', 'tasks', 'task_keywords'].includes(key)) {
      metadata[key] = value ? value.replace(/^\[|\]$/g, '').split(',').slice(0, 32).map(scalar).map(item => item.slice(0, 256)).filter(Boolean) : [];
      if (!value) listKey = key;
    }
  }
  return metadata;
}
function guidanceMatches(metadata, root, targets, task) {
  const patterns = [...(metadata.globs || []), ...(metadata.paths || [])];
  const keywords = [...(metadata.tasks || []), ...(metadata.task_keywords || [])];
  const pathMatch = patterns.some(pattern => targets.some(target => {
    const relative = path.relative(root, target.target).split(path.sep).join('/');
    try { return path.posix.matchesGlob(relative, pattern); } catch { return false; }
  }));
  const taskMatch = Boolean(task && keywords.some(keyword => task.toLowerCase().includes(keyword.toLowerCase())));
  return { path: pathMatch, task: taskMatch, always: metadata.alwaysApply === true,
    suggested: metadata.alwaysApply === true || pathMatch || taskMatch,
    basis: 'Matched rule bodies load automatically; skill bodies load only when selected.' };
}
function contextOptions(input) {
  if (input.task !== undefined && (typeof input.task !== 'string' || input.task.length > 4096 || input.task.includes('\0'))) throw new ContextError('INVALID_CONTEXT_TASK', 'task must be text of up to 4096 characters.');
  return { requestedSkills: paths(input.skill_paths, 'skill_paths'), task: input.task || '' };
}
function markdownReferences(content) {
  const found = new Set();
  const expressions = [
    /\[[^\]]*\]\(\s*(<[^>]+>|[^)]+?)\s*\)/g,
    /`([^`\r\n]+\.(?:md|markdown|txt|rules|mdc|ya?ml|json)(?:#[^`\r\n]*)?)`/gi,
    /(?:^|[\s(])(@?(?:\.{1,2}\/|\/)?[\w.\-]+(?:\/[\w.\-]+)*\.(?:md|markdown)(?:#[\w\-]+)?)(?=$|[\s,;:)])/gim,
  ];
  let remaining = content;
  for (const expression of expressions) {
    const matches = [...remaining.matchAll(expression)]; remaining = remaining.replace(expression, ' ');
    for (const match of matches) {
      let reference = match[1].replace(/^<|>$/g, '').replace(/^@/, '').trim().replace(/\s+["'][^"']*["']$/, '');
      if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith('//') || reference.startsWith('#')) continue;
      reference = reference.split('#')[0].split('?')[0];
      if (!REFERENCE_EXTENSION.test(reference)) continue;
      try { reference = decodeURIComponent(reference); } catch {}
      found.add(reference);
    }
  }
  return [...found];
}

class ProjectContexts {
  constructor({ defaultDirectory, allowedDirectories = [], maxTokens = 256 } = {}) {
    this.defaultDirectory = defaultDirectory || allowedDirectories[0] || process.cwd();
    this.allowedDirectories = (allowedDirectories.length ? allowedDirectories : [this.defaultDirectory]).map(file => path.resolve(file));
    this.maxTokens = maxTokens; this.contexts = new Map(); this.files = new Map(); this.directories = new Map(); this.pending = new Map();this.directoryEntries=0;
    this.cacheBytes = 0; this.cacheStats = { bodyReads: 0, indexReads: 0, hits: 0 };
  }
  async authorize(file, mustExist = false) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0') || file.length>32768) throw failPath('TARGET_PATH_REQUIRED', 'An absolute local path of up to 32768 characters is required.', typeof file==='string'?file.slice(0,1024):file);
    const resolved = await canonical(file, mustExist);
    // Desktop settings define access; project guidance can never expand it.
    const roots = await this.roots();
    if (!roots.some(root => inside(root, resolved))) throw failPath('PATH_NOT_ALLOWED', 'The path is outside the folders authorized in the app.', file);
    return resolved;
  }
  roots() { return this.rootsPromise ||= Promise.all(this.allowedDirectories.map(root => canonical(root))); }
  async authorizePaths(inputs, signal) {
    const result = [];
    for (const file of paths(inputs, 'target_paths')) { aborted(signal); result.push(await this.authorize(file)); }
    return result;
  }
  async resolveProject(projectPath) {
    const requested = projectPath === undefined || projectPath === '' ? this.defaultDirectory : projectPath;
    const resolved = await this.authorize(requested), stat = await optionalStat(resolved);
    if (stat?.isDirectory()) return resolved;
    if (stat && !stat.isFile()) throw failPath('PROJECT_PATH_REQUIRED', 'Choose a project directory or a file in a Git project.', resolved);
    if (!stat && requested.endsWith(path.sep)) throw failPath('CONTEXT_PATH_MISSING', 'The project directory does not exist.', requested);
    let directory = path.dirname(resolved);
    for (;;) {
      await this.authorize(directory);
      if (await optionalStat(path.join(directory, '.git'))) return directory;
      const parent = path.dirname(directory);
      if (parent === directory || !(await this.roots()).some(root => inside(root, parent))) break;
      directory = parent;
    }
    throw failPath('PROJECT_ROOT_AMBIGUOUS', 'Pass the task project directory explicitly for this non-Git file.', resolved);
  }
  async inferProject(file) {
    const target = await this.authorize(file), stat = await optionalStat(target);
    const roots = (await this.roots()).filter(root => inside(root, target)).sort((a, b) => b.length - a.length);
    const boundary = roots[0]; let cursor = stat?.isDirectory() ? target : path.dirname(target);
    for (;;) {
      if (await optionalStat(path.join(cursor, '.git'))) return cursor;
      if (cursor === boundary) return boundary;
      const parent = path.dirname(cursor);
      if (parent === cursor || !inside(boundary, parent)) return boundary;
      cursor = parent;
    }
  }
  async resolveTarget(root, input) {
    const target = await this.authorize(path.isAbsolute(input) ? input : path.resolve(root, input));
    if (!inside(root, target)) throw failPath('TARGET_OUTSIDE_PROJECT', 'Load a separate context for a target outside this project.', target);
    const stat = await optionalStat(target);
    return { target, scope: stat?.isDirectory() ? target : path.dirname(target) };
  }
  async directory(file, signal) {
    aborted(signal); const stat = await optionalStat(file);
    if (!stat) return [];
    if (!stat.isDirectory()) throw failPath('RULE_UNREADABLE', 'Expected an instruction directory.', file);
    const key = signature(stat), cached = this.directories.get(file);
    if (cached?.key === key) return cached.entries;
    const entries=[];
    for await(const entry of await fsp.opendir(file)){
      aborted(signal);if(entries.length>=2048){entries.truncated=true;break;}entries.push(entry);
    }
    if(cached)this.directoryEntries-=cached.entries.length;
    this.directories.set(file, { key, entries });
    this.directoryEntries+=entries.length;
    while(this.directories.size>512||this.directoryEntries>8192){const oldest=this.directories.keys().next().value;this.directoryEntries-=this.directories.get(oldest).entries.length;this.directories.delete(oldest);}
    return entries;
  }
  async agentFiles(directory,signal){
    aborted(signal);const stat=await optionalStat(directory);if(!stat)return [];
    // Directory metadata can remain unchanged when a child is created.
    // Probe both fixed names on every refresh; readRule still caches bodies.
    const names=[],identities=new Set();
    for(const name of ['AGENTS.md','agents.md']){
      try{
        const info=await fsp.lstat(path.join(directory,name),{bigint:true}),identity=`${info.dev}:${info.ino}`;
        // Case aliases and hard links to the same physical instruction file
        // deliver a single body; two distinct candidates remain a conflict.
        if(!identities.has(identity)){identities.add(identity);names.push(name);}
      }catch(error){if(error.code!=='ENOENT')throw error;}
    }
    return names;
  }
  async readRule(file, body, signal) {
    aborted(signal); const stat = await optionalStat(file);
    aborted(signal);
    if (!stat?.isFile()) throw failPath('RULE_UNREADABLE', 'The rule must be an existing readable text file.', file);
    if (body && stat.size > BigInt(MAX_BODY_BYTES)) throw failPath('CONTEXT_TOO_LARGE', 'The instruction body exceeds 64 KiB.', file);
    const key = signature(stat), cached = this.files.get(file);
    if (cached?.signature === key && (!body || cached.content !== undefined)) {
      this.cacheStats.hits++; this.files.delete(file); this.files.set(file, cached); return cached;
    }
    const pendingKey = `${file}:${key}:${body}`; let shared = this.pending.get(pendingKey);
    if (!shared || shared.controller.signal.aborted) {
      const controller = new AbortController(); shared = { controller, users: 0 };
      shared.promise = this.readFresh(file, stat, body, controller.signal).finally(() => { if (this.pending.get(pendingKey) === shared) this.pending.delete(pendingKey); });
      this.pending.set(pendingKey, shared);
    }
    shared.users++;
    try { return await waitFor(shared.promise, signal); }
    finally { if (--shared.users === 0) shared.controller.abort(); }
  }
  async readFresh(file, stat, body, signal) {
    let bytes;
    const handle = await fsp.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (signature(await handle.stat({ bigint: true })) !== signature(stat)) throw failPath('RULE_CHANGED', 'The rule changed before it could be read.', file);
      if (body) {
        this.cacheStats.bodyReads++;
        const buffer=Buffer.alloc(MAX_BODY_BYTES+1);let offset=0;
        while(offset<buffer.length){aborted(signal);const result=await handle.read(buffer,offset,buffer.length-offset,null);if(!result.bytesRead)break;offset+=result.bytesRead;}
        if (offset > MAX_BODY_BYTES) throw failPath('CONTEXT_TOO_LARGE', 'The instruction body exceeds 64 KiB.', file);
        bytes=buffer.subarray(0,offset);
      } else {
        this.cacheStats.indexReads++; const buffer = Buffer.alloc(4096); const read = await handle.read(buffer, 0, buffer.length, 0); bytes = buffer.subarray(0, read.bytesRead);
      }
    } finally { await handle.close(); }
    aborted(signal); const after = await optionalStat(file);
    if (!after || signature(after) !== signature(stat)) throw failPath('RULE_CHANGED', 'The rule changed while being read; retry with a fresh context.', file);
    let content;
    try { content = new TextDecoder('utf-8', { fatal: body }).decode(bytes); if (content.includes('\0')) throw new Error(); }
    catch { throw failPath('RULE_UNREADABLE', 'Rule bodies must be UTF-8 text without NUL bytes.', file); }
    const heading = content.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
    const data = { signature: signature(stat), hash: body ? crypto.createHash('sha256').update(bytes).digest('hex') : signature(stat),
      metadata: guidanceMetadata(content), bytes: Number(stat.size), title: (heading ? heading[1] : path.basename(file, path.extname(file))).slice(0,256), storedBytes: bytes.length, ...(body ? { content } : {}) };
    if (!body && this.files.get(file)?.signature === data.signature && this.files.get(file).content !== undefined) return this.files.get(file);
    if (this.files.has(file)) this.cacheBytes -= this.files.get(file).storedBytes;
    this.files.delete(file); this.files.set(file, data); this.cacheBytes += data.storedBytes;
    while (this.files.size > 512 || this.cacheBytes > MAX_CACHE_BYTES) {
      const oldest = this.files.keys().next().value; this.cacheBytes -= this.files.get(oldest).storedBytes; this.files.delete(oldest);
    }
    return data;
  }
  async build(root, inputs, requestedRules, signal, {requestedSkills = [], task = ''} = {}) {
    const targets = [];
    for (const input of inputs.length ? inputs : [root]) { aborted(signal); targets.push(await this.resolveTarget(root, input)); }
    const scopes = [...new Set(targets.map(item => item.scope))].sort(), directories = new Set([root]);
    for (const scope of scopes) {
      let cursor = scope;
      while (inside(root, cursor)) { directories.add(cursor); if (cursor === root) break; cursor = path.dirname(cursor); }
    }
    const agents = [], diagnostics = [], fingerprint = [], delivered = []; let bodyBytes = 0;
    const diagnose = (error, source, blocks_writes = false) => {
      if (signal?.aborted) throw signal.reason;
      if(diagnostics.length>=127){
        let summary=diagnostics.find(item=>item.code==='DIAGNOSTICS_LIMIT');
        if(!summary){summary={code:'DIAGNOSTICS_LIMIT',source:root,path:root,message:'Additional diagnostics omitted; narrow the targets or select specific rule_paths.',blocks_writes:false,omitted:0};diagnostics.push(summary);}
        summary.omitted++;summary.blocks_writes ||= blocks_writes;return;
      }
      diagnostics.push({ code: error.code || 'RULE_UNREADABLE', path: error.details?.path || source, source, message: error.message, blocks_writes });
    };
    for (const directory of [...directories].sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b))) {
      aborted(signal);
      try {
        const candidates = await this.agentFiles(directory,signal);
        if (candidates.length > 1) throw failPath('AGENTS_CONFLICT', 'Both AGENTS.md and agents.md exist; resolve the conflict before writing.', directory);
        if (!candidates.length) continue;
        const logical = path.join(directory, candidates[0]), file = await this.authorize(logical, true), data = await this.readRule(file, true, signal);
        if (bodyBytes + data.bytes > MAX_BODY_BYTES) throw failPath('CONTEXT_TOO_LARGE', 'Applicable AGENTS bodies exceed the combined 64 KiB delivery budget.', logical);
        bodyBytes += data.bytes; agents.push({ path: logical, scope: directory, content: data.content }); delivered.push(['agent', logical, file, data.hash]);
      } catch (error) { diagnose(error, directory, true); }
    }
    const index = new Map();
    const addRule = async (logical, source) => {
      if(index.size>=MAX_INDEX_FILES&&source!=='rule_paths')throw failPath('RULE_INDEX_LIMIT','Rule index capacity reached; select specific rule_paths for full bodies.',logical);
      aborted(signal); const file = await this.authorize(logical, true), data = await this.readRule(file, false, signal);
      if (!index.has(file)) index.set(file, { path: file, title: data.metadata?.name || data.title, description: data.metadata?.description || '', metadata: data.metadata || {}, match: guidanceMatches(data.metadata || {}, root, targets, task), source: [] });
      if (!index.get(file).source.includes(source)) index.get(file).source.push(source);
      fingerprint.push(['rule', logical, file, data.signature]); return file;
    };
    const visited = new Set(); let indexed = 0;
    const walk = async logical => {
      aborted(signal); const directory = await this.authorize(logical, true);
      if (visited.has(directory)) return;
      if (visited.size >= 256) throw failPath('RULE_INDEX_LIMIT', 'Rule directory index limit reached; load specific rule_paths as needed.', directory);
      visited.add(directory);
      const entries=await this.directory(directory,signal);
      if(entries.truncated)diagnose(failPath('RULE_INDEX_LIMIT','This rule directory has more than 2048 entries; select concrete rule_paths as needed.',directory),directory);
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (indexed >= MAX_INDEX_FILES) throw failPath('RULE_INDEX_LIMIT', 'Rule file index limit reached; load specific rule_paths as needed.', logical);
        const file = path.join(logical, entry.name);
        try {
          const resolved = await this.authorize(file, true), stat = await optionalStat(resolved);
          if (stat?.isDirectory()) await walk(file);
          else if (/\.(?:md|markdown|mdc)$/i.test(entry.name)) { await addRule(file, 'rules/'); indexed++; }
        } catch (error) { diagnose(error, file); if (error.code === 'RULE_INDEX_LIMIT') return; }
      }
    };
    const rulesDirectory = path.join(root, 'rules');
    try { if (await optionalStat(rulesDirectory)) await walk(rulesDirectory); } catch (error) { diagnose(error, rulesDirectory); }
    const referencedSkills = [];
    for (const agent of agents) for (const reference of markdownReferences(agent.content)) {
      const logical = path.resolve(path.dirname(agent.path), reference);
      if (agents.some(candidate => candidate.path === logical)) continue;
      if (/^SKILL\.md$/i.test(path.basename(logical))) { referencedSkills.push([logical,agent.path]); continue; }
      try {
        if (/[{}*]/.test(reference)) throw failPath('RULE_REFERENCE_PATTERN', 'This reference is a documentation pattern; select concrete rule files when needed.', logical);
        await addRule(logical, agent.path);
      } catch (error) { diagnose(error, agent.path); }
    }
    const skills = new Map(), skillDirectories = new Set();
    const addSkill = async (logical, source) => {
      if (skills.size >= MAX_INDEX_FILES) throw failPath('SKILL_INDEX_LIMIT','Skill index capacity reached; select a narrower project.',logical);
      const file = await this.authorize(logical,true), data = await this.readRule(file,false,signal);
      if (!skills.has(file)) skills.set(file,{path:file,name:data.metadata?.name || path.basename(path.dirname(file)),title:data.title,description:data.metadata?.description || '',metadata:data.metadata || {},match:guidanceMatches(data.metadata || {},root,targets,task),source:[]});
      if (!skills.get(file).source.includes(source)) skills.get(file).source.push(source);
      fingerprint.push(['skill',logical,file,data.signature]); return file;
    };
    const walkSkills = async (logical, depth = 0) => {
      aborted(signal); const directory = await this.authorize(logical,true);
      if (skillDirectories.has(directory)) return;
      if (skillDirectories.size >= 256 || depth > 4) throw failPath('SKILL_INDEX_LIMIT','Skill directory discovery budget reached.',logical);
      skillDirectories.add(directory);
      const entries = await this.directory(directory,signal);
      if (entries.truncated) diagnose(failPath('SKILL_INDEX_LIMIT','Skill directory contains more than 2048 entries.',directory),directory);
      for (const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))) {
        const file = path.join(logical,entry.name);
        try {
          if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) await walkSkills(file,depth+1);
          else if (/^SKILL\.md$/i.test(entry.name)) await addSkill(file,'skill_directory');
        } catch(error) { diagnose(error,file); if(error.code==='SKILL_INDEX_LIMIT')return; }
      }
    };
    for (const relative of ['skills','.agents/skills','.codex/skills']) {
      const directory = path.join(root,relative);
      try { if(await optionalStat(directory))await walkSkills(directory); } catch(error) { diagnose(error,directory); }
    }
    for (const [logical,source] of referencedSkills) try { await addSkill(logical,source); } catch(error) { diagnose(error,source); }
    const loadedRules = [];
    const selectedRules = [...new Set([...requestedRules,...[...index.values()].filter(item=>item.match.suggested).map(item=>item.path)])];
    for (const requested of selectedRules) {
      const logical = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested), file = await addRule(logical, 'rule_paths');
      if (loadedRules.some(rule => rule.path === file)) continue;
      const data = await this.readRule(file, true, signal); bodyBytes += data.bytes;
      if (bodyBytes > MAX_BODY_BYTES) throw failPath('CONTEXT_TOO_LARGE', 'Combined instruction bodies exceed 64 KiB; request fewer rule bodies.', file);
      loadedRules.push({ path: file, content: data.content }); delivered.push(['body', logical, file, data.hash]);
    }
    const loadedSkills = [];
    for (const requested of requestedSkills) {
      const logical = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root,requested), file = await addSkill(logical,'skill_paths');
      if(loadedSkills.some(skill=>skill.path===file))continue;
      const data = await this.readRule(file,true,signal); bodyBytes += data.bytes;
      if(bodyBytes > MAX_BODY_BYTES)throw failPath('CONTEXT_TOO_LARGE','Combined AGENTS, rule and skill bodies exceed 64 KiB; select fewer bodies.',file);
      loadedSkills.push({path:file,content:data.content});delivered.push(['skill_body',logical,file,data.hash]);
    }
    const blocking = diagnostics.filter(item => item.blocks_writes);
    const instructionVersion = crypto.createHash('sha256').update(JSON.stringify({ root, scopes, delivered, blocking })).digest('hex');
    const version = crypto.createHash('sha256').update(JSON.stringify({ instructionVersion, fingerprint, diagnostics })).digest('hex');
    return { project_path: root, target_paths: [...new Set(targets.map(item => item.target))], agents,
      rules_index: [...index.values()].sort((a, b) => a.path.localeCompare(b.path)), loaded_rules: loadedRules, skills_index:[...skills.values()].sort((a,b)=>a.path.localeCompare(b.path)), loaded_skills:loadedSkills, diagnostics,
      precedence:{agents:'outer_to_inner',rules:'matching_or_explicit',skills:'explicit_on_demand',authorization:'desktop_settings_only'},
      budget:{body_bytes:bodyBytes,body_limit_bytes:MAX_BODY_BYTES,metadata_prefix_bytes:4096},
      instructions: 'AGENTS apply outer-to-inner. Rule metadata globs/paths and tasks/task_keywords select applicable bodies; alwaysApply rules also load. skills_index is discovery only; skill_paths loads selected bodies. Explicit user instructions take precedence over project guidance. Missing instructions are allowed. Diagnostics do not block reads; blocks_writes marks unavailable AGENTS. Delivery tokens record supplied content and never grant access.',
      instructionVersion, version, scopes };
  }
  publicResult(result) {
    const { scopes, version, instructionVersion, ...value } = result;
    return { ...value, context_version: version, instruction_version: instructionVersion };
  }
  async getContext(input = {}, { signal } = {}) {
    aborted(signal); const root = await this.resolveProject(input.project_path), targetInputs = paths(input.target_paths, 'target_paths');
    if (!targetInputs.length && input.project_path) { const hint = await this.authorize(input.project_path), stat = await optionalStat(hint); if (!stat?.isDirectory()) targetInputs.push(hint); }
    const requestedRules = paths(input.rule_paths, 'rule_paths'), options = contextOptions(input), result = await this.build(root, targetInputs, requestedRules, signal, options); aborted(signal);
    const token = crypto.randomBytes(32).toString('base64url'); this.contexts.set(token, { result, targetInputs, requestedRules, options });
    while (this.contexts.size > this.maxTokens) this.contexts.delete(this.contexts.keys().next().value);
    return { ...this.publicResult(result), project_context_token: token };
  }
  async validate(tokens, targetPaths = [], { signal } = {}) {
    if (!Array.isArray(tokens) || !tokens.length) throw new ContextError('PROJECT_CONTEXT_REQUIRED', 'Load project context before changing files.', { target_paths: targetPaths });
    if (tokens.length > MAX_PATHS || tokens.some(token => typeof token !== 'string')) throw new ContextError('INVALID_PROJECT_CONTEXT', 'Invalid context tokens; reload instructions.');
    const records = [], currentResults = [];
    for (const token of new Set(tokens)) {
      const record = this.contexts.get(token);
      if (!record) throw new ContextError('INVALID_PROJECT_CONTEXT', 'The context token expired; reload instructions.');
      let current;
      try { current = await this.build(record.result.project_path, record.targetInputs, record.requestedRules, signal, record.options); }
      catch (error) { if (signal?.aborted) throw signal.reason; throw new ContextError('PROJECT_CONTEXT_STALE', 'Selected project instructions changed or are unavailable.', { cause: error.code, ...error.details }); }
      if (current.diagnostics.some(item => item.blocks_writes)) throw new ContextError('PROJECT_INSTRUCTIONS_UNAVAILABLE', 'Resolve the reported AGENTS errors before writing.', { diagnostics: current.diagnostics });
      if (current.instructionVersion !== record.result.instructionVersion) throw new ContextError('PROJECT_CONTEXT_STALE', 'Delivered instructions changed; read the refreshed context before retrying.', { project_path: current.project_path, target_paths: current.target_paths });
      records.push(record); currentResults.push({ ...this.publicResult(current), project_context_token: token });
    }
    for (const input of targetPaths.length ? targetPaths : [this.defaultDirectory]) {
      const target = await this.authorize(input), stat = await optionalStat(target), scope = stat?.isDirectory() ? target : path.dirname(target);
      const covering = records.map((record, index) => ({record, current: currentResults[index]})).filter(({record}) => inside(record.result.project_path, target) && record.result.scopes.includes(scope));
      if (!covering.length) throw new ContextError('PROJECT_CONTEXT_SCOPE_REQUIRED', 'New target scope; read its instructions before retrying.', { target_paths: [target] });
      // Two files in the same directory can match different rules. A directory
      // delivery token alone must not skip newly applicable file-pattern rules.
      const rulesCovered = covering.some(({record, current}) => current.rules_index
        .filter(rule => guidanceMatches(rule.metadata || {}, current.project_path, [{target}], record.options?.task || '').suggested)
        .every(rule => current.loaded_rules.some(loaded => loaded.path === rule.path)));
      if (!rulesCovered) throw new ContextError('PROJECT_CONTEXT_SCOPE_REQUIRED', 'This filename matches guidance that has not been delivered. Read the refreshed context before retrying.', {target_paths: [target]});
    }
    return currentResults;
  }
  async prepare(tokens, targetPaths, { projectPath, signal, writing = false } = {}) {
    if(tokens!==undefined&&(!Array.isArray(tokens)||tokens.length>MAX_PATHS||tokens.some(token=>typeof token!=='string'||!token)))throw new ContextError('INVALID_PROJECT_CONTEXT','Context tokens must be an array of up to 128 strings.');
    const targets = await this.authorizePaths(targetPaths.length ? targetPaths : [this.defaultDirectory], signal);
    if (projectPath) { const root = await this.resolveProject(projectPath); if (targets.some(target => !inside(root, target))) throw failPath('TARGET_OUTSIDE_PROJECT', 'The explicit project does not contain every target.', root); }
    if (!writing && Array.isArray(tokens) && tokens.length) {
      try {
        const contexts = await this.validate(tokens, targets, { signal });
        return { contexts: contexts.map(context => ({ ...context, agents: [], loaded_rules: [], rules_index: [], skills_index:[], loaded_skills:[], reused: true,
          instructions: 'Previously delivered instruction bodies are unchanged and omitted here. Current diagnostics are included.' })), needsDelivery: false };
      } catch (error) { if (signal?.aborted || error.code === 'PATH_NOT_ALLOWED') throw error; }
    }
    let refresh=false;
    if (writing) {
      try { return { contexts: await this.validate(tokens, targets, { signal }), needsDelivery: false }; }
      catch (error) { if (signal?.aborted || error.code === 'PATH_NOT_ALLOWED' || !(error instanceof ContextError)) throw error;refresh=error.code==='PROJECT_CONTEXT_STALE'; }
    }
    const groups = new Map();
    for (const target of targets) {
      const matching = Array.isArray(tokens) ? tokens.map(token => this.contexts.get(token)).filter(record => record && inside(record.result.project_path, target)).sort((a, b) => b.result.project_path.length - a.result.project_path.length)[0] : null;
      const root = projectPath ? await this.resolveProject(projectPath) : matching?.result.project_path || await this.inferProject(target);
      if (!groups.has(root)) groups.set(root, { targets: [], rules: new Set(), skills: new Set(), task: matching?.options?.task || '' });
      groups.get(root).targets.push(target);
      for (const rule of matching?.requestedRules || []) groups.get(root).rules.add(rule);
      for (const skill of matching?.options?.requestedSkills || []) groups.get(root).skills.add(skill);
    }
    const contexts = [];
    for (const [root, group] of groups) {
      try { contexts.push(await this.getContext({ project_path: root, target_paths: group.targets, rule_paths: [...group.rules],skill_paths:[...group.skills],task:group.task }, { signal })); }
      catch (error) {
        if (signal?.aborted || error.code === 'PATH_NOT_ALLOWED' || error.code === 'TARGET_OUTSIDE_PROJECT') throw error;
        const context = await this.getContext({ project_path: root, target_paths: group.targets }, { signal });
        context.diagnostics.push({ code: error.code, path: error.details?.path, source: 'previous rule_paths', message: error.message, blocks_writes: false }); contexts.push(context);
      }
    }
    if (writing && contexts.some(context => context.diagnostics.some(item => item.blocks_writes))) throw new ContextError('PROJECT_INSTRUCTIONS_UNAVAILABLE', 'Resolve AGENTS errors before writing.', { contexts });
    return { contexts, needsDelivery: writing && (refresh||contexts.some(context => context.agents.length || context.loaded_rules.length || context.loaded_skills.length || context.diagnostics.some(item=>item.source==='previous rule_paths'))) };
  }
  dispose() { for (const shared of this.pending.values()) shared.controller.abort(); this.pending.clear(); this.files.clear(); this.directories.clear();this.directoryEntries=0;this.contexts.clear(); this.cacheBytes = 0; }
}
module.exports = { ProjectContexts, ContextError, MAX_BODY_BYTES, canonical, inside };
