'use strict';
// Exercise the shipped Tunnel binary against a rejecting loopback fixture.
// This checks CLI compatibility without contacting OpenAI or using real keys.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {RuntimeManager,stopTree}=require('../app/runtime.cjs');
const {spawnManaged,tunnelCommand}=require('../app/platform.cjs');
async function main(){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'localharness-tunnel-config-'));
 const manager=new RuntimeManager({home,resources:path.resolve(__dirname,'..','resources')});let child,hits=0,lines='';
 const server=http.createServer((_req,res)=>{hits++;res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:'invalid_api_key',message:'Synthetic fixture rejection'}}));});
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));manager.prepare({directories:[home]});
  const args=['run','--control-plane.tunnel-id','tunnel_'+'a'.repeat(32),'--control-plane.api-key','env:CONTROL_PLANE_API_KEY','--control-plane.base-url','http://127.0.0.1:'+server.address().port,'--mcp.command',tunnelCommand([manager.paths.node,manager.launcher,manager.paths.desktopCommander,String(process.pid)]),'--mcp.stdio-send-initialized-notification','--health.listen-addr','127.0.0.1:0','--health.url-file',manager.healthFile,'--log.format','json'];
  child=spawnManaged(manager.paths.tunnel,args,{processHost:manager.paths.processHost,env:{...manager.childEnvironment(),CONTROL_PLANE_API_KEY:'synthetic-fixture-key'},cwd:home,stdio:['ignore','pipe','pipe']});
  for(const stream of[child.stdout,child.stderr])stream.on('data',part=>lines=(lines+part).slice(-16000));
  for(let attempt=0;attempt<60&&!hits&&child.exitCode===null;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(hits>0,'Runtime did not accept configuration: '+lines);assert.ok(fs.existsSync(manager.healthFile));
  console.log(JSON.stringify({realTunnelRuntime:true,stdioCommandAccepted:true,healthEndpoint:true,localControlPlaneRequests:hits,externalOpenAIContact:false}));
 }finally{await stopTree(child);await manager.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(home,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
