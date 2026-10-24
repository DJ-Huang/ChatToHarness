'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {preparePlannerObservation,mapImageDecision,materialize,encodeSample}=require('../app/computer-use-planner-images.cjs');
const {snapshot,readChunk}=require('../app/computer-use-images.cjs');

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function chunkFixture(bytes,overrides={}){
  const capture=snapshot({bytes,mime_type:'image/png'},'chunked');
  const structuredContent={session_id:'authorized',observation_id:'fresh',
    width:100,height:80,window_bounds:{x:10,y:10,width:100,height:80},
    screenshot:{...capture.metadata}};
  const shot={structuredContent,content:[]};
  const calls=[];
  const service={async call(args){
    calls.push(args);
    const data=readChunk(capture,args.screenshot_id,args.offset,args.length);
    const transformed=overrides.modify?overrides.modify(data):data;
    return {structuredContent:{screenshot:transformed}};
  }};
  return {capture,shot,service,calls};
}
test('chunked observation is rebuilt in memory from scoped read_screenshot with full and per-chunk SHA',async()=>{
  const bytes=Buffer.from('89504e470d0a1a0a'+ 'f'.repeat(2500),'hex');
  const {shot,service,calls}=chunkFixture(bytes);
  const merged=await materialize(shot,service,'authorized');
  assert.deepEqual(merged,bytes);
  assert.equal(calls.length,1);
  assert.equal(calls[0].action,'read_screenshot');
  assert.equal(calls[0].session_id,'authorized');
  assert.equal(calls[0].screenshot_id,shot.structuredContent.screenshot.screenshot_id);
  assert.equal(hash(merged),shot.structuredContent.screenshot.sha256);
});
test('chunked screenshot integrity mismatch is rejected without model call',async()=>{
  const bytes=crypto.randomBytes(512*1024+11);
  const {shot,service}=chunkFixture(bytes,{modify:d=>({...d,chunk_sha256:'0'.repeat(64)})});
  await assert.rejects(()=>materialize(shot,service,'authorized'),{code:'CU_PLANNER_CAPTURE_INTEGRITY'});
});
test('abort before chunk read prevents any request or desktop interaction',async()=>{
  const {shot,service,calls}=chunkFixture(Buffer.alloc(800,3));
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>materialize(shot,service,'authorized',controller.signal),{code:'CU_PLANNER_CANCELLED'});
  assert.equal(calls.length,0);
});
test('out-of-order chunk and truncated/base64-tampered payload are rejected',async()=>{
  const bytes=crypto.randomBytes(512*1024+5);
  for(const modify of [d=>({...d,offset:d.offset+1}),d=>({...d,data:d.data.slice(0,-4)})]){
    const {shot,service}=chunkFixture(bytes,{modify});
    await assert.rejects(()=>materialize(shot,service,'authorized'),{code:'CU_PLANNER_CAPTURE_INTEGRITY'});
  }
});
test('planner-image coordinate mapping converts preview image clicks to original native screenshot',()=>{
  const observation={structuredContent:{planner_image:{
    width:1000,height:600,original_width:2000,original_height:1200,
    coordinate_scale_x:2,coordinate_scale_y:2
  }}};
  const mapped=mapImageDecision({action:{action:'click',x:234,y:155}},observation);
  assert.deepEqual(mapped,{action:{action:'click',x:468,y:310}});
  assert.deepEqual(mapImageDecision({done:true},observation),{done:true});
  assert.throws(()=>mapImageDecision({action:{action:'click',x:1001,y:2}},observation),
    {code:'CU_INVALID_DECISION'});
});
test('forced chunked valid screenshot becomes bounded inline model image and retains native coordinates',async()=>{
  // Tiny, valid PNG that is explicitly delivered as chunked, without native input.
  const sharp=require('sharp');
  const bytes=await sharp({create:{width:100,height:80,channels:3,background:'#123456'}}).png().toBuffer();
  const {shot,service}=chunkFixture(bytes);
  const prepared=await preparePlannerObservation(shot,service,'authorized');
  assert.equal(prepared.structuredContent.screenshot.delivery,'inline');
  assert.equal(prepared.structuredContent.screenshot.mime_type,'image/png');
  assert.equal(prepared.content.find(x=>x.type==='image').data,bytes.toString('base64'));
  assert.equal(prepared.structuredContent.observation_id,'fresh');
  assert.deepEqual(prepared.structuredContent.planner_image,{
    width:100,height:80,original_width:100,original_height:80,
    coordinate_scale_x:1,coordinate_scale_y:1
  });
});

test('large synthetic screenshot is safely reduced for model sampling with explicit coordinate mapping',async()=>{
  const sharp=require('sharp');
  const width=2400,height=1600;
  const raw=crypto.randomBytes(width*height*3);
  const original=await sharp(raw,{raw:{width,height,channels:3}})
    .png({compressionLevel:0}).toBuffer();
  assert.ok(original.toString('base64').length>1500000);
  const sampled=await encodeSample(original,'image/png',width,height);
  assert.equal(sampled.mimeType,'image/jpeg');
  assert.ok(sampled.bytes.toString('base64').length<=1500000);
  assert.ok(sampled.width<=width&&sampled.height<=height);
  assert.ok(sampled.width>0&&sampled.height>0);
  const coords=mapImageDecision({action:{action:'click',
    x:Math.floor(sampled.width/2),y:Math.floor(sampled.height/2)}},
    {structuredContent:{planner_image:{width:sampled.width,height:sampled.height,
      original_width:width,original_height:height,
      coordinate_scale_x:width/sampled.width,coordinate_scale_y:height/sampled.height}}});
  assert.ok(Math.abs(coords.action.x-width/2)<=2);
  assert.ok(Math.abs(coords.action.y-height/2)<=2);
});
