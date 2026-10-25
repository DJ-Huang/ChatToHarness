'use strict';

const {serializeMessage, deserializeMessage} = require('@modelcontextprotocol/sdk/shared/stdio.js');
const fs=require('node:fs');
const path=require('node:path');
const {spawnManaged, stopTree, developmentEnvironment} = require('./platform.cjs');

const {MAX_MESSAGE_BYTES} = require('./mcp-limits.cjs');
const MAX_STARTUP_STDERR_BYTES = 8192;
const STARTUP_DIAGNOSTICS = {
  MCP_MODULE_NOT_FOUND: 'A required service module is missing. Repair or reinstall the service components.',
  MCP_FILE_NOT_FOUND: 'A required service executable or file is missing. Check the configured launch path.',
  MCP_ACCESS_DENIED: 'The service cannot access a required executable or file. Check its local permissions.',
  MCP_COMPONENT_INVALID: 'A service component is invalid. Repair or reinstall the service components.',
  MCP_START_FAILED: 'The service process could not start. Check its local configuration and connection status.'
};
// Classify bounded private stderr, then retain only fixed diagnostic text. Error
// bodies may contain credentials, paths or user content and never leave here.
function startupDiagnostic(error, stderr = '') {
  const code = error?.code;
  const text = String(stderr).slice(-MAX_STARTUP_STDERR_BYTES);
  let diagnostic;
  if (Object.hasOwn(STARTUP_DIAGNOSTICS, code)) diagnostic = code;
  else if (['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND'].includes(code) || /Error(?: \[ERR_MODULE_NOT_FOUND\])?: Cannot find (?:module|package) /m.test(text)) diagnostic = 'MCP_MODULE_NOT_FOUND';
  else if (code === 'ENOENT' || /\bENOENT\b[^\r\n]*(?:open|spawn|no such file)/i.test(text)) diagnostic = 'MCP_FILE_NOT_FOUND';
  else if (['EACCES','EPERM'].includes(code) || /\b(?:EACCES|EPERM)\b[^\r\n]*(?:access|permission|denied|open|spawn)/i.test(text)) diagnostic = 'MCP_ACCESS_DENIED';
  else if (/^(?:SyntaxError:|Error \[ERR_(?:INVALID_PACKAGE_CONFIG|UNKNOWN_FILE_EXTENSION)\])/m.test(text)) diagnostic = 'MCP_COMPONENT_INVALID';
  else if (error) diagnostic = 'MCP_START_FAILED';
  return diagnostic ? {code: diagnostic, message: STARTUP_DIAGNOSTICS[diagnostic]} : undefined;
}
const startupFailure = code => Object.assign(new Error(STARTUP_DIAGNOSTICS[code]), {code});
const SAFE_ENVIRONMENT = new Set(['PATH','HOME','USERPROFILE','SYSTEMROOT','WINDIR','COMSPEC','APPDATA','LOCALAPPDATA','TEMP','TMP','TMPDIR','LANG','LC_ALL','LC_CTYPE','PATHEXT']);
function toolEnvironment(source = process.env, additions = {}, nodePath = process.execPath) {
  const env = {};
  for (const [key,value] of Object.entries(source)) if (SAFE_ENVIRONMENT.has(key.toUpperCase())) env[key] = value;
  return {...developmentEnvironment(env,nodePath),...additions};
}
function boundedMessage(message) {
  const data = serializeMessage(message);
  if (Buffer.byteLength(data) > MAX_MESSAGE_BYTES) throw Object.assign(new Error('MCP_MESSAGE_TOO_LARGE'), {code:'MCP_MESSAGE_TOO_LARGE'});
  return data;
}
function resolveLaunch(config,nodePath,platform=process.platform,exists=file=>{try{return fs.statSync(file).isFile();}catch{return false;}}) {
  if(platform!=='win32')return config;
  const paths=path.win32,base=paths.basename(config.command).toLowerCase();
  const bare=!/[/\\]/.test(config.command);
  const absolute=value=>/^(?:[A-Za-z]:[/\\]|\\\\[^\\]+\\[^\\]+)/.test(value);
  const invalid=()=>{throw Object.assign(new Error('MCP_INVALID_CONFIG'),{code:'MCP_INVALID_CONFIG'});};
  if((!bare&&!absolute(config.command))||!absolute(nodePath))invalid();
  // Job Object's CreateProcess intentionally accepts absolute executables only.
  // npm/npx's .cmd launchers are Node scripts; invoke their CLI directly rather
  // than adding cmd.exe interpretation of user-controlled arguments.
  if(bare&&/^node(?:\.exe)?$/.test(base))return {...config,command:nodePath};
  if(/^(?:npm|npx)(?:\.cmd)?$/.test(base)){
    const directory=bare?paths.dirname(nodePath):paths.dirname(config.command);
    const script=paths.join(directory,'node_modules','npm','bin',base.startsWith('npx')?'npx-cli.js':'npm-cli.js');
    if(!exists(script))throw startupFailure('MCP_FILE_NOT_FOUND');
    return {...config,command:nodePath,args:[script,...config.args||[]]};
  }
  if(bare){
    if(paths.extname(base)&&!/^\.(?:exe|com)$/i.test(paths.extname(base)))invalid();
    const environment=config.env||{};
    const search=Object.entries(environment).find(([key])=>key.toUpperCase()==='PATH')?.[1]||'';
    const extensions=paths.extname(base)?['']:['.exe','.com'];
    for(const directory of search.split(';').map(value=>value.replace(/^"|"$/g,''))){
      if(!absolute(directory))continue;
      for(const extension of extensions){const command=paths.join(directory,config.command+extension);if(exists(command))return {...config,command};}
    }
    throw startupFailure('MCP_FILE_NOT_FOUND');
  }
  if(!/\.(?:exe|com)$/i.test(config.command))invalid();
  return config;
}

