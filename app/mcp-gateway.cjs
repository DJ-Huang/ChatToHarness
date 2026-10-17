'use strict';
const {version: appVersion} = require('../package.json');

const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {Server} = require('@modelcontextprotocol/sdk/server/index.js');
const {ListToolsRequestSchema,CallToolRequestSchema,McpError,ErrorCode} = require('@modelcontextprotocol/sdk/types.js');
const {LineTransport} = require('./mcp-transport.cjs');

// No TCP listener or public configuration endpoint. Each app run owns a fresh
// Unix socket / Windows named pipe, authenticated before any MCP bytes parse.
class McpGateway {
  constructor(manager) {
    this.manager=manager;this.sessions=new Set();this.initializedSessions=new WeakSet();this.sockets=new Set();this.epoch=0;
    this.changed=()=>{for(const session of this.sessions)if(this.initializedSessions.has(session))void session.notification({method:'notifications/tools/list_changed'}).catch(()=>{});};
    manager.on('toolsChanged',this.changed);
  }
  async start() {
    if(this.starting)return this.starting;
    if(this.server)return;
    const epoch=this.epoch;
    this.starting=(async()=>{
      const token=crypto.randomBytes(32).toString('hex');let directory,endpoint,server;
      if(process.platform==='win32')endpoint=`\\\\.\\pipe\\cth-mcp-${process.pid}-${crypto.randomBytes(16).toString('hex')}`;
      else{
        directory=fs.mkdtempSync(path.join(os.tmpdir(),'cth-mcp-'));fs.chmodSync(directory,0o700);
        endpoint=path.join(directory,'gateway.sock');
      }
      try{
        server=net.createServer(socket=>this.accept(socket));
        await new Promise((resolve,reject)=>{
          const fail=error=>{server.off('listening',ready);reject(error);};
          const ready=()=>{server.off('error',fail);resolve();};
          server.once('error',fail);server.once('listening',ready);server.listen(endpoint);
        });
        if(process.platform!=='win32')fs.chmodSync(endpoint,0o600);
        server.on('error',()=>{});
        if(epoch!==this.epoch){await new Promise(resolve=>server.close(resolve));if(directory)fs.rmSync(directory,{recursive:true,force:true});return;}
        Object.assign(this,{server,directory,endpoint,token});
      }catch{
        if(server?.listening)await new Promise(resolve=>server.close(resolve));
        if(directory)fs.rmSync(directory,{recursive:true,force:true});
        throw new Error('MCP_GATEWAY_UNAVAILABLE');
      }
    })().finally(()=>{this.starting=null;});
    return this.starting;
  }
  environment() {
    if(!this.server?.listening||!this.token)throw new Error('MCP_GATEWAY_UNAVAILABLE');
    return {CTH_GATEWAY_ENDPOINT:this.endpoint,CTH_GATEWAY_TOKEN:this.token,CTH_GATEWAY_OWNER:String(process.pid)};
  }
  accept(socket) {
    if(this.sockets.size>=32){socket.destroy();return;}
    this.sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>this.sockets.delete(socket));
    let buffer=Buffer.alloc(0);
    const timer=setTimeout(()=>socket.destroy(),5000);timer.unref?.();
    const authenticate=chunk=>{
      buffer=Buffer.concat([buffer,chunk]);const end=buffer.indexOf(10);
      if((end<0&&buffer.length>512)||end>512){socket.destroy();return;}
      if(end<0)return;
      socket.pause();socket.off('data',authenticate);clearTimeout(timer);
      let supplied;
      try{supplied=JSON.parse(buffer.subarray(0,end).toString('utf8')).token;}catch{}
      const expected=Buffer.from(this.token||''),provided=Buffer.from(typeof supplied==='string'?supplied:'');
      if(!expected.length||expected.length!==provided.length||!crypto.timingSafeEqual(expected,provided)){socket.destroy();return;}
      const remaining=buffer.subarray(end+1);buffer=Buffer.alloc(0);if(remaining.length)socket.unshift(remaining);
      socket.write('{"ready":true}\n');
      const transport=new LineTransport(socket,socket,{close:async()=>socket.destroy()});
      const server=new Server({name:'ChatToHarness',version:appVersion},{capabilities:{tools:{listChanged:true}},instructions:'ChatToHarness provides authorized local tools and configured MCP extensions. Tool access is managed in the desktop application. Interrupted calls are never automatically replayed.'});
      this.sessions.add(server);
      server.oninitialized=()=>this.initializedSessions.add(server);
      server.onerror=()=>{};server.onclose=()=>this.sessions.delete(server);
      server.setRequestHandler(ListToolsRequestSchema,request=>{
        try{return this.manager.listTools(request.params?.cursor);}catch{throw new McpError(ErrorCode.InvalidParams,'MCP_CURSOR_EXPIRED');}
      });
      server.setRequestHandler(CallToolRequestSchema,(request,extra)=>this.manager.call(request.params.name,request.params.arguments||{},
        {signal:extra.signal,onprogress:progress=>{
          const token=request.params._meta?.progressToken;
          if(token!==undefined)void server.notification({method:'notifications/progress',params:{...progress,progressToken:token}}).catch(()=>{});
        }}));
      void server.connect(transport).catch(()=>{this.sessions.delete(server);socket.destroy();});
    };
    socket.on('data',authenticate);socket.once('close',()=>clearTimeout(timer));
  }
  async stop() {
    ++this.epoch;
    await this.starting?.catch(()=>{});
    const server=this.server;this.server=null;this.token='';
    await Promise.allSettled([...this.sessions].map(session=>session.close()));this.sessions.clear();
    for(const socket of this.sockets)socket.destroy();this.sockets.clear();
    if(server)await new Promise(resolve=>server.close(()=>resolve()));
    if(this.directory)fs.rmSync(this.directory,{recursive:true,force:true});this.directory=null;
  }
  async close(){await this.stop();this.manager.off('toolsChanged',this.changed);}
}

module.exports={McpGateway};
