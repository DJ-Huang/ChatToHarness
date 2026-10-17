'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {desktopEntry,revealWindow,closeToBackground}=require('../app/window-access.cjs');

test('Mac startup registers a regular Dock application and reports Dock failures',async()=>{
  const calls=[];
  const app={setActivationPolicy:value=>calls.push(value),dock:{setIcon:value=>calls.push(value),show:async()=>{throw new Error('dock unavailable');}}};
  desktopEntry({app,platform:'darwin',icon:'/icon.png',onError:()=>calls.push('failed')});
  await Promise.resolve();
  assert.deepEqual(calls,['regular','/icon.png','failed']);
  desktopEntry({app:{},platform:'win32'});
});

test('revealing a minimized window restores native entry points before focusing it',()=>{
  for(const platform of ['darwin','win32']){
    const calls=[];
    const app={show:()=>calls.push('app'),dock:{show:async()=>calls.push('dock')}};
    const window={setSkipTaskbar:value=>calls.push(['taskbar',value]),isMinimized:()=>true,
      restore:()=>calls.push('restore'),show:()=>calls.push('show'),focus:()=>calls.push('focus')};
    revealWindow({app,window,platform});
    assert.deepEqual(calls,platform==='darwin'?['app','dock','restore','show','focus']:[['taskbar',false],'restore','show','focus']);
  }
});

test('closing without a usable tray minimizes instead of losing the window',()=>{
  for(const tray of [undefined,{isDestroyed:()=>true},{isDestroyed:()=>false}]){
    const calls=[];
    closeToBackground({event:{preventDefault:()=>calls.push('prevent')},tray,
      window:{hide:()=>calls.push('hide'),minimize:()=>calls.push('minimize')}});
    assert.deepEqual(calls,['prevent',tray&&!tray.isDestroyed()?'hide':'minimize']);
  }
});
