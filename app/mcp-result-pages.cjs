'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {MAX_MESSAGE_BYTES} = require('./mcp-transport.cjs');

// This is a delivery budget, not a claimed ChatGPT attachment threshold.
const INLINE_BYTES = 16 * 1024;
const PAGE_BYTES = 4096;
const ID = /^result_[a-f0-9]{32}$/;
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const pageSchema = {type:'object',properties:{kind:{const:'harness_result_page'},result_id:{type:'string'},text:{type:'string'}},required:['kind','result_id','text'],additionalProperties:true};
const summarySchema = {type:'object',properties:{kind:{const:'harness_result_summary'},result_id:{type:'string'},preview:{type:'object'},complete:{const:false},guidance_complete:{type:'boolean'},requires_full_guidance:{type:'boolean'}},required:['kind','result_id','preview','complete','guidance_complete','requires_full_guidance'],additionalProperties:true};
const hints = {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
const TOOLS = [
  {name:'get_tool_result_page',description:'Read a saved tool result without executing the original tool again. Concatenate text pages in offset order, then parse the JSON. Offsets count UTF-8 bytes. Read all guidance pages before retrying a write. Snapshots survive reconnects and application restarts; current source permissions still apply.',
    inputSchema:{type:'object',properties:{result_id:{type:'string',pattern:ID.source},offset:{type:'integer',minimum:0},length:{type:'integer',minimum:4,maximum:PAGE_BYTES}},required:['result_id'],additionalProperties:false},outputSchema:pageSchema,annotations:hints},
  {name:'get_tool_result_file',description:'Explicitly deliver one deferred native image, audio, embedded resource or resource link from a saved result. Use its file_index from a $harness_file reference. This can request file consent in the chat client. Does not execute the original tool again.',
    inputSchema:{type:'object',properties:{result_id:{type:'string',pattern:ID.source},file_index:{type:'integer',minimum:0}},required:['result_id','file_index'],additionalProperties:false},annotations:hints}
];
function response(value, extra={}) {return {...extra,content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};}
function problem(code,message) {return Object.assign(new Error(message),{code});}

// Rebase document-local refs when nesting a schema; an explicit $id establishes
// its own resource and must retain its original reference resolution rules.
function nestSchema(value, local=true) {
  if(Array.isArray(value))return value.map(item=>nestSchema(item,local));
  if(!value||typeof value!=='object')return value;
  if(value.$id)local=false;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
    key==='$ref'&&local&&typeof item==='string'&&(item==='#'||item.startsWith('#/'))
      ? `#/$defs/harness_original${item.slice(1)}` : nestSchema(item,local)]));
}
function decorateTool(tool) {
  if(!tool.outputSchema)return tool;
  return {...tool,outputSchema:{type:'object',$defs:{harness_original:nestSchema(tool.outputSchema)},anyOf:[{$ref:'#/$defs/harness_original'},pageSchema,summarySchema]}};
}
const guidanceFields=new Set(['project_context_token','project_context_tokens','contexts','project_contexts','guidance','agents','loaded_rules','loaded_skills','retry_patch']);
function containsGuidance(value) {
  if(!value||typeof value!=='object')return false;
  if(Array.isArray(value))return value.some(containsGuidance);
  if(value.reused===true)return false;
  return Object.entries(value).some(([key,item])=>key==='project_context_token'&&typeof item==='string'||['agents','loaded_rules','loaded_skills'].includes(key)&&Array.isArray(item)&&item.length>0||containsGuidance(item));
}
function boundedPreview(result) {
  const source=result.structuredContent&&typeof result.structuredContent==='object'&&!Array.isArray(result.structuredContent)?result.structuredContent:{};
  let remaining=4500;
  function visit(value,depth=0) {
    if(remaining<=0||depth>4)return undefined;
    if(typeof value==='string'){const text=value.slice(0,Math.min(1024,remaining));remaining-=text.length;return text;}
    if(value===null||typeof value==='boolean'||typeof value==='number')return value;
    if(Array.isArray(value))return value.slice(0,5).map(item=>visit(item,depth+1)).filter(item=>item!==undefined);
    if(value&&typeof value==='object') {
      const output={};for(const [key,item]of Object.entries(value).slice(0,40)) {
        if(guidanceFields.has(key)||['_meta','_harness_result','data','blob','base64'].includes(key))continue;
        const preview=visit(item,depth+1);if(preview!==undefined)output[key]=preview;
      }return output;
    }
    return undefined;
  }
  const preview=visit(source)||{};
  if(!Object.keys(preview).length){const blocks=source._harness_result?.content||(!Object.keys(source).length?result.content:[]);const text=blocks?.find(block=>block.type==='text')?.text;if(text)preview.text=text.slice(0,2048);}
  return preview;
}
function fileBlock(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  if((value.type==='image'||value.type==='audio')&&typeof value.data==='string'&&typeof value.mimeType==='string')return value;
  if(value.type==='resource'&&value.resource?.uri)return value;
  if(value.type==='resource_link'&&typeof value.uri==='string')return value;
  // Resources also occur in structured resource-read results without a block wrapper.
  if(typeof value.uri==='string'&&typeof value.mimeType==='string'&&(typeof value.blob==='string'||typeof value.text==='string'))return {type:'resource',resource:value};
  return null;
}
function project(result) {
  const files=[],seen=new Map();
  function visit(value) {
    const block=fileBlock(value);
    if(block){
      const key=digest(JSON.stringify(block));let index=seen.get(key);
      if(index===undefined){index=files.length;seen.set(key,index);files.push(block);}
      const resource=block.resource||block;
      return {$harness_file:{file_index:index,type:block.type,...(resource.mimeType?{mime_type:resource.mimeType}:{}),...(resource.name?{name:String(resource.name).slice(0,256)}:{})}};
    }
    if(Array.isArray(value))return value.map(visit);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,visit(item)]));
    return value;
  }
  // Client-only metadata remains private, including when reading saved pages.
  const {_meta,...publicResult}=result;
  return {text:JSON.stringify(visit(publicResult)),files};
}

