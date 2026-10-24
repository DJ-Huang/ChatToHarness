'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {WindowsComputerUse, definition:winDefinition} = require('../app/windows-computer-use.cjs');
const {definition:macDefinition} = require('../app/macos-computer-use.cjs');
const PNG='iVBORw0KGgoAAAANSUhEUgAAAGQAAABQCAIAAABga0e4AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAuUlEQVR4nO3QoQEAAAiAMP9/Wl+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArP07lnpntGu1Yc0AAAAASUVORK5CYII=';
const sleep = ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check, ms=2500) {
  const deadline=Date.now()+ms;
  while(Date.now()<deadline) { const value=await check(); if(value)return value;await sleep(8); }
  throw new Error('Task did not reach expected state');
}
async function fixture(t, behavior={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cth-cu-task-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:6,retryDelay:40}));
  let x=100,y=100,drags=0;
  const native={
    closed:false,mouseHeld:false,ready:Promise.resolve({ready:true,window_id:'12345'}),
    stop(){this.closed=true;},
    async request(cmd) {
      if(cmd.action==='observe')return {width:100,height:80,geometry:[x,y,x+100,y+80],
        displays:[{x:0,y:0,width:1200,height:900}],png:PNG};
      if(cmd.action==='drag_window') {
        drags++;
        if(behavior.onDrag) await behavior.onDrag({cmd,drags});
        x=cmd.screen_x-cmd.x; y=cmd.screen_y-cmd.y;
      }
      return {ok:true,foreground:true};
    }
  };
  const service=new WindowsComputerUse({platform:'win32',deviceId:'cu-00000000-0000-4000-8000-000000000000',connect:()=>native,authorizationMode:'all_windows',
    taskDirectory:path.join(root,'records'),taskRetryMs:12,idleTimeoutMs:10000});
  const opened=await service.call({action:'open_session',session_title:'Computer Use 测试会话',window_id:'12345'});
  const id=opened.structuredContent.session_id;
  await until(async()=>(await service.call({action:'get_session'})).structuredContent.state==='ready');
  const observe=()=>service.call({action:'observe',session_id:id});
  const start=async (goal={x:120,y:130},key='task-a')=>{
    const shot=await observe();
    assert.equal(shot.isError,undefined);
    return service.call({action:'start_move_task',session_id:id,
      observation_id:shot.structuredContent.observation_id,
      target_x:goal.x,target_y:goal.y,idempotency_key:key});
  };
  const status=taskId=>service.call({action:'get_move_task',session_id:id,task_id:taskId});
  return {root,service,native,id,start,status,get drags(){return drags;},get position(){return {x,y}}};
}
test('shared Windows/macOS schema advertises session-scoped move task actions',()=>{
  for(const def of [winDefinition,macDefinition]){
    for(const name of ['start_move_task','get_move_task','cancel_move_task'])
      assert.ok(def.inputSchema.properties.action.enum.includes(name));
  }
});
test('TaskRunner persists a checkpoint, recovers pre-input error and verifies observed geometry',async t=>{
  let collision=true;
  const f=await fixture(t,{onDrag:()=>{if(collision){collision=false;throw Object.assign(
    new Error('CU_USER_INPUT_ACTIVE'),{code:'CU_USER_INPUT_ACTIVE',inputStarted:false});}}});
  const launch=await f.start();
  assert.equal(launch.isError,undefined);
  const taskId=launch.structuredContent.task_id;
  assert.match(taskId,/^cu-[0-9a-f-]{36}_[0-9]{13}(?:_[1-9][0-9]*)?$/);
  const done=await until(async()=>{
    const state=(await f.status(taskId)).structuredContent;
    return state.state==='succeeded'?state:null;
  });
  assert.deepEqual(done.last_observed,{x:120,y:130,width:100,height:80});
  assert.deepEqual(f.position,{x:120,y:130});
  assert.equal(f.drags,2);
  assert.equal(f.native.closed,true,'successful task must exit Computer Use and remove overlays');
  assert.ok(fs.existsSync(path.join(f.root,'records',taskId+'.json')));
  assert.ok(done.attempts>=2);
  // Idempotency must survive a lost start response and consumed original observation.
  const replay=await f.service.call({action:'start_move_task',session_id:f.id,
    observation_id:'already-consumed',target_x:120,target_y:130,idempotency_key:'task-a'});
  assert.equal(replay.structuredContent.reused,true);
  const duplicate=await f.service.call({action:'start_move_task',session_id:f.id,
    observation_id:'already-consumed',target_x:120,target_y:130,idempotency_key:'task-a'});
  assert.equal(duplicate.structuredContent.reused,true);
  assert.equal(f.drags,2);
  const conflict=await f.service.call({action:'start_move_task',session_id:f.id,
    observation_id:'already-consumed',target_x:140,target_y:130,idempotency_key:'task-a'});
  assert.equal(conflict.structuredContent.code,'CU_TASK_IDEMPOTENCY_CONFLICT');
  await f.service.call({action:'close_session'});
});
test('TaskRunner cancels without fighting user takeover and releases native session',async t=>{
  const f=await fixture(t,{onDrag:()=>{throw Object.assign(new Error('CU_USER_INPUT_ACTIVE'),
    {code:'CU_USER_INPUT_ACTIVE',inputStarted:false});}});
  const task=(await f.start()).structuredContent;
  await until(async()=>{
    const state=(await f.status(task.task_id)).structuredContent;
    return state.last_error==='CU_USER_INPUT_ACTIVE';
  });
  const other=await f.service.call({action:'click',session_id:f.id,
    observation_id:'unknown',x:5,y:5});
  assert.equal(other.structuredContent.code,'CU_TASK_RUNNING');
  const cancelled=await f.service.call({action:'cancel_move_task',session_id:f.id,
    task_id:task.task_id});
  assert.equal(cancelled.structuredContent.state,'cancelled');
  assert.equal(f.native.closed,true);
  const count=f.drags;
  await sleep(50);
  assert.equal(f.drags,count);
});
test('TaskRunner stops on uncertain native drag outcome and does not recreate a session',async t=>{
  const f=await fixture(t,{onDrag:()=>{throw Object.assign(new Error('CU_INPUT_FAILED'),
    {code:'CU_INPUT_FAILED',inputStarted:true});}});
  const start=(await f.start()).structuredContent;
  const final=await until(async()=>{
    const state=(await f.status(start.task_id)).structuredContent;
    return state.state==='session_terminated'?state:null;
  });
  assert.equal(final.state,'session_terminated');
  assert.equal(f.drags,1);
  assert.equal(f.native.closed,true);
});
test('TaskRunner does not auto-replay a running checkpoint after controller restart',async t=>{
  const f=await fixture(t,{onDrag:()=>{throw Object.assign(new Error('CU_USER_INPUT_ACTIVE'),
    {code:'CU_USER_INPUT_ACTIVE',inputStarted:false});}});
  const original=(await f.start()).structuredContent;
  await until(async()=>((await f.status(original.task_id)).structuredContent.last_error==='CU_USER_INPUT_ACTIVE'));
  const other=new WindowsComputerUse({platform:'win32',deviceId:'cu-00000000-0000-4000-8000-000000000000',authorizationMode:'all_windows',
    connect:()=>{throw new Error('Restart must not connect to native GUI');},
    taskDirectory:path.join(f.root,'records')});
  const status=await other.call({action:'get_move_task',session_id:f.id,task_id:original.task_id});
  assert.equal(status.structuredContent.state,'interrupted');
  assert.equal(status.structuredContent.reason,'CU_OWNER_RESTARTED');
  await f.service.call({action:'cancel_move_task',session_id:f.id,task_id:original.task_id});
});

