'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {dispatchSite}=require('../scripts/dispatch-site.cjs');
const options={repo:'example/project',tag:'v0.6.1',requestId:'123-2',report:()=>{}};
test('release deployment dispatches main with the required release and waits for its exact run',async()=>{
  const calls=[],watched=[];let lists=0,waits=0;
  const run={id:42,event:'workflow_dispatch',head_branch:'main',display_title:'Website deploy 123-2'};
  const result=await dispatchSite({...options,request:async(route,body)=>{calls.push({route,body});return body?null:{workflow_runs:++lists===1?[{...run,id:99,display_title:'Website deploy 123-1'}]:[run]};},wait:async()=>{waits++;},watch:async(...args)=>watched.push(args)});
  assert.deepEqual(calls[0].body,{ref:'main',inputs:{release_tag:'v0.6.1',deployment_request:'123-2'}});
  assert.deepEqual(watched,[['example/project',42]]);assert.equal(waits,1);assert.equal(result.id,42);
});
test('a failed independent deployment still fails the release caller',async()=>{
  await assert.rejects(dispatchSite({...options,request:async(_route,body)=>body?null:{workflow_runs:[{id:42,event:'workflow_dispatch',head_branch:'main',display_title:'Website deploy 123-2'}]},watch:async()=>{throw new Error('Production verification failed');}}),/Production verification failed/);
});
test('missing and unrelated runs cannot be mistaken for a successful website deployment',async()=>{
  let watches=0;
  await assert.rejects(dispatchSite({...options,attempts:2,request:async(_route,body)=>body?null:{workflow_runs:[{id:42,event:'push',head_branch:'main',display_title:'Website deploy 123-2'}]},wait:async()=>{},watch:async()=>{watches++;}}),/was not found/);
  assert.equal(watches,0);
});
test('invalid release input is rejected before dispatch and deleted releases may resolve latest stable',async()=>{
  let calls=0;
  await assert.rejects(dispatchSite({...options,tag:'v0.6.1;command',request:async()=>{calls++;}}),/Invalid/);assert.equal(calls,0);
  await dispatchSite({...options,tag:'',request:async(_route,body)=>{if(body){assert.equal(body.inputs.release_tag,'');return null;}return {workflow_runs:[{id:42,event:'workflow_dispatch',head_branch:'main',display_title:'Website deploy 123-2'}]};},watch:async()=>{}});
});
