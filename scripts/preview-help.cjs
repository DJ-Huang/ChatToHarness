'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const directory=path.resolve(__dirname,'../dist/site');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=http.createServer((request,response)=>{
  try{
    const url=new URL(request.url,'http://localhost');
    if(url.pathname==='/'){response.writeHead(302,{Location:'/ChatToHarness/docs/zh-CN/'});response.end();return;}
    if(!url.pathname.startsWith('/ChatToHarness/'))throw new Error('not found');
    const file=path.resolve(directory,decodeURIComponent(url.pathname.slice('/ChatToHarness/'.length)));
    if(!file.startsWith(directory+path.sep)&&file!==directory)throw new Error('not found');
    const target=fs.statSync(file).isDirectory()?path.join(file,'index.html'):file;
    response.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream'});fs.createReadStream(target).pipe(response);
  }catch{response.writeHead(404);response.end('Not found');}
});
server.listen(Number(process.env.CTH_HELP_PORT)||4173,'127.0.0.1',()=>console.log(`Help preview: http://127.0.0.1:${server.address().port}/ChatToHarness/docs/zh-CN/`));
