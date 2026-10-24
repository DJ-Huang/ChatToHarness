'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ID_FILE = 'computer-use-device-id';
// Not an authentication token. This random, durable ID is a routing label that
// remains unambiguous even when multiple laptops have the same hostname.
function localComputerIdentity(home, platform = process.platform, hostname = os.hostname()) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new Error('CU_DEVICE_ID_UNAVAILABLE');
  fs.mkdirSync(home, {recursive:true,mode:0o700});
  const file = path.join(home,ID_FILE);
  let id;
  try {
    const stat=fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size>128) throw new Error('CU_DEVICE_ID_INVALID');
    id=fs.readFileSync(file,'utf8').trim();
    if (!/^cu-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('CU_DEVICE_ID_INVALID');
  } catch(error) {
    if (error.code !== 'ENOENT') throw error;
    id='cu-'+crypto.randomUUID();
    try {fs.writeFileSync(file,id+'\n',{flag:'wx',mode:0o600});}
    catch(error) {
      if (error.code !== 'EEXIST') throw error;
      // Concurrent launches share the first safely created identity.
      id=fs.readFileSync(file,'utf8').trim();
      if(!/^cu-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))throw new Error('CU_DEVICE_ID_INVALID');
    }
  }
  return {id,platform,name:hostname};
}

// The connector identifies its own device, so no cross-machine presence roster
// is necessary. This is a routing constraint, not proof of human consent.
function deviceSelection(self, targetDeviceId) {
  // The selected MCP connector already identifies the physical device.
  // ChatGPT discovers that identity from tools/list; no UUID input is needed.
  // Keep an optional explicit ID as a cross-device mismatch guard.
  if (targetDeviceId === undefined) return null;
  if (typeof targetDeviceId !== 'string' || !targetDeviceId || targetDeviceId.length > 100)
    return {code:'CU_INVALID_ARGUMENT', device:self};
  if (targetDeviceId !== self.id)
    return {code:'CU_TARGET_DEVICE_MISMATCH', device:self};
  return null;
}

function computerUseHome(platform=process.platform, env=process.env, userHome=os.homedir()) {
  if (env.LOCALHARNESS_HOME && path.isAbsolute(env.LOCALHARNESS_HOME)) return env.LOCALHARNESS_HOME;
  if (platform==='darwin') return path.join(userHome,'Library','Application Support','LocalHarness');
  if (platform==='win32') return path.win32.join(env.APPDATA || path.win32.join(userHome,'AppData','Roaming'),'ChatToHarness');
  throw new Error('CU_PLATFORM_UNSUPPORTED');
}

