'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {atomicJson, readJson, privateDirectory} = require('./durable-files.cjs');
const {canonical, inside} = require('./project-context.cjs');

class ProjectGrants {
  constructor(directory) {
    this.directory = directory; this.file = path.join(directory, 'project-tool-grants.json');
    this.entries = [];
    if (fs.existsSync(this.file)) {
      const value = readJson(this.file);
      if (value.schema !== 1 || !Array.isArray(value.entries) || value.entries.length > 512 || value.entries.some(entry => !entry || !['serverId', 'toolName', 'definition', 'configuration', 'project'].every(key => typeof entry[key] === 'string') || !path.isAbsolute(entry.project))) throw new Error('Project tool grants cannot be read. The original file is preserved.');
      this.entries = value.entries;
    }
  }
  save(entries) { privateDirectory(this.directory); atomicJson(this.file, {schema: 1, entries}); this.entries = entries; }
  matches(record, item, project) { return Boolean(project && this.entries.some(entry => entry.serverId === record.id && entry.toolName === item.tool.name && entry.definition === item.fingerprint && entry.configuration === record.configFingerprint && inside(entry.project, project))); }
  projects(record, item) { return this.entries.filter(entry => entry.serverId === record.id && entry.toolName === item.tool.name && entry.definition === item.fingerprint && entry.configuration === record.configFingerprint).map(entry => entry.project); }
  remember(record, item, project) {
    if (!path.isAbsolute(project)) throw new Error('A canonical project is required.');
    if (this.matches(record, item, project)) return;
    if (this.entries.length >= 512) throw new Error('Clear old project grants before adding another.');
    this.save([...this.entries, {serverId: record.id, toolName: item.tool.name, definition: item.fingerprint, configuration: record.configFingerprint, project}]);
  }
  remove(serverId, toolName) { const next = this.entries.filter(entry => entry.serverId !== serverId || (toolName && entry.toolName !== toolName)); if (next.length !== this.entries.length) this.save(next); }
  reconcile(record, tools) { const next = this.entries.filter(entry => entry.serverId !== record.id || (entry.configuration === record.configFingerprint && tools.get(entry.toolName) === entry.definition)); if (next.length !== this.entries.length) this.save(next); }
}
async function approvalProject(args, item, directories = []) {
  if (typeof args.project_path !== 'string' || !path.isAbsolute(args.project_path) || !item.tool.inputSchema?.properties?.project_path) return undefined;
  try {
    const project = await canonical(args.project_path, true);
    if (!fs.statSync(project).isDirectory()) return undefined;
    const roots = await Promise.all(directories.map(root => canonical(root)));
    if (!roots.some(root => inside(root, project))) return undefined;
    const values = ['path', 'file_path', 'source', 'destination', 'outputPath'].map(key => args[key]).filter(value => value !== undefined);
    for (const key of ['paths', 'context_paths', 'target_paths']) if (args[key] !== undefined) { if (!Array.isArray(args[key])) return undefined; values.push(...args[key]); }
    if (values.length > 128) return undefined;
    for (const value of values) if (typeof value !== 'string' || !value || value.includes('\0') || !inside(project, await canonical(path.resolve(project, value)))) return undefined;
    return project;
  } catch { return undefined; }
}
module.exports = {ProjectGrants, approvalProject};