// Used by the private IPC link as well as supervised stdio. SDK parsing keeps
// the wire format standard; only process ownership and size limits are local.
class LineTransport {
  constructor(input,output,{close=async()=>{},onMessage=()=>{},observeTiming=false}={}) {
    Object.assign(this,{input,output,closer:close,inspect:onMessage,observeTiming});
    this.buffer=Buffer.alloc(0);this.started=false;this.closed=false;
  }
  async start() {
    if(this.started)throw new Error('MCP_TRANSPORT_STARTED');
    this.started=true;
    this.onData=chunk=>{
      try {
        const chunkAt=this.observeTiming?performance.now():undefined;
        if(!this.buffer.length)this.frameAt=chunkAt;
        this.buffer=Buffer.concat([this.buffer,chunk]);
        let end;
        while((end=this.buffer.indexOf(10))!==-1){
          if(end>MAX_MESSAGE_BYTES)throw new Error('MCP_MESSAGE_TOO_LARGE');
          const line=this.buffer.subarray(0,end).toString('utf8').replace(/\r$/,'');this.buffer=this.buffer.subarray(end+1);
          if(!line.trim())continue;
          const parseAt=this.observeTiming?performance.now():undefined;
          const message=deserializeMessage(line);
          const parsedAt=this.observeTiming?performance.now():undefined;
          this.inspect(message,this.observeTiming?{frameMs:parsedAt-this.frameAt,parseMs:parsedAt-parseAt,bytes:end+1}:undefined);this.onmessage?.(message);
          // Remaining frames in this chunk arrived together, even if handling
          // the previous message took time. Never retain request contents.
          this.frameAt=chunkAt;
        }
        if(this.buffer.length>MAX_MESSAGE_BYTES)throw new Error('MCP_MESSAGE_TOO_LARGE');
      }catch(error){this.onerror?.(Object.assign(new Error(error.message==='MCP_MESSAGE_TOO_LARGE'?'MCP_MESSAGE_TOO_LARGE':'MCP_PROTOCOL_INVALID'),{code:error.message==='MCP_MESSAGE_TOO_LARGE'?'MCP_MESSAGE_TOO_LARGE':'MCP_PROTOCOL_INVALID'}));void this.close();}
    };
    this.onEnd=()=>void this.close();this.onStreamError=()=>{this.onerror?.(new Error('MCP_TRANSPORT_CLOSED'));void this.close();};
    this.input.on('data',this.onData);this.input.on('end',this.onEnd);this.input.on('error',this.onStreamError);
    if(this.output!==this.input)this.output.on('error',this.onStreamError);
    this.input.resume();
  }
  async send(message) {
    if(this.closed)throw new Error('MCP_TRANSPORT_CLOSED');
    const data=boundedMessage(message);
    await new Promise((resolve,reject)=>this.output.write(data,error=>error?reject(new Error('MCP_TRANSPORT_CLOSED')):resolve()));
  }
  async close() {
    if(this.closing)return this.closing;
    this.closed=true;
    if(this.onData)this.input.off('data',this.onData);if(this.onEnd)this.input.off('end',this.onEnd);
    // Keep error listeners installed until the streams are destroyed.
    this.buffer=Buffer.alloc(0);
    this.closing=Promise.resolve().then(()=>this.closer()).finally(()=>this.onclose?.());
    return this.closing;
  }
}