test('TaskRunner closes control without moving the pointer when geometry already matches',async t=>{
  const f=await fixture(t);
  const launched=(await f.start({x:100,y:100},'already-correct')).structuredContent;
  const final=await until(async()=>{
    const result=(await f.status(launched.task_id)).structuredContent;
    return result.state==='succeeded'?result:null;
  });
  assert.deepEqual(final.last_observed,{x:100,y:100,width:100,height:80});
  assert.equal(f.drags,0);
  assert.equal(f.native.closed,true);
});
test('native STOP/Esc loss of the original session ends a recovering task',async t=>{
  const f=await fixture(t,{onDrag:()=>{throw Object.assign(new Error('CU_USER_INPUT_ACTIVE'),
    {code:'CU_USER_INPUT_ACTIVE',inputStarted:false});}});
  const task=(await f.start({x:130,y:130},'native-stop')).structuredContent;
  await until(async()=>((await f.status(task.task_id)).structuredContent.last_error==='CU_USER_INPUT_ACTIVE'));
  f.native.closed=true; // Simulated native STOP, never a real key or mouse event.
  const end=await until(async()=>{
    const state=(await f.status(task.task_id)).structuredContent;
    return state.state==='session_terminated'?state:null;
  });
  assert.equal(end.state,'session_terminated');
  assert.equal(f.service.session,null);
});
