'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {BaseComputerUse,baseDefinition}=require('../app/base-computer-use.cjs');
const {MacComputerUse,definition: macDefinition}=require('../app/macos-computer-use.cjs');
const {WindowsComputerUse,definition: winDefinition}=require('../app/windows-computer-use.cjs');
const {filterForPlatform}=require('../scripts/packaging-platform.cjs');
const {MACOS_FILES,WINDOWS_FILES}=require('../scripts/prepare-computer-use.cjs');

test('both desktop adapters inherit from BaseComputerUse, never from each other',()=>{
  assert.equal(Object.getPrototypeOf(MacComputerUse.prototype),BaseComputerUse.prototype);
  assert.equal(Object.getPrototypeOf(WindowsComputerUse.prototype),BaseComputerUse.prototype);
  const macSource=fs.readFileSync(path.resolve(__dirname,'../app/macos-computer-use.cjs'),'utf8');
  assert.doesNotMatch(macSource,/require\(['"]\.\/windows-computer-use\.cjs['"]\)/);
  const windowsSource=fs.readFileSync(path.resolve(__dirname,'../app/windows-computer-use.cjs'),'utf8');
  assert.doesNotMatch(windowsSource,/require\(['"]\.\/macos-computer-use\.cjs['"]\)/);
});
test('Mac and Windows share the complete MCP input contract, atomic drag and session title',()=>{
  const normalize = schema => {
    const copy=structuredClone(schema);
    copy.properties.session_title.description='';
    return copy;
  };
  assert.deepEqual(normalize(macDefinition.inputSchema),normalize(winDefinition.inputSchema));
  assert.deepEqual(macDefinition.outputSchema,winDefinition.outputSchema);
  const windowsBase=structuredClone(baseDefinition.inputSchema);
  delete windowsBase.properties.session_title;
  const windowsInput=structuredClone(winDefinition.inputSchema);
  delete windowsInput.properties.session_title;
  assert.deepEqual(windowsInput,windowsBase);
  for(const schema of [macDefinition,winDefinition]){
    assert.ok(schema.inputSchema.properties.action.enum.includes('drag_window'));
    assert.equal(schema.inputSchema.properties.session_title.maxLength,80);
    assert.equal(schema.inputSchema.required.includes('session_title'),false);
  }
  assert.match(macDefinition.description,/Screen Recording/);
  assert.match(winDefinition.description,/Windows/);
  for(const schema of [macDefinition,winDefinition]) {
    assert.ok(schema.inputSchema.properties.action.enum.includes('read_screenshot'));
    assert.ok(schema.inputSchema.properties.action.enum.includes('close_session'));
  }
});
test('platform selection cannot be bypassed by overriding supportedPlatform',async()=>{
  const mac=new MacComputerUse({platform:'win32',supportedPlatform:'win32',connect:()=>{throw Error('wrong OS helper started')}});
  const win=new WindowsComputerUse({platform:'darwin',supportedPlatform:'darwin',connect:()=>{throw Error('wrong OS helper started')}});
  assert.equal((await mac.call({action:'get_session'})).structuredContent.code,'CU_MACOS_REQUIRED');
  assert.equal((await win.call({action:'get_session'})).structuredContent.code,'CU_WINDOWS_REQUIRED');
});
test('platform filters exclude only the other OS JS adapters and native programs',()=>{
  const mac=filterForPlatform('darwin'),win=filterForPlatform('win32');
  assert.deepEqual(filterForPlatform('linux'),{files:[],resources:[]});
  for(const target of ['app/windows-computer-use.cjs','app/windows-computer-use-stdio.cjs']) {
    assert.ok(mac.files.includes('!'+target));
    assert.ok(mac.resources.includes('!'+target.replace(/^app\//,'app/')));
  }
  assert.ok(mac.resources.includes('!ChatToHarness.ComputerUse.exe'));
  assert.ok(!mac.resources.includes('!ChatToHarness.MacComputerUse'));
  for(const target of ['app/macos-computer-use.cjs','app/macos-computer-use-stdio.cjs']) {
    assert.ok(win.files.includes('!'+target));
    assert.ok(win.resources.includes('!'+target));
  }
  assert.ok(win.resources.includes('!ChatToHarness.MacComputerUse'));
  assert.ok(!win.resources.includes('!ChatToHarness.ComputerUse.exe'));
  for(const name of ['app/base-computer-use.cjs','app/computer-use-images.cjs','app/computer-use-devices.cjs'])
    assert.ok(!mac.files.includes('!'+name)&&!win.files.includes('!'+name));
  for(const name of ['app/computer-use-stdio.cjs']) {
    assert.ok(mac.files.includes('!'+name));
    assert.ok(win.files.includes('!'+name));
  }
});
test('staged platform resource manifests contain BaseComputerUse but not opposite adapter',()=>{
  for(const names of [MACOS_FILES,WINDOWS_FILES]) {
    assert.ok(names.includes('computer-use/app/base-computer-use.cjs'));
    assert.ok(names.includes('computer-use/app/computer-use-images.cjs'));
  }
  assert.ok(MACOS_FILES.includes('computer-use/app/macos-computer-use.cjs'));
  assert.ok(!MACOS_FILES.some(x=>x.includes('windows-computer-use.cjs')||x.endsWith('.exe')));
  assert.ok(WINDOWS_FILES.includes('computer-use/app/windows-computer-use.cjs'));
  assert.ok(!WINDOWS_FILES.some(x=>x.includes('macos-computer-use.cjs')||x.endsWith('MacComputerUse')));
});
test('current OS builder config applies the selection to both asar and extra resources',()=>{
  const config=require('../electron-builder.config.cjs');
  const platform=filterForPlatform(process.platform);
  for(const rule of platform.files)assert.ok(config.files.includes(rule));
  if(platform.resources.length){
    const rule=config.extraResources.find(x=>x.to==='computer-use');
    assert.deepEqual(rule.filter,platform.resources);
    assert.ok(config.extraResources.some(x=>x.to==='computer-use/node_modules'));
  }
});
