'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const {RESTART_EXIT,developmentEnvironment,componentFingerprint,preparationLock,prepareComponents,electronExecutable,DevelopmentLauncher}=require('../scripts/dev.cjs');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cth-dev 中文 '));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return root;
}
function put(root,name,value) {const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);return file;}
function fakeChild() {
  const child=new EventEmitter();child.pid=12345;child.exitCode=null;child.signalCode=null;
  child.finish=(code,signal=null)=>{child.exitCode=code;child.signalCode=signal;child.emit('exit',code,signal);};
  child.kill=signal=>{queueMicrotask(()=>child.finish(0,signal));return true;};
  return child;
}

test('development environment removes Electron Node mode and test overrides while retaining existing settings',()=>{
  const original={PATH:'/bin',LOCALHARNESS_HOME:'/existing/home',ELECTRON_RUN_AS_NODE:'1',LOCALHARNESS_TEST_MODE:'1',LOCALHARNESS_TEST_TUNNEL_SCRIPT:'/fake',LOCALHARNESS_RESOURCES:'/old'};
  const env=developmentEnvironment(original,'/source/resources');
  assert.equal(env.ELECTRON_RUN_AS_NODE,undefined);assert.equal(env.LOCALHARNESS_TEST_MODE,undefined);assert.equal(env.LOCALHARNESS_TEST_TUNNEL_SCRIPT,undefined);
  assert.equal(env.LOCALHARNESS_HOME,'/existing/home');assert.equal(env.LOCALHARNESS_RESOURCES,'/source/resources');assert.equal(original.ELECTRON_RUN_AS_NODE,'1');
});

test('component fingerprint changes only for component inputs, platform, or dependencies',t=>{
  const root=fixture(t);
  put(root,'package.json',JSON.stringify({version:'1.0.0',scripts:{dev:'first'},devDependencies:{electron:'44.7.2'}}));
  for(const name of ['package-lock.json','scripts/versions.cjs','scripts/prepare-resources.cjs','native/ManagedProcess.cs','vendor/desktop-commander/package.json','vendor/desktop-commander/package-lock.json'])put(root,name,'original');
  const before=componentFingerprint(root,'darwin','arm64');
  put(root,'app/main.cjs','source edit');put(root,'package.json',JSON.stringify({version:'1.0.1',scripts:{dev:'changed'},devDependencies:{electron:'44.7.2'}}));
  assert.equal(componentFingerprint(root,'darwin','arm64'),before);
  assert.notEqual(componentFingerprint(root,'win32','x64'),before);
  put(root,'native/ManagedProcess.cs','native edit');assert.notEqual(componentFingerprint(root,'darwin','arm64'),before);
});

test('component preparation is cached, repairs failed validation, and never builds an application',async t=>{
  const root=fixture(t);let valid=false,builds=0,released=0,fingerprint='first';
  const options={root,platform:'darwin',arch:'arm64',fingerprint:()=>fingerprint,lock:async()=>{fs.mkdirSync(path.join(root,'.cache'),{recursive:true});return()=>{released++;};},
    verify:resources=>{assert.equal(resources,path.join(root,'resources'));if(!valid)throw new Error('missing');},
    run:async script=>{assert.equal(script,path.join(root,'scripts','prepare-resources.cjs'));builds++;valid=true;}};
  assert.equal((await prepareComponents(options)).prepared,true);assert.equal(builds,1);
  assert.equal((await prepareComponents(options)).prepared,false);assert.equal(builds,1);
  fingerprint='new';assert.equal((await prepareComponents(options)).prepared,true);assert.equal(builds,2);
  valid=false;assert.equal((await prepareComponents(options)).prepared,true);assert.equal(builds,3);assert.equal(released,4);
});

test('failed component preparation releases its lock and publishes no successful fingerprint',async t=>{
  const root=fixture(t);let released=false;
  await assert.rejects(prepareComponents({root,platform:'darwin',arch:'arm64',fingerprint:()=>'',verify:()=>{throw new Error('missing');},
    lock:async()=>()=>{released=true;},run:async()=>{throw new Error('fixture preparation failed');}}),/fixture preparation failed/);
  assert.equal(released,true);assert.equal(fs.existsSync(path.join(root,'.cache','dev-components.json')),false);
});

test('preparation lock serializes owners, recovers a dead PID and times out without deleting active work',async t=>{
  const root=fixture(t);let clock=0;
  const release=await preparationLock({root,pid:100,now:()=>clock,isAlive:()=>true});
  let paused=false;
  const second=await preparationLock({root,pid:101,now:()=>clock,isAlive:()=>true,pause:async ms=>{clock+=ms;paused=true;release();}});
  assert.equal(paused,true);second();
  const directory=path.join(root,'.cache','dev-prepare.lock');fs.mkdirSync(directory);
  put(root,'.cache/dev-prepare.lock/99-aaaaaaaaaaaaaaaaaaaaaaaa.json',JSON.stringify({pid:99}));
  const recovered=await preparationLock({root,pid:102,now:()=>clock,isAlive:()=>false,staleEmptyMs:0,pause:async ms=>{clock+=ms;}});recovered();
  const active=await preparationLock({root,pid:103,now:()=>clock,isAlive:()=>true});
  await assert.rejects(preparationLock({root,pid:104,now:()=>clock,isAlive:()=>true,waitMs:200,pause:async ms=>{clock+=ms;}}),/另一个开发启动器/);
  assert.equal(fs.readdirSync(directory).length,1);active();assert.equal(fs.existsSync(directory),false);
});

