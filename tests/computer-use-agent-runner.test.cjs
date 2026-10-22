'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {WindowsComputerUse,definition:win}=require('../app/windows-computer-use.cjs');
const {definition:mac}=require('../app/macos-computer-use.cjs');
const {ComputerUseAgentRunner}=require('../app/computer-use-agent-runner.cjs');
const PNG='iVBORw0KGgoAAAANSUhEUgAAAGQAAABQCAIAAABga0e4AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAuUlEQVR4nO3QoQEAAAiAMP9/Wl+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArP07lnpntGu1Yc0AAAAASUVORK5CYII=';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,limit=3500){
  const cutoff=Date.now()+limit;
  for(;;){const result=await fn();if(result)return result;
    if(Date.now()>cutoff)throw Error('Agent test timed out');
    await sleep(10);}
}
async function fixture(t,planner=null,intercept=()=>{}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cu-agent-mock-'));
  const commands=[];
  const native={ready:Promise.resolve({ready:true,window_id:'12345'}),closed:false,mouseHeld:false,
    stop(){this.closed=true;},
    async request(command){
      commands.push(command);
      if(command.action==='observe')return {width:100,height:80,geometry:[10,20,110,100],
        displays:[{x:0,y:0,width:1400,height:900}],png:PNG};
      const error=intercept(command);
      if(error)throw error;
      return {ok:true,foreground:true};
    }
  };
  t.after(()=>{native.closed=true;fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:30});});
  const service=new WindowsComputerUse({platform:'win32',connect:()=>native,
    agentPlanner:planner,agentDirectory:dir,taskRetryMs:10,idleTimeoutMs:10000});
  const session=(await service.call({action:'open_session',window_id:'12345'})).structuredContent.session_id;
  await until(async()=>((await service.call({action:'get_session'})).structuredContent.state==='ready'));
  const obs=await service.call({action:'observe',session_id:session});
  assert.equal(obs.isError,undefined);
  const start=(key='stable',goal='click and fill a form')=>service.call({action:'start_task',
    session_id:session,observation_id:obs.structuredContent.observation_id,goal,idempotency_key:key});
  const get=id=>service.call({action:'get_task',session_id:session,task_id:id});
  const submit=(id,decisionId,decision)=>service.call({action:'submit_task_decision',
    session_id:session,task_id:id,decision_id:decisionId,decision_json:JSON.stringify(decision)});
  const cancel=id=>service.call({action:'cancel_task',session_id:session,task_id:id});
  return {service,session,native,commands,dir,start,get,submit,cancel};
}

