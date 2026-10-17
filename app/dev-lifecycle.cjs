'use strict';

const RESTART_FLAG = '--localharness-dev-restart';
const RESTART_EXIT_CODE = 75;
function ownerFrom(argv,prefix) {
  const value=(argv || []).find(item=>typeof item==='string'&&item.startsWith(prefix));
  const number=value?.slice(prefix.length);
  const owner=/^\d+$/.test(number || '')?Number(number):0;
  return Number.isSafeInteger(owner)&&owner>1?owner:0;
}

function acquireInstance({app,show,host=process}) {
  const replace = !app.isPackaged && (host.argv || []).includes(RESTART_FLAG);
  const stop=ownerFrom(host.argv,'--localharness-dev-stop=');
  if((host.argv || []).some(value=>typeof value==='string'&&value.startsWith('--localharness-dev-stop='))&&!stop){app.exit(1);return false;}
  const acquired=app.requestSingleInstanceLock(stop?{localHarnessDevStop:stop}:{localHarnessDevRestart:replace});
  // A stop request never becomes a new running application, even if there was
  // no old owner. It can only close the development instance of this launcher.
  if(stop){app.exit(0);return false;}
  if (!acquired) {
    if (replace) app.exit(RESTART_EXIT_CODE);
    else app.quit();
    return false;
  }
  app.on('second-instance', (_event,_argv,_directory,data) => {
    // The primary keeps its instance lock throughout before-quit cleanup. A
    // replacement can only acquire it after the old tools and tunnel stop.
    if (data?.localHarnessDevStop !== undefined) {
      const owner=ownerFrom(host.argv,'--localharness-dev-owner=');
      if(!app.isPackaged&&owner&&data.localHarnessDevStop===owner)app.quit();
    } else if (data?.localHarnessDevRestart === true) app.quit();
    else show();
  });
  return true;
}

function installExitHandlers({app,host=process,setTimer=setInterval,clearTimer=clearInterval}) {
  let requested = false, timer;
  const quit = () => { if (!requested) { requested=true;app.quit(); } };
  const signals = ['SIGINT','SIGTERM','SIGHUP'];
  for (const signal of signals) host.on?.(signal,quit);
  const argv=host.argv || [];
  const owner=ownerFrom(argv,'--localharness-dev-owner=');
  if (!app.isPackaged && argv.includes(RESTART_FLAG) && Number.isSafeInteger(owner) && owner>1 && owner!==host.pid) {
    const parent=host.ppid;
    timer=setTimer(()=>{
      if(host.ppid!==parent) { quit();return; }
      try { host.kill(owner,0); }
      catch(error) { if(error.code==='ESRCH')quit(); }
    },1000);
    timer.unref?.();
  }
  const dispose=()=>{if(timer)clearTimer(timer);for(const signal of signals)host.off?.(signal,quit);};
  app.on('will-quit',dispose);
  return dispose;
}

module.exports={acquireInstance,installExitHandlers,RESTART_FLAG,RESTART_EXIT_CODE};
