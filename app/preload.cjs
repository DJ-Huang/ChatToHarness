'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const call=async(method,...args)=>{try{return await ipcRenderer.invoke('localharness:'+method,...args);}catch(error){throw new Error(String(error.message||'操作未完成，请重试。').replace(/^Error invoking remote method '[^']+': (?:Error: )?/,''));}};
contextBridge.exposeInMainWorld('localHarness',Object.freeze({
  getState:()=>call('get-state'),saveSettings:value=>call('save-settings',value),
  chooseDirectories:()=>call('choose-directories'),connect:()=>call('connect'),disconnect:()=>call('disconnect'),
  check:()=>call('check'),clearCredentials:()=>call('clear-credentials'),openLogs:()=>call('open-logs'),
  openExternal:id=>call('open-external',id),
  onState:listener=>{if(typeof listener!=='function')return()=>{};const handler=(_event,value)=>listener(value);ipcRenderer.on('localharness:state',handler);return()=>ipcRenderer.removeListener('localharness:state',handler);},
}));