test('common Mac/Windows tool contract exposes generic GUI task actions, not a window-only API',()=>{
  for(const d of [win,mac])for(const action of ['start_task','get_task','cancel_task','submit_task_decision'])
    assert.ok(d.inputSchema.properties.action.enum.includes(action));
});
test('a pluggable dynamic planner autonomously does click, type, key and verifies via a final fresh observation',async t=>{
  const seen=[];
  const actions=[
    {action:{action:'click',x:21,y:27}},
    {action:{action:'type_text',text:'hello'}},
    {action:{action:'key_press',key:'ENTER'}},
    {done:true}
  ];
  const f=await fixture(t,async ctx=>{seen.push({step:ctx.step,goal:ctx.goal,error:ctx.last_error});return actions[ctx.step];});
  const started=(await f.start()).structuredContent;
  const finished=await until(async()=>{
    const r=(await f.get(started.task_id)).structuredContent;return r.state==='succeeded'&&r;
  });
  assert.equal(finished.completed_steps,3);
  assert.deepEqual(f.commands.filter(x=>['click','type_text','key_press'].includes(x.action)).map(x=>x.action),['click','type_text','key_press']);
  assert.ok(f.commands.filter(x=>x.action==='observe').length>=4);
  assert.equal(f.native.closed,true);
  assert.deepEqual(seen.map(x=>x.step),[0,1,2,3]);
  const persisted=fs.readFileSync(path.join(f.dir,started.task_id+'.json'),'utf8');
  assert.doesNotMatch(persisted,/hello|click and fill a form|\"text\"/);
  const replay=await f.service.call({action:'start_task',session_id:f.session,
    observation_id:'expired-id',goal:'click and fill a form',idempotency_key:'stable'});
  assert.equal(replay.structuredContent.reused,true);
});
test('without an installed planner agent stays awaiting_decision and accepts authenticated one-step decisions',async t=>{
  const f=await fixture(t);
  const record=(await f.start()).structuredContent;
  const pending=await until(async()=>{
    const r=await f.get(record.task_id);return r.structuredContent.state==='awaiting_decision'?r:null;
  });
  assert.ok(pending.content.some(x=>x.type==='image'));
  const first=pending.structuredContent.decision_id;
  const rejected=await f.submit(record.task_id,'outdated',{action:{action:'click',x:20,y:18}});
  assert.equal(rejected.structuredContent.code,'CU_STALE_DECISION');
  const disallowed=await f.submit(record.task_id,first,{action:{action:'close_session'}});
  assert.equal(disallowed.structuredContent.code,'CU_INVALID_DECISION');
  assert.equal(f.commands.filter(c=>c.action==='click').length,0);
  assert.equal((await f.submit(record.task_id,first,{action:{action:'click',x:20,y:18}})).structuredContent.accepted,true);
  const second=await until(async()=>{
    const r=(await f.get(record.task_id)).structuredContent;
    return r.state==='awaiting_decision' && r.decision_id!==first?r:null;
  });
  assert.equal(second.completed_steps,1);
  const stale=await f.submit(record.task_id,first,{done:true});
  assert.equal(stale.structuredContent.code,'CU_STALE_DECISION');
  await f.submit(record.task_id,second.decision_id,{done:true});
  await until(async()=>((await f.get(record.task_id)).structuredContent.state==='succeeded'));
  assert.equal(f.commands.filter(c=>c.action==='click').length,1);
});
test('recoverable native collision causes replanning after observing; no fixed retry cap',async t=>{
  let failed=0;
  const f=await fixture(t,async ({step})=>step===0?
    {action:{action:'click',x:25,y:20}}:{done:true},cmd=>{
      if(cmd.action==='click' && failed++<4)
        return Object.assign(Error('CU_USER_INPUT_ACTIVE'),{code:'CU_USER_INPUT_ACTIVE',inputStarted:false});
      return null;
    });
  const task=(await f.start()).structuredContent;
  const end=await until(async()=>{
    const s=(await f.get(task.task_id)).structuredContent;
    return s.state==='succeeded'?s:null;
  });
  assert.equal(end.completed_steps,1);
  assert.equal(f.commands.filter(c=>c.action==='click').length,5);
  assert.ok(f.commands.filter(c=>c.action==='observe').length>=6);
});
test('cancelling while awaiting a decision releases the native session and leaves a terminal record',async t=>{
  const f=await fixture(t);
  const task=(await f.start()).structuredContent;
  const p=await until(async()=>{
    const r=(await f.get(task.task_id)).structuredContent;
    return r.state==='awaiting_decision'?r:null;
  });
  assert.equal((await f.cancel(task.task_id)).structuredContent.state,'cancelled');
  assert.equal(f.native.closed,true);
  const stale=await f.submit(task.task_id,p.decision_id,{action:{action:'click',x:1,y:1}});
  assert.equal(stale.structuredContent.code,'CU_STALE_DECISION');
  assert.equal(f.commands.some(c=>c.action==='click'),false);
});
test('unknown injected input stops original session instead of unsafe replay',async t=>{
  const f=await fixture(t,()=>({action:{action:'mouse_down',x:25,y:20}}),cmd=>{
    if(cmd.action==='mouse_down')return Object.assign(Error('CU_INPUT_FAILED'),{code:'CU_INPUT_FAILED',inputStarted:true});
    return null;
  });
  const task=(await f.start()).structuredContent;
  const end=await until(async()=>{
    const r=(await f.get(task.task_id)).structuredContent;
    return r.state==='session_terminated'?r:null;
  });
  assert.equal(end.state,'session_terminated');
  assert.equal(f.commands.filter(c=>c.action==='mouse_down').length,1);
  assert.equal(f.native.closed,true);
});
test('restarted agent reads interrupted checkpoint without reattaching to a native window',async t=>{
  const f=await fixture(t);
  const task=(await f.start()).structuredContent;
  await until(async()=>((await f.get(task.task_id)).structuredContent.state==='awaiting_decision'));
  const other=new WindowsComputerUse({platform:'win32',agentDirectory:f.dir,
    connect:()=>{throw Error('Native GUI unexpectedly touched on restart');}});
  const record=(await other.call({action:'get_task',session_id:f.session,task_id:task.task_id})).structuredContent;
  assert.equal(record.state,'interrupted');
  assert.equal(record.reason,'CU_OWNER_RESTARTED');
  await f.cancel(task.task_id);
});
test('planner cannot forge session scope or invoke close_session as an arbitrary action',()=>{
  assert.throws(()=>ComputerUseAgentRunner.validateDecision({action:{action:'click',x:1,y:2,session_id:'other'}}),
    {code:'CU_INVALID_DECISION'});
  assert.throws(()=>ComputerUseAgentRunner.validateDecision({action:{action:'close_session'}}),
    {code:'CU_INVALID_DECISION'});
});

test('expired external decision is rejected before native input and replaced with a fresh observation token',async t=>{
  const f=await fixture(t);
  const started=(await f.start('expiring-decision','inspect the window')).structuredContent;
  const first=await until(async()=>{
    const r=await f.get(started.task_id);
    return r.structuredContent.state==='awaiting_decision'?r:null;
  });
  const firstToken=first.structuredContent.decision_id;
  const internal=f.service.agentRunner.tasks.get(started.task_id);
  internal.observationAt=Date.now()-30000; // Simulate elapsed native observation TTL without sleeping.
  const stale=await f.submit(started.task_id,firstToken,{action:{action:'click',x:15,y:15}});
  assert.equal(stale.structuredContent.code,'CU_STALE_DECISION');
  const next=await until(async()=>{
    const r=await f.get(started.task_id);
    return r.structuredContent.state==='awaiting_decision'&&
      r.structuredContent.decision_id!==firstToken?r:null;
  });
  assert.ok(next.content.some(c=>c.type==='image'));
  assert.equal((await f.submit(started.task_id,firstToken,{done:true})).structuredContent.code,'CU_STALE_DECISION');
  assert.equal(f.commands.filter(c=>c.action==='click').length,0);
  await f.submit(started.task_id,next.structuredContent.decision_id,{done:true});
  await until(async()=>((await f.get(started.task_id)).structuredContent.state==='succeeded'));
});

test('STOP cancels a pending model decision without waiting for a 15-second timeout or executing late input',async t=>{
  let plannerStarted=false,plannerAborted=false;
  const planner=({signal})=>{
    plannerStarted=true;
    return new Promise(resolve=>signal.addEventListener('abort',()=>{
      plannerAborted=true;
      resolve({action:{action:'click',x:20,y:20}}); // Deliberately late input must be ignored.
    },{once:true}));
  };
  const f=await fixture(t,planner);
  const task=(await f.start('stop-pending-model','do something')).structuredContent;
  await until(async()=>plannerStarted);
  const started=Date.now();
  const result=await f.cancel(task.task_id);
  assert.equal(result.structuredContent.state,'cancelled');
  await until(async()=>plannerAborted);
  assert.ok(Date.now()-started<1000);
  await sleep(50);
  assert.equal(f.native.closed,true);
  assert.equal(f.commands.filter(c=>c.action==='click').length,0);
});
