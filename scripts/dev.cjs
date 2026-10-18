#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {createRequire} = require('node:module');
const {verifyResources} = require('./build.cjs');
const versions = require('./versions.cjs');
const {spawnManaged,stopTree,bundledPaths} = require('../app/platform.cjs');

const ROOT = path.resolve(__dirname, '..');
const RESTART_EXIT = 75;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => {try {process.kill(pid, 0);return true;} catch(error) {return error.code !== 'ESRCH';}};

function developmentEnvironment(source, resources) {
  const env = {...source,LOCALHARNESS_RESOURCES:resources};
  for(const name of Object.keys(env)) if(/^ELECTRON_RUN_AS_NODE$/i.test(name) || /^LOCALHARNESS_TEST_/i.test(name)) delete env[name];
  return env;
}

function componentFingerprint(root = ROOT, platform = process.platform, arch = process.arch) {
  const hash = crypto.createHash('sha256');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  hash.update(JSON.stringify({platform,arch,dependencies:manifest.dependencies,devDependencies:manifest.devDependencies}));
  for(const name of ['package-lock.json','scripts/versions.cjs','scripts/prepare-resources.cjs','scripts/engine-isolation.cjs','native/ManagedProcess.cs',
    'vendor/desktop-commander/package.json','vendor/desktop-commander/package-lock.json']) {
    hash.update('\0' + name + '\0');hash.update(fs.readFileSync(path.join(root, name)));
  }
  return hash.digest('hex');
}

// Only the holder's uniquely named owner file is removed. A competing stale
// lock cleanup cannot recursively delete a replacement owner's directory.
async function preparationLock({root = ROOT,pid = process.pid,isAlive = alive,now = Date.now,pause = sleep,
  waitMs = 180000,staleEmptyMs = 2000,signal} = {}) {
  const cache = path.join(root, '.cache');fs.mkdirSync(cache, {recursive:true});
  const directory = path.join(cache, 'dev-prepare.lock');
  const owner = `${pid}-${crypto.randomBytes(12).toString('hex')}.json`;
  const file = path.join(directory, owner);const deadline = now() + waitMs;
  while(true) {
    signal?.throwIfAborted();
    try {
      fs.mkdirSync(directory, {mode:0o700});
      const identity = fs.statSync(directory);
      try {
        fs.writeFileSync(file, JSON.stringify({pid}), {flag:'wx',mode:0o600});
        const current = fs.statSync(directory);
        const entries = fs.readdirSync(directory);
        if(current.ino !== identity.ino || current.dev !== identity.dev || entries.length !== 1 || entries[0] !== owner) throw Object.assign(new Error(), {code:'EAGAIN'});
        let released = false;
        return () => {
          if(released)return;released=true;
          try{fs.unlinkSync(file);}catch{}
          try{fs.rmdirSync(directory);}catch{}
        };
      } catch(error) {
        try{fs.unlinkSync(file);}catch{}
        try{fs.rmdirSync(directory);}catch{}
        if(!['EAGAIN','ENOENT','EEXIST'].includes(error.code))throw error;
      }
    } catch(error) {
      if(error.code !== 'EEXIST' && error.code !== 'ENOENT')throw error;
      try {
        let removedStale = false;
        for(const name of fs.readdirSync(directory)) {
          if(!/^\d+-[a-f0-9]{24}\.json$/.test(name))continue;
          const previous = path.join(directory, name);
          let record;try{record=JSON.parse(fs.readFileSync(previous, 'utf8'));}catch{continue;}
          if(Number.isSafeInteger(record.pid) && record.pid > 1 && !isAlive(record.pid))try{fs.unlinkSync(previous);removedStale=true;}catch{}
        }
        if(!fs.readdirSync(directory).length && (removedStale || now() - fs.statSync(directory).mtimeMs >= staleEmptyMs))try{fs.rmdirSync(directory);}catch{}
      } catch(error) {if(error.code !== 'ENOENT')throw error;}
    }
    if(now() >= deadline)throw new Error('另一个开发启动器仍在准备运行组件，请稍后重试。');
    await pause(100);
  }
}

function completed(child) {
  return new Promise((resolve,reject) => {
    child.once('error',reject);
    child.once('exit',(code,signal)=>resolve({code,signal}));
  });
}