test('Electron executable must come from the pinned local dependency',t=>{
  const root=fixture(t);
  put(root,'package.json',JSON.stringify({devDependencies:{electron:'44.7.2'}}));
  put(root,'node_modules/electron/package.json',JSON.stringify({name:'electron',version:'44.7.2',main:'index.js'}));
  const binary=put(root,'node_modules/electron/electron-bin','fixture');fs.chmodSync(binary,0o755);
  put(root,'node_modules/electron/index.js',`module.exports=${JSON.stringify(binary)};`);
  assert.equal(electronExecutable(root),binary);
  const mismatched=fixture(t);put(mismatched,'package.json',JSON.stringify({devDependencies:{electron:'44.7.2'}}));
  put(mismatched,'node_modules/electron/package.json',JSON.stringify({name:'electron',version:'old',main:'index.js'}));
  put(mismatched,'node_modules/electron/index.js',`module.exports=${JSON.stringify(binary)};`);
  assert.throws(()=>electronExecutable(mismatched),/npm ci/);
});

test('launcher retries only the restart code and passes source, owner and managed process options',async()=>{
  let clock=0;const calls=[],cleaned=[];const exits=[RESTART_EXIT,RESTART_EXIT,0];
  const launcher=new DevelopmentLauncher({root:'/repo 中文',resources:'/repo/resources',binary:'/electron',owner:42,platform:'darwin',
    env:{ELECTRON_RUN_AS_NODE:'1',LOCALHARNESS_TEST_MODE:'1'},now:()=>clock,pause:async ms=>{clock+=ms;},
    stop:async child=>{cleaned.push(child);},spawnChild:(binary,args,options)=>{const child=fakeChild();calls.push({binary,args,options});queueMicrotask(()=>child.finish(exits.shift()));return child;}});
  assert.equal(await launcher.launch(),0);assert.equal(calls.length,3);assert.equal(clock,500);assert.equal(cleaned.length,3);
  assert.equal(calls[0].binary,'/electron');assert.deepEqual(calls[0].args,['/repo 中文','--localharness-dev-restart','--localharness-dev-owner=42']);
  assert.equal(calls[0].options.cwd,'/repo 中文');assert.equal(calls[0].options.env.LOCALHARNESS_RESOURCES,'/repo/resources');assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE,undefined);
});

test('launcher returns application errors without replay and reports an incompatible or stuck old instance',async()=>{
  let attempts=0;
  const failing=new DevelopmentLauncher({binary:'/electron',stop:async()=>{},spawnChild:()=>{attempts++;const child=fakeChild();queueMicrotask(()=>child.finish(2));return child;}});
  assert.equal(await failing.launch(),2);assert.equal(attempts,1);
  let clock=0;attempts=0;
  const busy=new DevelopmentLauncher({binary:'/electron',now:()=>clock,pause:async ms=>{clock+=ms;},restartMs:500,retryMs:250,stop:async()=>{},
    spawnChild:()=>{attempts++;const child=fakeChild();queueMicrotask(()=>child.finish(RESTART_EXIT));return child;}});
  await assert.rejects(busy.launch(),/从菜单选择.*退出 ChatToHarness.*一次/);assert.equal(clock,500);assert.equal(attempts,3);
});

test('shutdown first allows normal application cleanup, cancels replacement retries and remains idempotent',async()=>{
  const child=fakeChild();const order=[];let timerCancelled=false;
  child.kill=signal=>{order.push(signal);queueMicrotask(()=>{order.push('application cleanup');child.finish(0);});return true;};
  const launcher=new DevelopmentLauncher({binary:'/electron',platform:'darwin',spawnChild:()=>child,stop:async value=>{assert.equal(value,child);order.push('owned tree cleanup');},
    setTimer:()=>123,clearTimer:value=>{assert.equal(value,123);timerCancelled=true;}});
  const running=launcher.launch();const first=launcher.shutdown();assert.equal(launcher.shutdown(),first);
  await first;assert.equal(await running,0);assert.equal(timerCancelled,true);assert.equal(order[0],'SIGTERM');assert.ok(order.indexOf('application cleanup')<order.indexOf('owned tree cleanup'));
});

