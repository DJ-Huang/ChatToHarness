'use strict';
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {privateDirectory,readJson,atomicJson,syncDirectory}=require('./durable-files.cjs');

const TERMINAL=new Set(['succeeded','cancelled','session_terminated','interrupted']);
const OPERATIONS=new Set(['click','mouse_move','mouse_down','mouse_drag','mouse_up',
  'drag_window','type_text','key_press','scroll','activate']);
const now=()=>new Date().toISOString();
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const fault=code=>Object.assign(new Error(code),{code});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/**
 * Platform-neutral, session-scoped GUI task orchestration.
 * It does not supply a model. A trusted planner adapter can decide from fresh
 * observations; otherwise an authorized MCP caller supplies decisions.
 * Screenshots, goals, typed text and actions never enter persistent records.
 */
class ComputerUseAgentRunner {
  constructor(service,{directory=path.join(os.homedir(),'.chattoharness','computer-use-agent-tasks'),
    planner=null,retryDelayMs=200}={}) {
    this.service=service;
    this.directory=directory;
    this.planner=planner;
    this.retryDelayMs=retryDelayMs;
    this.tasks=new Map();
    this.activeId=null;
  }
  get active(){return this.activeId!==null;}
  file(id){
    if(typeof id!=='string'||!/^cu_agent_[a-f0-9]{64}$/.test(id))throw fault('CU_INVALID_TASK_ID');
    return path.join(this.directory,id+'.json');
  }
  persist(rec){rec.updated_at=now();atomicJson(this.file(rec.task_id),rec);}
  status(id,sessionId){
    let rec;
    try{rec=readJson(this.file(id));}
    catch(err){if(err.code==='ENOENT')throw fault('CU_TASK_NOT_FOUND');throw err;}
    if(rec.task_id!==id||rec.session_id!==sessionId)throw fault('CU_TASK_SCOPE_MISMATCH');
    if(!TERMINAL.has(rec.state)&&!this.tasks.has(id))
      return {...rec,state:'interrupted',reason:'CU_OWNER_RESTARTED'};
    return {...rec};
  }
  get(id,sessionId){
    const rec=this.status(id,sessionId);
    const task=this.tasks.get(id);
    if(!task||rec.state!=='awaiting_decision'||!task.image)return {record:rec};
    // Only the owner-session caller receives an in-memory fresh observation.
    const shot=task.image;
    const metadata={...shot.structuredContent};
    if(metadata.screenshot)metadata.screenshot={...metadata.screenshot};
    if(metadata.screenshot)delete metadata.screenshot.data;
    return {record:{...rec,observation:metadata},media:shot.content?.filter(c=>c.type==='image')||[]};
  }
  start({session_id,observation_id,goal,idempotency_key}){
    if(typeof goal!=='string'||!goal.trim()||goal.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(goal))
      throw fault('CU_INVALID_TASK_GOAL');
    if(typeof idempotency_key!=='string'||!idempotency_key.trim()||idempotency_key.length>128)
      throw fault('CU_INVALID_ARGUMENT');
    privateDirectory(this.directory);
    const id='cu_agent_'+hash(JSON.stringify([session_id,idempotency_key]));
    const goalDigest=hash(goal);
    if(fs.existsSync(this.file(id))){
      const rec=this.status(id,session_id);
      if(rec.goal_digest!==goalDigest)throw fault('CU_TASK_IDEMPOTENCY_CONFLICT');
      return {...rec,reused:true};
    }
    const session=this.service.session;
    if(!session||session.id!==session_id||session.state!=='ready')throw fault('CU_SESSION_CLOSED');
    if(!session.observation||session.observation.id!==observation_id||
       Date.now()-session.observation.at>30000)throw fault('CU_STALE_OBSERVATION');
    if(this.active)throw fault('CU_TASK_RUNNING');
    if(fs.readdirSync(this.directory).filter(s=>/^cu_agent_[a-f0-9]{64}\.json$/.test(s)).length>=256)
      throw fault('CU_TASK_STORE_FULL');
    const rec={schema:1,task_id:id,session_id,window_id:session.windowId||null,
      goal_digest:goalDigest,state:'queued',phase:'created',attempts:0,completed_steps:0,
      created_at:now(),updated_at:now(),last_action:null,last_error:null};
    const fd=fs.openSync(this.file(id),'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify(rec)+'\n');fs.fsyncSync(fd);}
    finally{fs.closeSync(fd);}
    syncDirectory(this.directory);
    const task={rec,goal,decision:null,decisionId:null,image:null};
    this.tasks.set(id,task);this.activeId=id;
    queueMicrotask(()=>this.execute(task).catch(()=>{
      // Uncertain state is never resumed in a different native session.
      try{
        if(!TERMINAL.has(rec.state))this.finish(task,'interrupted','CU_AGENT_RUNNER_FAILURE');
        // An unexpected agent failure cannot leave interactive control orphaned.
        if(this.service.session?.id===rec.session_id)this.service.stop('CU_AGENT_RUNNER_FAILURE');
      }catch{this.tasks.delete(id);this.activeId=null;this.service.stop('CU_AGENT_STORE_FAILURE');}
    }));
    return {...rec,reused:false};
  }
  finish(task,state,reason){
    const rec=task.rec;
    if(TERMINAL.has(rec.state))return;
    rec.state=state;rec.phase='finished';rec.finished_at=now();
    if(reason)rec.reason=reason;
    this.persist(rec);
    task.image=null;task.decision=null;
    if(this.activeId===rec.task_id)this.activeId=null;
    this.tasks.delete(rec.task_id);
    if(state==='succeeded'&&this.service.session?.id===rec.session_id)
      this.service.stop('CU_TASK_COMPLETED');
  }
  onSessionStop(sessionId,code){
    const task=this.tasks.get(this.activeId);
    if(task?.rec.session_id===sessionId)
      this.finish(task,code==='CU_AGENT_CANCELLED'?'cancelled':'session_terminated',code);
  }
  cancel(id,sessionId){
    const rec=this.status(id,sessionId);
    if(TERMINAL.has(rec.state))return rec;
    const task=this.tasks.get(id);
    if(!task)return rec;
    // Native STOP/Esc can interrupt at any instant; no action replay after it.
    this.service.stop('CU_AGENT_CANCELLED');
    if(!TERMINAL.has(task.rec.state))this.finish(task,'cancelled','CU_AGENT_CANCELLED');
    return this.status(id,sessionId);
  }
  static validateDecision(value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw fault('CU_INVALID_DECISION');
    if(value.done===true&&Object.keys(value).length===1)return {done:true};
    if(value.wait===true&&Object.keys(value).length===1)return {wait:true};
    const action=value.action;
    if(!action||typeof action!=='object'||Array.isArray(action)||
      !OPERATIONS.has(action.action)||Object.keys(value).length!==1)
      throw fault('CU_INVALID_DECISION');
    // Input fields and ranges are validated AGAIN by BaseComputerUse.validate,
    // after the fresh observation has been bound by this runner.
    if(Object.keys(action).some(k=>['session_id','observation_id','window_id',
      'task_id','target_device_id','session_title'].includes(k)))
      throw fault('CU_INVALID_DECISION');
    return {action:{...action}};
  }
  submit({task_id,session_id,decision_id,decision_json}){
    const rec=this.status(task_id,session_id),task=this.tasks.get(task_id);
    if(!task||rec.state!=='awaiting_decision'||decision_id!==task.decisionId)
      throw fault('CU_STALE_DECISION');
    if(typeof decision_json!=='string'||decision_json.length>4096)throw fault('CU_INVALID_DECISION');
    let decoded;
    try{decoded=JSON.parse(decision_json);}catch{throw fault('CU_INVALID_DECISION');}
    const decision=ComputerUseAgentRunner.validateDecision(decoded);
    if(task.decision)throw fault('CU_DECISION_ALREADY_SUBMITTED');
    task.decision=decision;
    return {task_id,session_id,accepted:true,decision_id};
  }
  async call(task,input){
    task.rec.phase=input.action==='observe'?'observing':'executing';
    if(OPERATIONS.has(input.action)){
      task.rec.last_action=input.action;
      task.rec.attempts++;
    }
    this.persist(task.rec); // checkpoint before any side-effecting input
    const result=await this.service.call(input,{internalAgentTaskId:task.rec.task_id});
    if(TERMINAL.has(task.rec.state))throw fault('CU_TASK_STOPPED');
    return result;
  }
  async healthy(task){
    const s=this.service.session;
    if(!s||s.id!==task.rec.session_id||s.state!=='ready')return false;
    const status=await this.call(task,{action:'get_session',session_id:s.id});
    return status.structuredContent?.state==='ready';
  }
  async decide(task,observation){
    if(this.planner){
      // A planner is trusted code in the local service; no hidden model access.
      // A planner that hangs is bounded; STOP remains effective.
      try {
        const response=await Promise.race([
          Promise.resolve().then(()=>this.planner({
            goal:task.goal,step:task.rec.completed_steps,observation,
            last_error:task.rec.last_error,last_action:task.rec.last_action})),
          pause(15000).then(()=>({wait:true}))
        ]);
        if(response&&!response.wait)return ComputerUseAgentRunner.validateDecision(response);
      } catch {
        // A transient planner/model failure cannot end the user task.
        task.rec.last_error='CU_PLANNER_ERROR';
      }
    }
    const rec=task.rec;
    task.decisionId=crypto.randomUUID();
    task.image=observation;
    rec.state='awaiting_decision';rec.phase='awaiting_decision';
    rec.decision_id=task.decisionId;this.persist(rec);
    while(!TERMINAL.has(rec.state)){
      if(task.decision)break;
      await pause(Math.max(150,this.retryDelayMs));
      if(!await this.healthy(task)){
        this.finish(task,'session_terminated','CU_SESSION_CLOSED');
        return null;
      }
    }
    const decision=task.decision;
    task.image=null;task.decision=null;task.decisionId=null;
    delete rec.decision_id;
    if(!TERMINAL.has(rec.state)){rec.state='running';rec.phase='planning';this.persist(rec);}
    return decision;
  }
  async execute(task){
    const rec=task.rec;
    let backoff=this.retryDelayMs;
    while(!TERMINAL.has(rec.state)){
      if(!await this.healthy(task)){
        this.finish(task,'session_terminated','CU_SESSION_CLOSED');
        return;
      }
      const shot=await this.call(task,{action:'observe',session_id:rec.session_id});
      if(shot.isError){
        rec.last_error=shot.structuredContent?.code||'CU_OBSERVE_FAILED';
        rec.state='recovering';this.persist(rec);
        if(shot.structuredContent?.task_state==='session_terminated'){
          this.finish(task,'session_terminated',rec.last_error);return;
        }
        await pause(backoff);backoff=Math.min(2000,Math.ceil(backoff*1.5));
        continue;
      }
      rec.state='planning';rec.phase='planning';
      const meta=shot.structuredContent||{};
      rec.last_observed=meta.window_bounds||null;
      this.persist(rec);
      const decision=await this.decide(task,shot);
      if(!decision||TERMINAL.has(rec.state))return;
      if(decision.done){
        // Completion is a decision made only after a real fresh observation;
        // the runner does not interpret a successful click as task completion.
        this.finish(task,'succeeded');return;
      }
      if(decision.wait){await pause(backoff);continue;}
      const action={...decision.action,session_id:rec.session_id,
        ...(['activate','mouse_up'].includes(decision.action.action)?{}:
          {observation_id:meta.observation_id})};
      const result=await this.call(task,action);
      if(result.isError){
        rec.last_error=result.structuredContent?.code||'CU_ACTION_FAILED';
        rec.state='recovering';this.persist(rec);
        if(result.structuredContent?.task_state==='session_terminated'||
          !this.service.session||this.service.session.id!==rec.session_id){
          this.finish(task,'session_terminated',rec.last_error);return;
        }
        if(result.structuredContent?.recovery_action==='activate')
          await this.call(task,{action:'activate',session_id:rec.session_id});
        await pause(backoff);
        backoff=Math.min(2000,Math.ceil(backoff*1.5));
      }else{
        rec.completed_steps++;
        rec.last_error=null;rec.state='running';this.persist(rec);
        backoff=this.retryDelayMs;
      }
    }
  }
}
module.exports={ComputerUseAgentRunner,TERMINAL,OPERATIONS};
