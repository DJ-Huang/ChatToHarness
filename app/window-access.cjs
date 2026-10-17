'use strict';

// Keep a native way back to the window even when a tray icon is unavailable
// or hidden by the operating system's menu-bar/taskbar overflow.
function desktopEntry({app,platform,icon,onError=()=>{}}) {
  if(platform!=='darwin')return;
  app.setActivationPolicy('regular');
  if(icon)app.dock.setIcon(icon);
  void app.dock.show().catch(onError);
}

function revealWindow({app,window,platform}) {
  if(platform==='darwin'){
    app.show();
    void app.dock.show().catch(()=>{});
  }else window.setSkipTaskbar(false);
  if(window.isMinimized())window.restore();
  window.show();
  window.focus();
}

function closeToBackground({event,window,tray}) {
  event.preventDefault();
  if(tray&&!tray.isDestroyed())window.hide();
  else window.minimize();
}

module.exports={desktopEntry,revealWindow,closeToBackground};
