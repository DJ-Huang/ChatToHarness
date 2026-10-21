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

function verifiedDevices(roster) {
  if (!roster || roster.verified !== true || !Array.isArray(roster.devices) ||
      !Number.isFinite(roster.observed_at) || Math.abs(Date.now()-roster.observed_at)>30000) return null;
  if (roster.devices.length>32 || roster.devices.some(device=>
    !device || typeof device.id!=='string' || !/^cu-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(device.id) ||
    typeof device.name!=='string' || device.name.length>128 ||
    !['darwin','win32'].includes(device.platform))) return null;
  return [...new Map(roster.devices.map(device=>[device.id,{id:device.id,name:device.name,platform:device.platform}])).values()];
}

function deviceSelection(self, targetDeviceId, roster) {
  if (targetDeviceId!==undefined && (typeof targetDeviceId!=='string' || targetDeviceId.length>100))
    return {code:'CU_INVALID_ARGUMENT'};
  if (targetDeviceId && targetDeviceId!==self.id)
    return {code:'CU_TARGET_DEVICE_MISMATCH', device:self};
  const devices=verifiedDevices(roster);
  // A direct MCP harness cannot independently see the other ChatGPT connector.
  // The shared router must pass a *trusted*, fresh online roster here. Never
  // accept a caller-supplied list as proof of connected devices.
  if(roster && !devices) return {code:'CU_DEVICE_ROSTER_UNAVAILABLE'};
  if(devices && !devices.some(device=>device.id===self.id))
    return {code:'CU_DEVICE_ROSTER_UNAVAILABLE'};
  if(devices && devices.length>1 && !targetDeviceId)
    return {code:'CU_DEVICE_SELECTION_REQUIRED', devices};
  return null;
}

module.exports={localComputerIdentity,verifiedDevices,deviceSelection};
