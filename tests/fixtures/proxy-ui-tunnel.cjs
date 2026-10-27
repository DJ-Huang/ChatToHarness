'use strict';
const fs=require('node:fs'),http=require('node:http');
const args=process.argv.slice(2),value=process.env.CONTROL_PLANE_HTTP_PROXY;
fs.writeFileSync(process.env.CTH_PROXY_UI_ARGS,JSON.stringify({args,proxyEndpoint:value?new URL(value).host:null}));
const file=args[args.indexOf('--health.url-file')+1];
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(req.url==='/readyz'?{status:'ok'}:{components:{'control-plane':{status:'ok'}}}));});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(file,'http://127.0.0.1:'+server.address().port+'/'));
