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
  if (targetDeviceId === undefined || targetDeviceId === null || targetDeviceId === '')
    return {code:'CU_DEVICE_SELECTION_REQUIRED', device:self};
  if (typeof targetDeviceId !== 'string' || targetDeviceId.length > 100)
    return {code:'CU_INVALID_ARGUMENT'};
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

function registeredComputerUse(base,device) {
  const definition=structuredClone(base);
  definition.title=`Computer Use · ${device.name} (${device.platform==='darwin'?'macOS':'Windows'})`;
  definition.inputSchema.properties.target_device_id={
    type:'string',const:device.id,
    description:`Required device ID for ${device.name} (${device.platform}). Must be exactly ${device.id}. A named or explicitly selected device is required for every call.`
  };
  definition.inputSchema.required=[...new Set([...(definition.inputSchema.required||[]),'target_device_id'])];
  definition._meta={...(definition._meta||{}),'com.chattoharness/device':{
    id:device.id,name:device.name,platform:device.platform
  }};
  definition.description+=` This tool controls ONLY ${device.name} (${device.platform}), device ID ${device.id}. REQUIRED: pass target_device_id=${device.id} in every call. Before calling Computer Use, if the user did not identify which computer to use, ask them to choose one; never infer a choice from the active host, default device or tool order. If they explicitly selected this device, call this specific connector. Missing/mismatched device IDs are rejected locally before native control starts. This ID is a routing constraint, not proof of consent; macOS/Windows permissions, STOP and per-window controls still apply.`;
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
  return {nativeArgs};
}

module.exports={localComputerIdentity,computerUseHome,deviceSelection,registeredComputerUse,selectionResult,deviceBoundArgs};
