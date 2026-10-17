'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {acquireInstance,installExitHandlers,RESTART_FLAG,RESTART_EXIT_CODE}=require('../app/dev-lifecycle.cjs');

function fixture({acquired=true,argv=[],packaged=false}={}) {
  const app=new EventEmitter();Object.assign(app,{isPackaged:packaged,quits:0,exits:[],requestSingleInstanceLock(data){this.data=data;return acquired;},quit(){this.quits++;},exit(code){this.exits.push(code);}});
  const host=new EventEmitter();Object.assign(host,{argv,pid:123,ppid:42,kill(){}});
  let shown=0;
  return {app,host,acquire(){return acquireInstance({app,host,show(){shown++;}});},get shown(){return shown;}};
}

test('development replacement requests graceful Quit while normal second launches show the window',()=>{
  const f=fixture({argv:[RESTART_FLAG]});assert.equal(f.acquire(),true);
  assert.equal(f.app.data.localHarnessDevRestart,true);
  f.app.emit('second-instance',{},[],'.',{});assert.equal(f.shown,1);
  f.app.emit('second-instance',{},[],'.',{localHarnessDevRestart:true});
  assert.equal(f.app.quits,1);assert.equal(f.shown,1);
});
test('lock contention has a distinct retry code and never starts another runtime',()=>{
  const f=fixture({acquired:false,argv:[RESTART_FLAG]});assert.equal(f.acquire(),false);
  assert.deepEqual(f.app.exits,[RESTART_EXIT_CODE]);assert.equal(f.app.listenerCount('second-instance'),0);
  const normal=fixture({acquired:false});assert.equal(normal.acquire(),false);assert.equal(normal.app.quits,1);
});
test('one-shot stop only targets its development owner and never creates a primary app',()=>{
  const f=fixture({argv:[RESTART_FLAG,'--localharness-dev-owner=42']});f.acquire();
  f.app.emit('second-instance',{},[],'.',{localHarnessDevStop:43});assert.equal(f.app.quits,0);
  f.app.emit('second-instance',{},[],'.',{localHarnessDevStop:42});assert.equal(f.app.quits,1);
  for(const acquired of [true,false]){
    const stop=fixture({argv:['--localharness-dev-stop=42'],acquired});assert.equal(stop.acquire(),false);
    assert.equal(stop.app.data.localHarnessDevStop,42);assert.deepEqual(stop.app.exits,[0]);
  }
  const normal=fixture();normal.acquire();normal.app.emit('second-instance',{},[],'.',{localHarnessDevStop:0});assert.equal(normal.app.quits,0);
  const invalid=fixture({argv:['--localharness-dev-stop=0']});assert.equal(invalid.acquire(),false);assert.deepEqual(invalid.app.exits,[1]);
});
test('signals and loss of development owner enter the normal Quit path once and remove handlers',()=>{
  const f=fixture({argv:[RESTART_FLAG,'--localharness-dev-owner=42']});let poll,cleared=false;
  installExitHandlers({app:f.app,host:f.host,setTimer(callback){poll=callback;return {unref(){}};},clearTimer(){cleared=true;}});
  poll();assert.equal(f.app.quits,0);
  f.host.kill=()=>{throw Object.assign(new Error(),{code:'EPERM'});};poll();assert.equal(f.app.quits,0);
  f.host.kill=()=>{throw Object.assign(new Error(),{code:'ESRCH'});};poll();f.host.emit('SIGTERM');
  assert.equal(f.app.quits,1);f.app.emit('will-quit');assert.equal(cleared,true);assert.equal(f.host.listenerCount('SIGTERM'),0);
});
test('owner monitoring is development-only and detects reparenting even if a PID is reused',()=>{
  const f=fixture({argv:[RESTART_FLAG,'--localharness-dev-owner=42']});let poll;
  const dispose=installExitHandlers({app:f.app,host:f.host,setTimer(callback){poll=callback;return {};},clearTimer(){}});
  f.host.ppid=1;poll();assert.equal(f.app.quits,1);dispose();
  const normal=fixture({packaged:true,argv:[RESTART_FLAG,'--localharness-dev-owner=42']});let timers=0;
  installExitHandlers({app:normal.app,host:normal.host,setTimer(){timers++;}});assert.equal(timers,0);normal.app.emit('will-quit');
});
