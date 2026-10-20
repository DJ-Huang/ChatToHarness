'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {createRequire, isBuiltin, wrap} = require('node:module');
const {Script} = require('node:vm');

// Standalone Node cannot load helpers from Electron's asar. Keep one explicit
// deployment manifest, and verify the copied dependency graph before launch.
const RUNTIME_COMPONENTS = Object.freeze({
  builtin: Object.freeze(['platform.cjs','project-context.cjs','project-search.cjs','tool-recovery.cjs','mcp-proxy.cjs','mcp-launch.cjs']),
  gateway: Object.freeze(['mcp-gateway-stdio.cjs']),
  diagnostics: Object.freeze(['diagnostic-writer.cjs','diagnostic-worker.cjs','diagnostic-storage.cjs','diagnostic-budget.cjs','durable-files.cjs','tool-recovery.cjs'])
});
const RUNTIME_ENTRYPOINTS=Object.freeze({
  builtin:Object.freeze(['mcp-launch.cjs']),gateway:Object.freeze(['mcp-gateway-stdio.cjs']),
  // Worker filenames are dynamic constructor arguments, not require() edges.
  diagnostics:Object.freeze(['diagnostic-writer.cjs','diagnostic-worker.cjs'])
});
const MESSAGES = {
  MCP_MODULE_NOT_FOUND: 'A copied runtime dependency is missing. Repair the application components.',
  MCP_FILE_NOT_FOUND: 'A runtime component is missing. Repair the application components.',
  MCP_ACCESS_DENIED: 'A runtime component is inaccessible. Check its local permissions.',
  MCP_COMPONENT_INVALID: 'A runtime component is invalid. Repair the application components.',
  MCP_START_FAILED: 'The runtime components could not be prepared. Check the local connection status.'
};
function componentFailure(error) {
  const code=Object.hasOwn(MESSAGES,error?.code)?error.code:
    ['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'].includes(error?.code)?'MCP_MODULE_NOT_FOUND':
    error?.code==='ENOENT'?'MCP_FILE_NOT_FOUND':
    ['EACCES','EPERM'].includes(error?.code)?'MCP_ACCESS_DENIED':
    !error||error.name==='SyntaxError'?'MCP_COMPONENT_INVALID':'MCP_START_FAILED';
  return Object.assign(new Error(MESSAGES[code]),{code});
}
function verifyRuntimeComponents({directory,entrypoints}) {
  try {
    const root=fs.realpathSync(directory),pending=entrypoints.map(name=>path.resolve(directory,name)),seen=new Set();
    while(pending.length){
      const file=pending.pop(),real=fs.realpathSync(file);
      if(seen.has(real))continue;
      const relative=path.relative(root,real);
      if(relative.startsWith('..'+path.sep)||relative==='..'||path.isAbsolute(relative)||!fs.statSync(real).isFile())throw componentFailure();
      seen.add(real);
      const source=fs.readFileSync(real,'utf8');
      // Compile without evaluating: validating an entrypoint must never create
      // its child processes, watchdogs, sockets or other startup side effects.
      new Script(wrap(source.replace(/^#![^\n]*(?:\n|$)/,'')),{filename:path.basename(real)});
      const resolve=createRequire(real).resolve;
      for(const match of source.matchAll(/\brequire\s*\(\s*(['"])([^'"\r\n]+)\1\s*\)/g)){
        const specifier=match[2];
        if(isBuiltin(specifier))continue;
        if(!specifier.startsWith('.'))throw componentFailure();
        const dependency=resolve(specifier);
        // Node may cache a resolved filename even after a previous deployment
        // removed it. Verify the actual copied file rather than that cache.
        try{fs.accessSync(dependency,fs.constants.R_OK);}catch(error){if(error.code==='ENOENT')error.code='MODULE_NOT_FOUND';throw error;}
        pending.push(dependency);
      }
    }
    return [...seen];
  }catch(error){throw componentFailure(error);}
}
function prepareRuntimeComponents({sourceDirectory,home,kind='builtin',launcherName='mcp-launch.cjs'}) {
  const names=RUNTIME_COMPONENTS[kind]?.map(name=>name==='mcp-launch.cjs'?launcherName:name);
  if(!names||path.basename(launcherName)!==launcherName)throw componentFailure();
  try {
    for(const name of names){
      const destination=path.join(home,name==='mcp-launch.cjs'||name===launcherName?'mcp-launch.cjs':name);
      const temporary=destination+'.'+process.pid+'.tmp';
      try{fs.writeFileSync(temporary,fs.readFileSync(path.join(sourceDirectory,name)),{mode:0o600,flag:'wx'});fs.renameSync(temporary,destination);}
      finally{try{fs.unlinkSync(temporary);}catch{}}
    }
    const entrypoints=RUNTIME_ENTRYPOINTS[kind];
    return verifyRuntimeComponents({directory:home,entrypoints});
  }catch(error){throw componentFailure(error);}
}

module.exports={RUNTIME_COMPONENTS,RUNTIME_ENTRYPOINTS,prepareRuntimeComponents,verifyRuntimeComponents,componentFailure};
