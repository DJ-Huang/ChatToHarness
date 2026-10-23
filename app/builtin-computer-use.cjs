'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ComputerUsePermissions,permissionCode}=require('./computer-use-permissions.cjs');
const os=require('node:os');
const crypto=require('node:crypto');
const {registeredComputerUse,deviceBoundArgs}=require('./computer-use-devices.cjs');

// App-owned, opt-in Computer Use. Not an imported/untrusted external MCP.
// Only the local platform's helper is eligible. Merely listing the tool never
// starts the native process or bypasses Screen Recording/Accessibility grants.
class ComputerUseSwitch {
  constructor({platform=process.platform,resources,enabled=false,createMac,createWindows,permissions,onPermissionRequired,deviceIdentity}={}) {
    this.platform=platform;
    this.deviceIdentity=deviceIdentity||{id:'cu-'+crypto.randomUUID(),name:os.hostname(),platform};
    this.resources=resources;
    this.enabled=enabled===true;
    this.createMac=createMac;
    this.createWindows=createWindows;
    this.permissions=permissions || new ComputerUsePermissions({platform,helper:this.helper});
    this.onPermissionRequired=onPermissionRequired;
    this.permission=null;
    this.controller=null;
    this.active=new Set();
    this.epoch=0;
  }
  get helper() {
    if(!['darwin','win32'].includes(this.platform)||!this.resources)return null;
    return path.join(this.resources,'computer-use',this.platform==='darwin'
      ? 'ChatToHarness.MacComputerUse':'ChatToHarness.ComputerUse.exe');
  }
  get available() {return Boolean(this.helper&&fs.existsSync(this.helper));}
  status() {
    return {enabled:this.enabled,available:this.available,
      permission:this.permission,
      platform:this.platform,device:this.deviceIdentity,registered:this.enabled&&this.available,
      native:this.platform==='darwin'?'macOS':this.platform==='win32'?'Windows':null};
  }
  definition() {
    if(!this.enabled||!this.available)return null;
    // Platform-specific imports, never instantiate the opposite OS adapter.
    const source=this.platform==='darwin'?'./macos-computer-use.cjs':'./windows-computer-use.cjs';
    const definition=registeredComputerUse(require(source).definition,this.deviceIdentity);
    return definition;
  }
  newController() {
    if(this.platform==='darwin') {
      if(this.createMac)return this.createMac();
      const {MacComputerUse}=require('./macos-computer-use.cjs');
      return new MacComputerUse({platform:'darwin',helperPath:this.helper,deviceId:this.deviceIdentity.id,authorizationMode:'all_windows',onPermissionDenied:code=>this.noticePermission(code)});
    }
    if(this.platform==='win32') {
      if(this.createWindows)return this.createWindows();
      const {WindowsComputerUse}=require('./windows-computer-use.cjs');
      return new WindowsComputerUse({platform:'win32',helperPath:this.helper,deviceId:this.deviceIdentity.id,authorizationMode:'all_windows',onPermissionDenied:code=>this.noticePermission(code)});
    }
    throw new Error('CU_PLATFORM_UNSUPPORTED');
  }
  async checkPermissions({request=false}={}) {
    const permission=await this.permissions.check({request});
    this.permission=permission;
    return permission;
  }
  noticePermission(code) {
    if(!this.enabled || !permissionCode({code}))return;
    this.setEnabled(false);
    this.permission={...(this.permission||{platform:this.platform}),granted:false,
      missing:code==='CU_SCREEN_RECORDING_REQUIRED'?['screen_recording']:
        code==='CU_ACCESSIBILITY_REQUIRED'?['accessibility']:[],
      code};
    this.onPermissionRequired?.(this.permission);
  }
  setEnabled(enabled) {
    if(typeof enabled!=='boolean')throw new Error('CU_INVALID_ENABLED');
    if(enabled&&!this.available)throw new Error('CU_HELPER_UNAVAILABLE');
    if(this.enabled===enabled)return;
    if(!enabled)this.stop();
    this.enabled=enabled;
  }
  stop() {
    ++this.epoch;
    for(const controller of this.active)controller.abort();
    this.active.clear();
    this.controller?.stop('CU_DISABLED');
    this.controller=null;
  }
  async call(args,{signal,planner}={}) {
    if(!this.enabled||!this.available)return this.denied();
    const {error,nativeArgs}=deviceBoundArgs(this.deviceIdentity,args);
    if(error)return error;
    const epoch=this.epoch;
    const abort=new AbortController();
    const onAbort=()=>abort.abort();
    if(signal?.aborted)abort.abort();
    else signal?.addEventListener('abort',onAbort,{once:true});
    if(abort.signal.aborted)return this.denied();
    this.active.add(abort);
    try {
      if(!this.controller)this.controller=this.newController();
      // Planner belongs to THIS start request, not a mutable global controller property.
      const result=await this.controller.call(nativeArgs,{signal:abort.signal,...(typeof planner==='function'?{planner}:{})});
      if(epoch===this.epoch && this.enabled) {
        const code=permissionCode(result);
        if(code) { this.noticePermission(code); return result; }
      }
      // A disabling user action wins over a late screenshot or input result.
      return epoch===this.epoch&&this.enabled&&!abort.signal.aborted?result:this.denied(true);
    } catch (error) {
      if(epoch===this.epoch && this.enabled && permissionCode({code:error?.code}))
        this.noticePermission(error.code);
      return this.denied(true);
    } finally {
      this.active.delete(abort);
      signal?.removeEventListener('abort',onAbort);
    }
  }
  denied(started=false) {
    const data={code:'CU_DISABLED',execution_state:started?'unknown':'not_started',
      operation_executed:started?null:false,next_action:'Enable Computer Use in MCP Servers'};
    return {isError:true,content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};
  }
  dispose(){this.stop();this.enabled=false;}
}
module.exports={ComputerUseSwitch};
