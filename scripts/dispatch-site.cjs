'use strict';
const {execFileSync}=require('node:child_process');
function api(route,body){return JSON.parse(execFileSync('gh',['api',route,...(body?['--method','POST','--input','-']:[])],{encoding:'utf8',input:body?JSON.stringify(body):undefined})||'null');}
function watchRun(repo,id){execFileSync('gh',['run','watch',String(id),'--repo',repo,'--exit-status','--interval','10'],{stdio:'inherit'});}
async function dispatchSite({repo,tag='',requestId,request=api,watch=watchRun,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=24,report=console.log}){
  if(!/^[\w.-]+\/[\w.-]+$/.test(repo||'')||!/^\d+-\d+$/.test(requestId||'')||tag&&!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))throw new Error('Invalid website deployment request.');
  const route=`repos/${repo}/actions/workflows/pages.yml`,title=`Website deploy ${requestId}`;
  await request(route+'/dispatches',{ref:'main',inputs:{release_tag:tag,deployment_request:requestId}});
  for(let attempt=0;attempt<attempts;attempt++){
    const result=await request(route+'/runs?event=workflow_dispatch&per_page=100');
    const run=result.workflow_runs.find(item=>item.display_title===title&&item.event==='workflow_dispatch'&&item.head_branch==='main');
    if(run){
      const url=`https://github.com/${repo}/actions/runs/${run.id}`;
      report(`Website deployment: ${url}`);
      // Keep the caller red if the independent deployment or production check fails.
      await watch(repo,run.id);
      return {id:run.id,url};
    }
    if(attempt+1<attempts)await wait(5000);
  }
  throw new Error(`Dispatched website run ${requestId} was not found; inspect the Website workflow before retrying.`);
}
module.exports={dispatchSite};
if(require.main===module)dispatchSite({repo:process.env.GITHUB_REPOSITORY,tag:process.env.RELEASE_TAG||'',requestId:`${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`}).catch(error=>{console.error(error.message);process.exitCode=1;});
