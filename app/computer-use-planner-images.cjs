'use strict';
const crypto=require('node:crypto');
const sharp=require('sharp');
const {MAX_CAPTURE_BYTES,MAX_CHUNK_BYTES}=require('./computer-use-images.cjs');

const MAX_SAMPLING_BASE64=1500000;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=code=>Object.assign(new Error(code),{code});
const exactBase64=text=>typeof text==='string' && /^[A-Za-z0-9+/]+={0,2}$/.test(text) &&
  Buffer.from(text,'base64').toString('base64')===text;

async function materialize(shot,service,sessionId,signal){
  const meta=shot.structuredContent?.screenshot;
  if(!meta||!Number.isSafeInteger(meta.byte_length)||meta.byte_length<1||
     meta.byte_length>MAX_CAPTURE_BYTES||!meta.screenshot_id||
     !/^[0-9a-f]{64}$/.test(meta.sha256||''))throw fail('CU_PLANNER_CAPTURE_INVALID');
  if(meta.delivery==='inline'){
    if(!exactBase64(meta.data))throw fail('CU_PLANNER_CAPTURE_INVALID');
    const bytes=Buffer.from(meta.data,'base64');
    if(bytes.length!==meta.byte_length||digest(bytes)!==meta.sha256)
      throw fail('CU_PLANNER_CAPTURE_INTEGRITY');
    return bytes;
  }
  if(meta.delivery!=='chunked')throw fail('CU_PLANNER_CAPTURE_INVALID');
  const chunks=[];
  let offset=0;
  while(offset<meta.byte_length){
    if(signal?.aborted)throw fail('CU_PLANNER_CANCELLED');
    const response=await service.call({
      action:'read_screenshot',session_id:sessionId,screenshot_id:meta.screenshot_id,
      offset,length:Math.min(MAX_CHUNK_BYTES,meta.byte_length-offset)
    });
    if(response.isError)throw fail(response.structuredContent?.code||'CU_PLANNER_CAPTURE_UNAVAILABLE');
    const data=response.structuredContent?.screenshot;
    if(!data||!exactBase64(data.data)||data.offset!==offset||
       data.sha256!==meta.sha256||data.screenshot_id!==meta.screenshot_id ||
       data.byte_length!==meta.byte_length)throw fail('CU_PLANNER_CAPTURE_INTEGRITY');
    const bytes=Buffer.from(data.data,'base64');
    if(bytes.length<1||bytes.length!==data.length ||
       data.chunk_sha256!==digest(bytes)||
       data.next_offset!==offset+bytes.length||
       data.eof!==(data.next_offset===meta.byte_length))
      throw fail('CU_PLANNER_CAPTURE_INTEGRITY');
    chunks.push(bytes);
    offset+=bytes.length;
  }
  if(signal?.aborted)throw fail('CU_PLANNER_CANCELLED');
  const merged=Buffer.concat(chunks,meta.byte_length);
  if(merged.length!==meta.byte_length||digest(merged)!==meta.sha256)
    throw fail('CU_PLANNER_CAPTURE_INTEGRITY');
  return merged;
}
async function encodeSample(bytes,mimeType,originalWidth,originalHeight,signal){
  const sourceEncoded=bytes.toString('base64');
  if(sourceEncoded.length<=MAX_SAMPLING_BASE64)
    return {bytes,mimeType,width:originalWidth,height:originalHeight};
  if(!['image/png','image/webp'].includes(mimeType))throw fail('CU_PLANNER_CAPTURE_INVALID');
  // Native observation remains lossless and unmodified. Only the model input is resized.
  // A smaller preview must map click coordinates back to the ORIGINAL screenshot grid.
  for(const width of [2048,1600,1280,1024,768]){
    if(signal?.aborted)throw fail('CU_PLANNER_CANCELLED');
    for(const quality of [82,67]){
      const {data,info}=await sharp(bytes,{limitInputPixels:8388608,failOn:'warning'})
        .resize({width,height:width,fit:'inside',withoutEnlargement:true})
        .jpeg({quality,mozjpeg:true})
        .toBuffer({resolveWithObject:true});
      if(data.toString('base64').length<=MAX_SAMPLING_BASE64)
        return {bytes:data,mimeType:'image/jpeg',width:info.width,height:info.height};
    }
  }
  throw fail('CU_PLANNER_CAPTURE_TOO_LARGE');
}
async function preparePlannerObservation(shot,service,sessionId,signal){
  if(signal?.aborted)throw fail('CU_PLANNER_CANCELLED');
  const meta=shot.structuredContent;
  const original=meta?.screenshot;
  if(!meta||!original||!Number.isInteger(meta.width)||!Number.isInteger(meta.height))
    throw fail('CU_PLANNER_CAPTURE_INVALID');
  // No additional native screenshot capture or privileged operation: use only
  // the last authorized session's one-time screenshot, bounded by its own TTL.
  const bytes=await materialize(shot,service,sessionId,signal);
  const sample=await encodeSample(bytes,original.mime_type,meta.width,meta.height,signal);
  if(signal?.aborted)throw fail('CU_PLANNER_CANCELLED');
  const encoded=sample.bytes.toString('base64');
  const transformed={...meta,
    screenshot:{...original,sha256:digest(sample.bytes),byte_length:sample.bytes.length,
      mime_type:sample.mimeType,delivery:'inline',data:encoded},
    planner_image:{width:sample.width,height:sample.height,
      original_width:meta.width,original_height:meta.height,
      coordinate_scale_x:meta.width/sample.width,
      coordinate_scale_y:meta.height/sample.height}};
  return {...shot,structuredContent:transformed,
    content:[{type:'text',text:JSON.stringify({
      session_id:meta.session_id,observation_id:meta.observation_id,
      planner_image:transformed.planner_image
    })},{type:'image',mimeType:sample.mimeType,data:encoded}]};
}
function mapImageDecision(decision,observation){
  if(!decision?.action)return decision;
  const image=observation?.structuredContent?.planner_image;
  if(!image||image.width===image.original_width&&image.height===image.original_height)
    return decision;
  const action={...decision.action};
  for(const [k,mult,cap] of [['x',image.coordinate_scale_x,image.original_width],
                             ['y',image.coordinate_scale_y,image.original_height]]){
    if(action[k]!==undefined){
      if(!Number.isSafeInteger(action[k])||action[k]<0||action[k]>=image[k==='x'?'width':'height'])
        throw fail('CU_INVALID_DECISION');
      action[k]=Math.min(cap-1,Math.round(action[k]*mult));
    }
  }
  return {action};
}
module.exports={preparePlannerObservation,mapImageDecision,materialize,encodeSample,MAX_SAMPLING_BASE64};