class ManagedStdioTransport {
  constructor(config,{processHost,nodePath=process.execPath,onMessage}={}) {Object.assign(this,{config,processHost,nodePath,inspect:onMessage});}
  async start() {
    if(this.child)throw new Error('MCP_TRANSPORT_STARTED');
    const {command,args=[],cwd,env={}}=resolveLaunch(this.config,this.nodePath);
    // The Windows ownership helper deliberately hides native error bodies.
    // Validate explicit local launch paths first so missing/denied components
    // still have an actionable, sanitized cause on either platform.
    try{
      if(path.isAbsolute(command))fs.accessSync(command,fs.constants.R_OK|fs.constants.X_OK);
      if(cwd)fs.accessSync(cwd,fs.constants.R_OK|fs.constants.X_OK);
    }catch(error){const diagnostic=startupDiagnostic(error);this.startupError=diagnostic;throw Object.assign(new Error(diagnostic.message),{code:diagnostic.code});}
    this.child=spawnManaged(command,args,{processHost:this.processHost,cwd:cwd||undefined,env,stdio:['pipe','pipe','pipe'],shell:false});
    this.startupStderr=Buffer.alloc(0);
    this.child.stderr.on('data',chunk=>{
      if(this.initialized||this.startupError)return;
      const data=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
      this.startupStderr=Buffer.concat([this.startupStderr,data.subarray(-MAX_STARTUP_STDERR_BYTES)]).subarray(-MAX_STARTUP_STDERR_BYTES);
    });
    this.line=new LineTransport(this.child.stdout,this.child.stdin,{onMessage:message=>{
      if(message.result?.serverInfo){this.initialized=true;this.startupStderr=Buffer.alloc(0);}
      this.inspect?.(message);
    },close:()=>stopTree(this.child)});
    this.line.onmessage=message=>this.onmessage?.(message);
    this.line.onerror=error=>this.onerror?.(error);
    this.line.onclose=()=>{this.reportStartupError();this.startupStderr=Buffer.alloc(0);this.onclose?.();};
    this.child.on('error',error=>{this.reportStartupError(error);void this.line.close();});
    this.child.once('exit',()=>{this.reportStartupError();void this.line.close();});
    await this.line.start();
  }
  reportStartupError(error) {
    if(this.initialized||this.startupError)return;
    const diagnostic=startupDiagnostic(error,this.startupStderr?.toString('utf8'));
    if(!diagnostic)return;
    this.startupError=diagnostic;this.startupStderr=Buffer.alloc(0);
    this.onerror?.(Object.assign(new Error(diagnostic.message),{code:diagnostic.code}));
  }
  send(message){return this.line.send(message);}
  close(){return this.line?.close()||Promise.resolve();}
}

// Inspect negotiated versions without exposing response bodies or changing them.
function observeTransport(transport,onMessage) {
  const start=transport.start.bind(transport);
  transport.start=async()=>{
    const handler=transport.onmessage;
    transport.onmessage=message=>{onMessage(message);handler?.(message);};
    await start();
  };
  const send=transport.send.bind(transport);
  transport.send=async(message,...args)=>{boundedMessage(message);return send(message,...args);};
  return transport;
}

function boundedFetch(fetcher) {
  return async(input,init={})=>{
    // Explicit destinations only. In particular, never forward static auth
    // headers through a redirect or reuse ambient browser cookies.
    const response=await fetcher(input,{...init,redirect:'error',credentials:'omit'});
    if(!response.body)return response;
    const contentType=response.headers.get('content-type')||'';
    const reader=response.body.getReader();let bytes=0,eventBytes=0,lineBytes=0;
    const body=new ReadableStream({
      async pull(controller){
        try{
          const next=await reader.read();
          if(next.done){controller.close();return;}
          if(contentType.includes('text/event-stream')){
            // Each SSE event is bounded. The aggregate notification stream may
            // live indefinitely; it is not one ever-growing response body.
            for(const byte of next.value){
              ++eventBytes;if(eventBytes>MAX_MESSAGE_BYTES)throw new Error('MCP_MESSAGE_TOO_LARGE');
              if(byte===10){if(lineBytes===0)eventBytes=0;lineBytes=0;}else if(byte!==13)++lineBytes;
            }
          }else{bytes+=next.value.byteLength;if(bytes>MAX_MESSAGE_BYTES)throw new Error('MCP_MESSAGE_TOO_LARGE');}
          controller.enqueue(next.value);
        }catch(error){await reader.cancel().catch(()=>{});controller.error(error);}
      },
      cancel(reason){return reader.cancel(reason);}
    });
    return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  };
}

module.exports={MAX_MESSAGE_BYTES,MAX_STARTUP_STDERR_BYTES,startupDiagnostic,toolEnvironment,boundedMessage,resolveLaunch,LineTransport,ManagedStdioTransport,observeTransport,boundedFetch};
