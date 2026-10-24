'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSamplingPlanner,SYSTEM_PROMPT}=require('../app/computer-use-sampling-planner.cjs');
const input={goal:'Open settings and toggle a switch',step:2,last_action:'click',last_error:null,
  observation:{structuredContent:{
    width:100,height:90,window_bounds:{x:10,y:20,width:100,height:90},
    screenshot:{mime_type:'image/png',data:Buffer.from('mock-image').toString('base64')}
  }}};
test('MCP planner never invokes a client without declared sampling support',async()=>{
  let calls=0;
  const planner=createSamplingPlanner(()=>({
    getClientCapabilities:()=>({}),
    createMessage:()=>{calls++;throw Error('unavailable');}
  }));
  assert.deepEqual(await planner(input),{wait:true});
  assert.equal(calls,0);
});
test('MCP sampling planner sends only the authorized in-memory screenshot and bounded task context',async()=>{
  let params;
  const server={getClientCapabilities:()=>({sampling:{}}),
    async createMessage(p){params=p;return {content:{type:'text',text:'{"action":{"action":"click","x":22,"y":35}}'}};}};
  const result=await createSamplingPlanner(()=>server)(input);
  assert.deepEqual(result,{action:{action:'click',x:22,y:35}});
  assert.equal(params.includeContext,'none');
  assert.equal(params.maxTokens,512);
  assert.equal(params.messages[0].content[1].data,input.observation.structuredContent.screenshot.data);
  assert.equal(params.messages[0].content[1].mimeType,'image/png');
  assert.match(params.messages[0].content[0].text,/Open settings/);
  assert.match(SYSTEM_PROMPT,/untrusted GUI content/);
});
test('MCP sampling planner falls back when client rejects, screenshot is unavailable or response is malformed',async()=>{
  const refused=createSamplingPlanner(()=>({getClientCapabilities:()=>({sampling:{}}),createMessage:async()=>{throw Error('denied');}}));
  assert.deepEqual(await refused(input),{wait:true});
  assert.deepEqual(await refused({...input,observation:{structuredContent:{screenshot:{delivery:'chunked'}}}}),{wait:true});
  const malformed=createSamplingPlanner(()=>({
    getClientCapabilities:()=>({sampling:{}}),
    createMessage:async()=>({content:{type:'text',text:'Not JSON'}})
  }));
  assert.deepEqual(await malformed(input),{wait:true});
});

test('MCP sampling forwards the task cancellation signal to the host request',async()=>{
  const controller=new AbortController();
  let receivedSignal;
  const planner=createSamplingPlanner(()=>({
    getClientCapabilities:()=>({sampling:{}}),
    createMessage:async(_params,options)=>{
      receivedSignal=options?.signal;
      return {content:{type:'text',text:'{"wait":true}'}};
    }
  }));
  assert.deepEqual(await planner({...input,signal:controller.signal}),{wait:true});
  assert.equal(receivedSignal,controller.signal);
});
