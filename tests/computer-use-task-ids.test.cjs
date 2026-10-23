'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {create,existing,validId,NEW_RE}=require('../app/computer-use-task-ids.cjs');

test('public GUI task ID is actual device ID plus millisecond timestamp, with a collision suffix; no legacy hash form',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cu-task-id-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const service={deviceId:'cu-12345678-1234-4234-9234-123456789abc'};
  const original=Date.now;
  Date.now=()=>1761190000123;
  try{
    const a=create(dir,service,'session-a','key-a',{schema:2,session_id:'session-a'});
    const b=create(dir,service,'session-a','key-b',{schema:2,session_id:'session-a'});
    assert.equal(a.task_id,service.deviceId+'_1761190000123');
    assert.equal(b.task_id,service.deviceId+'_1761190000123_1');
    assert.ok(NEW_RE.test(a.task_id)&&validId(b.task_id));
    assert.equal(existing(dir,'session-a','key-a'),a.task_id);
    assert.equal(existing(dir,'session-a','key-b'),b.task_id);
    assert.equal(create(dir,service,'session-a','key-a',{schema:2}).reused,true);
    assert.equal(validId('cu_agent_'+'a'.repeat(64)),false);
    assert.equal(validId('cu_task_'+'a'.repeat(64)),false);
    assert.equal(fs.statSync(path.join(dir,a.task_id+'.json')).isFile(),true);
  }finally{Date.now=original;}
});
test('invalid device IDs cannot enter public GUI task IDs',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cu-task-device-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  assert.throws(()=>create(dir,{deviceId:'rocket'},'s','k',{}),{code:'CU_DEVICE_ID_UNAVAILABLE'});
});