// Pure resolver for a trusted chat-level router. A standalone Harness cannot
// read the list of other connectors or verify the conversation's device binding.
function resolveComputerUseDevice({devices,explicitDeviceId,explicitDeviceName,sessionDeviceId}={}) {
  if(!Array.isArray(devices)||devices.length>32)throw new Error('CU_INVALID_DEVICE_LIST');
  const seen=new Set(),available=[];
  for(const d of devices){
    if(!d||typeof d.id!=='string'||typeof d.name!=='string'||
       !['darwin','win32'].includes(d.platform)||!d.id||!d.name||d.name.length>128)
      throw new Error('CU_INVALID_DEVICE_LIST');
    if(d.available===false||seen.has(d.id))continue;
    seen.add(d.id);available.push({id:d.id,name:d.name,platform:d.platform});
  }
  available.sort((a,b)=>a.platform.localeCompare(b.platform)||
    a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
  const options=available.map((d,i)=>({number:i+1,device_id:d.id,
    name:d.name,platform:d.platform,
    label:`${i+1}. ${d.name} (${d.platform==='darwin'?'macOS':'Windows'})`}));
  const choose=reason=>({status:'selection_required',reason,options});
  if(!available.length)return {status:'unavailable',reason:'no_connected_devices',options:[]};
  if(explicitDeviceId!==undefined||explicitDeviceName!==undefined){
    if(explicitDeviceId!==undefined&&(typeof explicitDeviceId!=='string'||!explicitDeviceId))
      throw new Error('CU_INVALID_DEVICE_TARGET');
    if(explicitDeviceName!==undefined&&(typeof explicitDeviceName!=='string'||!explicitDeviceName.trim()))
      throw new Error('CU_INVALID_DEVICE_TARGET');
    const name=typeof explicitDeviceName==='string'?explicitDeviceName.trim().toLowerCase():null;
    const matches=available.filter(d=>
      (explicitDeviceId===undefined||d.id===explicitDeviceId)&&
      (name===null||d.name.toLowerCase()===name||
       ((name==='mac'||name==='macos')&&d.platform==='darwin')||
       ((name==='win'||name==='windows')&&d.platform==='win32')));
    if(matches.length===1)return {status:'selected',source:'explicit',device:matches[0]};
    return choose(matches.length?'explicit_target_ambiguous':'explicit_target_unavailable');
  }
  if(sessionDeviceId!==undefined&&sessionDeviceId!==null){
    if(typeof sessionDeviceId!=='string'||!sessionDeviceId)throw new Error('CU_INVALID_SESSION_BINDING');
    const bound=available.find(d=>d.id===sessionDeviceId);
    if(bound)return {status:'selected',source:'session',device:bound};
    return choose('session_device_unavailable');
  }
  if(available.length===1)return {status:'selected',source:'single_device',device:available[0]};
  return choose('unbound_multiple_devices');
}

const COMPUTER_USE_GUI_RULE =
  'For graphical desktop interaction, use native computer_use mouse and keyboard events by default. For window dragging use observe, mouse_move, mouse_down, observe, mouse_drag, mouse_up, then verify. Never silently replace visible dragging with shell, AppleScript, Accessibility or Win32 window positioning. Direct setpos/setsize needs explicit user intent and permission. Do not replay uncertain input or bypass STOP/Esc. After completing or abandoning a GUI task, always call close_session and confirm closed=true BEFORE telling the user it is finished, even if the task succeeded.';
const COMPUTER_USE_DEVICE_RULE =
  'Device routing priority: explicit user target > device reliably associated with the current ChatGPT conversation > sole available computer_use device > numbered 1/2/3 choices by friendly name/platform. If the session is associated with this device and no other target is specified, operate without prompting even with multiple harnesses connected. If association is unknown and multiple devices are available, ask the user to choose a number. Never ask for a device UUID. A local harness cannot infer ChatGPT conversation binding or list other connectors.';

function registeredComputerUse(base,device) {
  const definition=structuredClone(base);
  definition.title=`Computer Use · ${device.name} (${device.platform==='darwin'?'macOS':'Windows'})`;
  // Optional diagnostic guard, NOT a user-facing field or a prerequisite
  // for normal operation. The selected tool is already device-scoped.
  definition.inputSchema.properties.target_device_id={
    type:'string',const:device.id,
    description:`Optional internal device assertion for ${device.name}; omit for normal calls. If supplied, it must equal the registered device ID.`
  };
  definition.inputSchema.required=(definition.inputSchema.required||[]).filter(name=>name!=='target_device_id');
  definition._meta={...(definition._meta||{}),
    'com.chattoharness/device':{id:device.id,name:device.name,platform:device.platform},
    'com.chattoharness/computer-use-policy':{
      version:1,default_operation:'native_real_input',
      device_priority:['explicit','current_chat_session','sole_device','numbered_selection'],
      policy_document:'docs/computer-use-policy.md'
    }};
  definition.description+=` This tool controls ONLY ${device.name} (${device.platform}), device ID ${device.id}. The connector automatically binds its own ID; target_device_id is optional and verifies explicit assertions only. ${COMPUTER_USE_DEVICE_RULE} ${COMPUTER_USE_GUI_RULE} Local window authorization, Screen Recording/Accessibility and STOP/Esc remain mandatory.`;
  return definition;
}

function selectionResult(detail) {
  const data={...detail,execution_state:'not_started',operation_executed:false,
    next_action:detail.code==='CU_DEVICE_SELECTION_REQUIRED'
      ? 'Ask the user to identify the target computer, then pass its advertised target_device_id using that device connector.'
      : detail.code==='CU_TARGET_DEVICE_MISMATCH'
        ? 'Use the Computer Use tool registered by the device the user explicitly selected.'
        : 'Use the exact target_device_id advertised in the tool registration.'};
  return {isError:true,content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};
}

function deviceBoundArgs(device,args) {
  const error=deviceSelection(device,args?.target_device_id);
  if(error)return {error:selectionResult(error)};
  if(!args || typeof args!=='object' || Array.isArray(args))
    return {error:selectionResult({code:'CU_INVALID_ARGUMENT'})};
  const {target_device_id: _target, ...nativeArgs}=args;
  // Tool-namespace selection binds this exact endpoint to its registered ID.
  return {nativeArgs, resolvedDeviceId:device.id};
}

module.exports={localComputerIdentity,computerUseHome,deviceSelection,resolveComputerUseDevice,registeredComputerUse,selectionResult,deviceBoundArgs,COMPUTER_USE_GUI_RULE,COMPUTER_USE_DEVICE_RULE};