test('hung shutdown is bounded and Windows application trees use the private process host',async()=>{
  const child=fakeChild(),request=fakeChild();let forced=false,expire,starts=0;const args=[];
  child.kill=()=>true;
  const launcher=new DevelopmentLauncher({root:'C:\\repo',resources:'C:\\repo\\resources',binary:'C:\\electron.exe',platform:'win32',graceMs:8000,
    spawnChild:(_binary,values,options)=>{args.push(values);assert.equal(options.processHost,'C:\\repo\\resources\\managed-process\\ChatToHarness.ProcessHost.exe');return starts++?request:child;},
    stop:async value=>{forced=true;value.finish(0);},setTimer:(callback,ms)=>{assert.equal(ms,8000);expire=callback;return 1;},clearTimer:()=>{}});
  const running=launcher.launch();const shutdown=launcher.shutdown();assert.equal(forced,false);expire();await shutdown;assert.equal(forced,true);assert.equal(await running,0);
  assert.deepEqual(args[1],['C:\\repo',`--localharness-dev-stop=${process.pid}`]);
});

test('Windows stop request allows the matching main instance to finish before forced cleanup',async()=>{
  const child=fakeChild(),request=fakeChild();const order=[];let starts=0;
  const launcher=new DevelopmentLauncher({root:'C:\\repo',binary:'C:\\electron.exe',platform:'win32',owner:88,
    spawnChild:(_binary,args)=>{
      if(!starts++)return child;
      assert.deepEqual(args,['C:\\repo','--localharness-dev-stop=88']);order.push('request');
      queueMicrotask(()=>{order.push('main cleanup');child.finish(0);request.finish(0);});return request;
    },stop:async value=>{assert.ok(value===child||value===request);order.push('owned tree cleanup');},setTimer:()=>1,clearTimer:()=>{}});
  const running=launcher.launch();await launcher.shutdown();assert.equal(await running,0);
  assert.ok(order.indexOf('main cleanup')<order.indexOf('owned tree cleanup'));
});

test('cancelled preparation does not run a component command or leave its PID lock',async t=>{
  const root=fixture(t);const controller=new AbortController();controller.abort();let ran=false;
  await assert.rejects(prepareComponents({root,platform:'darwin',arch:'arm64',signal:controller.signal,run:async()=>{ran=true;}}),error=>error.name==='AbortError');
  assert.equal(ran,false);assert.equal(fs.existsSync(path.join(root,'.cache','dev-prepare.lock')),false);
});

test('a spawn error cleans only the supplied owned child and does not retry',async()=>{
  const child=fakeChild();let cleaned=0,attempts=0;
  const launcher=new DevelopmentLauncher({binary:'/electron',spawnChild:()=>{attempts++;queueMicrotask(()=>child.emit('error',new Error('fixture spawn failure')));return child;},
    stop:async value=>{assert.equal(value,child);cleaned++;}});
  await assert.rejects(launcher.launch(),/fixture spawn failure/);assert.equal(attempts,1);assert.equal(cleaned,1);
});

test('POSIX native fixture exits with its detached service while unrelated processes remain running',
  {skip:process.platform==='win32',timeout:15000},async t=>{
    const root=fixture(t),report=path.join(root,'processes.json'),cleaned=path.join(root,'cleaned');
    put(root,'package.json',JSON.stringify({main:'fixture.cjs'}));
    put(root,'fixture.cjs',`const fs=require('node:fs');
const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
let stopping=false;
process.on('SIGTERM',()=>{
  if(stopping)return;stopping=true;
  child.once('exit',()=>{fs.writeFileSync(${JSON.stringify(cleaned)},'service stopped');process.exit(0);});
  child.kill('SIGTERM');
});
child.once('spawn',()=>fs.writeFileSync(${JSON.stringify(report)},JSON.stringify({app:process.pid,service:child.pid})));
setInterval(()=>{},1000);
`);
    const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    const unrelatedExited=new Promise(resolve=>unrelated.once('exit',resolve));
    const launcher=new DevelopmentLauncher({root,binary:process.execPath,graceMs:5000});
    const running=launcher.launch();let owned;
    const isAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
    t.after(async()=>{
      await launcher.shutdown();
      if(unrelated.exitCode===null&&unrelated.signalCode===null)unrelated.kill('SIGKILL');
      await unrelatedExited;
      // Last-resort cleanup is confined to PIDs created by this fixture.
      for(const pid of [owned?.service,owned?.app])if(pid&&isAlive(pid))try{process.kill(pid,'SIGKILL');}catch{}
      await running.catch(()=>{});
    });
    const deadline=Date.now()+5000;
    while(!fs.existsSync(report)) {
      if(Date.now()>deadline)throw new Error('temporary application did not start');
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    owned=JSON.parse(fs.readFileSync(report,'utf8'));
    assert.equal(isAlive(owned.app),true);assert.equal(isAlive(owned.service),true);assert.equal(isAlive(unrelated.pid),true);
    await launcher.shutdown();assert.equal(await running,0);
    assert.equal(fs.readFileSync(cleaned,'utf8'),'service stopped');
    assert.equal(isAlive(owned.app),false);assert.equal(isAlive(owned.service),false);assert.equal(isAlive(unrelated.pid),true);
  });