class McpResultPages {
  constructor({directory,authorize=()=>true,log=()=>{}}={}) {
    this.directory=directory;this.temporary=!directory;this.authorize=authorize;this.log=log;
  }
  tools(){return TOOLS;}
  has(name){return TOOLS.some(tool=>tool.name===name);}
  async storage() {
    if(!this.ready)this.ready=(async()=>{
      if(!this.directory)this.directory=await fs.mkdtemp(path.join(os.tmpdir(),'cth-results-'));
      await fs.mkdir(this.directory,{recursive:true,mode:0o700});
      const stat=await fs.lstat(this.directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw problem('MCP_RESULT_STORAGE_UNAVAILABLE','Result storage must be a private directory.');
      await fs.chmod(this.directory,0o700);return this.directory;
    })().catch(error=>{this.ready=null;throw error;});
    return this.ready;
  }
  async deliver(result,source,{explicitFiles=false,knownBuiltin=false}={}) {
    if(!result||typeof result!=='object')return result;
    const projected=project(result);
    if((explicitFiles||!projected.files.length)&&Buffer.byteLength(JSON.stringify(result))<=INLINE_BYTES)return result;
    // An explicit artifact preview retains the existing native delivery format.
    if(explicitFiles&&projected.files.length)return result;
    const result_id=`result_${crypto.randomBytes(16).toString('hex')}`;
    const record={version:1,result_id,source,result};
    try{
      const directory=await this.storage();
      await fs.writeFile(path.join(directory,`${result_id}.json`),JSON.stringify(record),{flag:'wx',mode:0o600});
      return knownBuiltin?this.summary(record,projected):this.page(record,projected,{});
    }catch{
      // A completed mutation must never be hidden or replayed if disk storage fails.
      this.log('mcp-result-delivery',{state:'storage_failed',fallback:'original_result'});return result;
    }
  }
  summary(record,projected) {
    const guidance=containsGuidance(record.result.structuredContent),preview=boundedPreview(record.result);
    const value={kind:'harness_result_summary',result_id:record.result_id,source_tool:record.source.tool,preview,
      complete:false,guidance_complete:!guidance,requires_full_guidance:guidance,total_bytes:Buffer.byteLength(projected.text),file_count:projected.files.length,
      source_is_error:record.result.isError===true,
      next_action:guidance?'This preview omits project instructions. Read every get_tool_result_page from offset 0, concatenate the JSON, and read all guidance before retrying a write. Do not reuse a token from a partial result or rerun the source operation.':'Use this preview when sufficient. Read get_tool_result_page from offset 0 only for full details; do not rerun the source operation. Use get_tool_result_file only when a referenced file is needed.'};
    const make=()=>({...(record.result.isError===undefined?{}:{isError:record.result.isError}),...(record.result._meta?{_meta:record.result._meta}:{}),content:[{type:'text',text:`Saved ${record.source.tool} result. ${guidance?'Full project guidance must be read before a write.':'A bounded preview is available in structuredContent.'}`}],structuredContent:value});
    let output=make();
    // Escape-heavy text can exceed a byte budget despite a character limit.
    // Drop the longest preview field rather than returning raw JSON fragments.
    while(Buffer.byteLength(JSON.stringify({...output,_meta:undefined}))>INLINE_BYTES&&Object.keys(preview).length) {
      const largest=Object.keys(preview).sort((a,b)=>JSON.stringify(preview[b]).length-JSON.stringify(preview[a]).length)[0];delete preview[largest];output=make();
    }
    return output;
  }
  page(record,projected,args) {
    const bytes=Buffer.from(projected.text),offset=args.offset??0,length=args.length??PAGE_BYTES;
    if(!Number.isSafeInteger(offset)||offset<0||offset>bytes.length||!Number.isSafeInteger(length)||length<4||length>PAGE_BYTES||
      (offset<bytes.length&&(bytes[offset]&0xc0)===0x80))throw problem('MCP_INVALID_ARGUMENTS','Use the returned next_offset and a length between 4 and 4096 bytes.');
    let end=Math.min(offset+length,bytes.length);
    const make=()=>{
      const value={kind:'harness_result_page',result_id:record.result_id,source_tool:record.source.tool,format:'json',offset,next_offset:end,total_bytes:bytes.length,sha256:digest(bytes),
        text:bytes.subarray(offset,end).toString('utf8'),has_more:end<bytes.length,file_count:projected.files.length,
        source_is_error:record.result.isError===true,
        next_action:end<bytes.length?'Read get_tool_result_page with result_id and next_offset as offset; concatenate text pages before interpreting the result. Do not rerun the source tool.':'Parse the concatenated JSON. Use get_tool_result_file only when a referenced file is needed.'};
      return response(value,{...(record.result.isError===undefined?{}:{isError:record.result.isError}),...(record.result._meta?{_meta:record.result._meta}:{})});
    };
    let output;
    do{
      while(end<bytes.length&&(bytes[end]&0xc0)===0x80)--end;
      output=make();
      // Metadata belongs to the client/UI, and is never copied into model pages.
      const {_meta,...publicOutput}=output;
      if(Buffer.byteLength(JSON.stringify(publicOutput))<=INLINE_BYTES)break;
      end=offset+Math.floor((end-offset)/2);
    }while(end>offset);
    if(end===offset&&offset<bytes.length)throw problem('MCP_RESULT_PAGE_TOO_LARGE','The result page metadata exceeds its delivery budget.');
    return output;
  }
  async load(result_id) {
    if(typeof result_id!=='string'||!ID.test(result_id))throw problem('MCP_INVALID_ARGUMENTS','Pass a result_id returned by a paged tool result.');
    let record;
    try{
      const file=await fs.open(path.join(await this.storage(),`${result_id}.json`),'r');
      try{const stat=await file.stat();if(!stat.isFile()||stat.size>MAX_MESSAGE_BYTES+65536)throw new Error();record=JSON.parse(await file.readFile('utf8'));}finally{await file.close();}
    }catch{throw problem('MCP_RESULT_UNAVAILABLE','This saved result is unavailable. Inspect the original operation state; do not automatically replay a mutation.');}
    if(record.version!==1||record.result_id!==result_id||!record.result||!record.source||!await this.authorize(record.source))throw problem('MCP_RESULT_DENIED','The source tool or its authorized folders changed or are no longer available.');
    return record;
  }
  async call(name,args={}) {
    try{
      if(!args||typeof args!=='object'||Array.isArray(args))throw problem('MCP_INVALID_ARGUMENTS','Pass result arguments as an object.');
      const record=await this.load(args.result_id),projected=project(record.result);
      if(name==='get_tool_result_page')return this.page(record,projected,args);
      if(name!=='get_tool_result_file'||!Number.isSafeInteger(args.file_index)||args.file_index<0||args.file_index>=projected.files.length)throw problem('MCP_INVALID_ARGUMENTS','Choose a file_index from a $harness_file reference.');
      return {content:[projected.files[args.file_index]],...(record.result._meta?{_meta:record.result._meta}:{})};
    }catch(error){return response({code:error.code||'MCP_RESULT_UNAVAILABLE',message:error.code?error.message:'The saved result could not be read.',next_action:'Check the result ID and source permissions. Do not automatically replay the original operation.'},{isError:true});}
  }
  async close(){if(this.temporary&&this.directory)await fs.rm(this.directory,{recursive:true,force:true});}
}
module.exports={McpResultPages,INLINE_BYTES,PAGE_BYTES,decorateTool,project};