async function prepareComponents({root = ROOT,platform = process.platform,arch = process.arch,
  fingerprint = componentFingerprint,verify = verifyResources,lock = preparationLock,run,
  env = process.env,signal} = {}) {
  versions.forPlatform(`${platform}-${arch}`);
  signal?.throwIfAborted();
  const release = await lock({root,signal});
  try {
    signal?.throwIfAborted();
    const value = fingerprint(root,platform,arch);const resources = path.join(root, 'resources');
    const receipt = path.join(root, '.cache', 'dev-components.json');
    let cached;try{cached=JSON.parse(fs.readFileSync(receipt,'utf8'));}catch{}
    let valid = false;
    try{verify(resources);valid=true;}catch{}
    if(cached?.fingerprint === value && valid)return {resources,prepared:false};
    if(run)await run(path.join(root,'scripts','prepare-resources.cjs'),{signal});
    else {
      const child = spawn(process.execPath,[path.join(root,'scripts','prepare-resources.cjs')],
        {cwd:root,env:developmentEnvironment(env,resources),stdio:'inherit',windowsHide:true,detached:platform !== 'win32'});
      const stopping=()=>{void stopTree(child);};
      const resultPromise=completed(child);
      signal?.addEventListener('abort',stopping,{once:true});
      let result;
      try {if(signal?.aborted)stopping();result=await resultPromise;}
      finally {signal?.removeEventListener('abort',stopping);if(signal?.aborted)await stopTree(child);}
      signal?.throwIfAborted();
      if(result.code !== 0)throw new Error('开发运行组件准备失败，请查看上面的错误后重试。');
    }
    signal?.throwIfAborted();
    verify(resources);
    const temporary = `${receipt}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try{fs.writeFileSync(temporary,JSON.stringify({fingerprint:value})+'\n',{flag:'wx',mode:0o600});fs.renameSync(temporary,receipt);}
    finally{try{fs.unlinkSync(temporary);}catch{}}
    return {resources,prepared:true};
  } finally {release();}
}

function electronExecutable(root = ROOT) {
  const requireProject = createRequire(path.join(root,'package.json'));
  let manifest,installed,binary;
  try {
    manifest = requireProject('./package.json');
    installed = requireProject('electron/package.json');
    binary = requireProject('electron');
    if(installed.version !== manifest.devDependencies.electron || typeof binary !== 'string' || !path.isAbsolute(binary))throw new Error();
    fs.accessSync(binary,fs.constants.X_OK);
  } catch {throw new Error('开发界面依赖缺失或版本不匹配，请先在工程目录运行 npm ci。');}
  return binary;
}

class DevelopmentLauncher {
  constructor({root = ROOT,resources = path.join(root,'resources'),binary,platform = process.platform,
    env = process.env,owner = process.pid,spawnChild = spawnManaged,stop = stopTree,
    now = Date.now,pause = sleep,retryMs = 250,restartMs = 15000,graceMs = 8000,
    setTimer = setTimeout,clearTimer = clearTimeout} = {}) {
    Object.assign(this,{root,resources,binary,platform,env,owner,spawnChild,stop,now,pause,retryMs,restartMs,graceMs,setTimer,clearTimer});
    this.child = null;this.finished = null;this.stopping = null;this.cancelled = false;
  }
  async launch() {
    const deadline = this.now() + this.restartMs;
    while(!this.cancelled) {
      let child;
      try {
        child = this.spawnChild(this.binary,[this.root,'--localharness-dev-restart',`--localharness-dev-owner=${this.owner}`],
          {platform:this.platform,processHost:bundledPaths(this.resources,this.platform).processHost,cwd:this.root,
            env:developmentEnvironment(this.env,this.resources),stdio:'inherit',windowsHide:true});
        this.child=child;this.finished=completed(child);
        const result=await this.finished;
        // The managed Windows helper owns all application descendants. On
        // other platforms stopTree cleans up only this launcher-owned tree.
        await this.stop(child);
        if(this.child===child){this.child=null;this.finished=null;}
        if(this.cancelled)return 0;
        if(result.code !== RESTART_EXIT)return result.code ?? (result.signal ? 1 : 0);
        if(this.now() >= deadline)throw new Error('旧应用尚未退出。请从菜单选择“退出 ChatToHarness”一次，然后重新开发启动；不会强制结束其他进程。');
        await this.pause(Math.min(this.retryMs,Math.max(0,deadline-this.now())));
      } catch(error) {
        if(child)await this.stop(child);
        if(this.child===child){this.child=null;this.finished=null;}
        if(this.cancelled)return 0;
        throw error;
      }
    }
    return 0;
  }
  shutdown() {
    if(this.stopping)return this.stopping;
    this.cancelled=true;
    this.stopping=(async()=>{
      const child=this.child,finished=this.finished;
      if(!child)return;
      let timer,request;
      try {
        if(this.platform === 'win32') {
          try {
            request=this.spawnChild(this.binary,[this.root,`--localharness-dev-stop=${this.owner}`],
              {platform:this.platform,processHost:bundledPaths(this.resources,this.platform).processHost,cwd:this.root,
                env:developmentEnvironment(this.env,this.resources),stdio:'inherit',windowsHide:true});
            // A one-shot request has no application window and never becomes
            // the replacement instance. Its failure falls back to owned cleanup.
            void completed(request).catch(()=>{});
          } catch {}
        } else {try{child.kill('SIGTERM');}catch{}}
        await Promise.race([finished?.catch(()=>{}),new Promise(resolve=>{timer=this.setTimer(resolve,this.graceMs);})]);
      } finally {
        if(timer !== undefined)this.clearTimer(timer);
        await Promise.allSettled([this.stop(child),...(request?[this.stop(request)]:[])]);
      }
    })();
    return this.stopping;
  }
}

async function main(args = process.argv.slice(2)) {
  if(args.some(value=>value !== '--prepare-only'))throw new Error('开发启动仅支持 --prepare-only。');
  const controller=new AbortController();let launcher;
  const onSignal = ()=>{controller.abort();void launcher?.shutdown();};
  const signals=['SIGINT','SIGTERM',...(process.platform === 'win32'?[]:['SIGHUP'])];
  for(const signal of signals)process.on(signal,onSignal);
  try {
    const binary = electronExecutable();
    const {resources} = await prepareComponents({signal:controller.signal});
    if(args.includes('--prepare-only') || controller.signal.aborted)return 0;
    launcher=new DevelopmentLauncher({binary,resources});
    return await launcher.launch();
  } catch(error) {if(controller.signal.aborted)return 0;throw error;}
  finally {for(const signal of signals)process.removeListener(signal,onSignal);await launcher?.shutdown();}
}

if(require.main === module)main().then(code=>{process.exitCode=code;},error=>{console.error(`开发启动失败：${error.message}`);process.exitCode=1;});
module.exports={RESTART_EXIT,developmentEnvironment,componentFingerprint,preparationLock,prepareComponents,electronExecutable,DevelopmentLauncher,main};
