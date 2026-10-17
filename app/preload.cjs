'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const call=async(method,...args)=>{try{return await ipcRenderer.invoke('localharness:'+method,...args);}catch(error){throw new Error(String(error.message||'操作未完成，请重试。').replace(/^Error invoking remote method '[^']+': (?:(?:Error|SettingsError|McpSettingsError): )?/,''));}};
contextBridge.exposeInMainWorld('localHarness',Object.freeze({
  getState:()=>call('get-state'),saveSettings:value=>call('save-settings',value),
  chooseDirectories:()=>call('choose-directories'),connect:()=>call('connect'),disconnect:()=>call('disconnect'),
  check:()=>call('check'),clearCredentials:()=>call('clear-credentials'),openLogs:()=>call('open-logs'),
  openExternal:id=>call('open-external',id),setLanguage:locale=>call('set-language',locale),
  checkUpdate:()=>call('update-check'),setAutoCheckUpdates:enabled=>call('update-automatic',enabled),
  downloadUpdate:()=>call('update-download'),installUpdate:()=>call('update-install'),openRelease:()=>call('update-release'),
  mcpSaveServer:config=>call('mcp-save-server',config),mcpRemoveServer:id=>call('mcp-remove-server',id),
  mcpSetEnabled:(id,enabled)=>call('mcp-set-enabled',id,enabled),mcpTrustServer:id=>call('mcp-trust-server',id),
  mcpTestServer:id=>call('mcp-test-server',id),mcpSetToolPolicy:input=>call('mcp-set-tool-policy',input),
  mcpSetAllowAllTools:enabled=>call('mcp-set-allow-all-tools',enabled),
  mcpPreviewImport:text=>call('mcp-preview-import',text),mcpCommitImport:id=>call('mcp-commit-import',id),
  mcpExport:()=>call('mcp-export'),mcpResolveApproval:input=>call('mcp-resolve-approval',input),
  onShowUpdates:listener=>{if(typeof listener!=='function')return()=>{};const handler=()=>listener();ipcRenderer.on('localharness:show-updates',handler);return()=>ipcRenderer.removeListener('localharness:show-updates',handler);},
  onState:listener=>{if(typeof listener!=='function')return()=>{};const handler=(_event,value)=>listener(value);ipcRenderer.on('localharness:state',handler);return()=>ipcRenderer.removeListener('localharness:state',handler);},
}));
