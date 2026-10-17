'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {storageDirectory,bundledPaths,defaultShell,taskShellArguments,developmentEnvironment,tunnelCommand,spawnManaged,stopTree}=require('../app/platform.cjs');
const {windowsProcessHost}=require('./native-helper.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(read){const end=Date.now()+7000;while(Date.now()<end){const value=read();if(value)return value;await pause(25);}throw new Error('native fixture timed out');}
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}

test('platform storage preserves the legacy Mac location and uses Windows user app data',()=>{
  assert.equal(storageDirectory({platform:'darwin',userHome:'/Users/example'}),'/Users/example/Library/Application Support/LocalHarness');
  assert.equal(storageDirectory({platform:'win32',userHome:'C:\\Users\\示例',appData:'D:\\Profile Data'}),'D:\\Profile Data\\ChatToHarness');
  assert.equal(storageDirectory({platform:'darwin',override:'/tmp/fixture'}),'/tmp/fixture');
  assert.equal(bundledPaths('C:\\Program Files\\ChatToHarness\\resources','win32').node,'C:\\Program Files\\ChatToHarness\\resources\\node\\node.exe');
  assert.match(bundledPaths('/Applications/ChatToHarness.app/Contents/Resources','darwin').tunnel,/tunnel-client-runtime$/);
  assert.equal(defaultShell('darwin'),'/bin/zsh');
  assert.equal(defaultShell('win32',{SystemRoot:'D:\\Windows'}),'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
});

test('Windows development environments preserve user profile, Git and SSH without duplicate PATH keys',()=>{
  const source={Path:'C:\\Git\\bin;C:\\Windows',USERPROFILE:'C:\\Users\\中文 user',SSH_AUTH_SOCK:'pipe-name',GIT_CONFIG_GLOBAL:'D:\\git settings'};
  const value=developmentEnvironment(source,'D:\\App Folder\\node\\node.exe','win32');
  assert.equal(value.PATH,'D:\\App Folder\\node;'+source.Path);
  assert.equal(value.HOME,source.USERPROFILE);
  assert.equal(value.Path,undefined);
  assert.equal(value.USERPROFILE,source.USERPROFILE);
  assert.equal(value.GIT_CONFIG_GLOBAL,source.GIT_CONFIG_GLOBAL);
  assert.equal(value.SSH_AUTH_SOCK,source.SSH_AUTH_SOCK);
  assert.equal(developmentEnvironment({...source,HOME:'D:\\custom home'},'D:\\node.exe','win32').HOME,'D:\\custom home');
});

test('persistent commands select the configured shell grammar and preserve Unicode', () => {
  const command = 'Write-Output "中文 $value & literal"';
  const argv = taskShellArguments('C:\\Program Files\\PowerShell\\7\\pwsh.exe', command, 'win32');
  assert.equal(argv.at(-2), '-EncodedCommand'); assert.equal(Buffer.from(argv.at(-1), 'base64').toString('utf16le'), command);
  assert.deepEqual(taskShellArguments('C:\\Windows\\System32\\cmd.exe', command, 'win32'), ['/d', '/s', '/c', command]);
  assert.deepEqual(taskShellArguments('/bin/zsh', command, 'darwin'), ['-lc', command]);
  assert.throws(() => taskShellArguments('unknown.exe', command, 'win32'), {code: 'TASK_UNSUPPORTED_SHELL'});
});

// This small decoder mirrors the pinned Tunnel runtime parseCommandArgv grammar.
// It intentionally has no shell expansion or Windows command-line semantics.
function decode(command){let token='',quoted=false,escaped=false;const args=[];for(const c of command){if(escaped){token+=c;escaped=false;}else if(c==='\\'){escaped=true;}else if(c==='"'){quoted=!quoted;}else if(c===' '&&!quoted){args.push(token);token='';}else token+=c;}assert.equal(quoted,false);assert.equal(escaped,false);args.push(token);return args;}
test('Tunnel argv quoting roundtrips Windows drives, UNC, apostrophes and metacharacters',()=>{
  const args=['C:\\Program Files\\ChatToHarness\\node.exe',String.raw`\\host\共享 空间\entry.cjs`,String.raw`C:\Users\O'Brien\source ' " & %USERPROFILE% $HOME.cjs`,'123'];
  assert.deepEqual(decode(tunnelCommand(args)),args);
  for(const invalid of ['', 'line\nbreak','zero\0byte'])assert.throws(()=>tunnelCommand([invalid]));
});

test('Windows Job Object preserves argv and kills detached descendants on helper stop',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'harness job 中文 '));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const report=path.join(directory,'report.json'),grandchild=path.join(directory,'grandchild.pid');
  const childSource=`require('node:fs').writeFileSync(${JSON.stringify(grandchild)},String(process.pid));setInterval(()=>{},1000);`;
  const entry=path.join(directory,"child O'Brien.cjs");
  fs.writeFileSync(entry,`const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(report)},JSON.stringify(process.argv.slice(2)));require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`);
  const args=['中文 folder','C:\\A Folder\\last\\','literal "quote" & %PATH%',"O'Brien"];
  const managed=spawnManaged(process.execPath,[entry,...args],{processHost:windowsProcessHost(),stdio:'ignore'});
  t.after(()=>stopTree(managed));
  const descendant=Number(await waitFor(()=>fs.existsSync(grandchild)&&fs.readFileSync(grandchild,'utf8')));
  assert.deepEqual(JSON.parse(fs.readFileSync(report,'utf8')),args);
  await stopTree(managed);
  await waitFor(()=>!alive(descendant));
});

test('Windows Job Object stops owned descendants when the owner exits',{skip:process.platform!=='win32',timeout:15000},async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'harness owner '));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const pidFile=path.join(directory,'owned.pid'),entry=path.join(directory,'owner.cjs');
  fs.writeFileSync(entry,`const {spawnManaged}=require(${JSON.stringify(path.resolve(__dirname,'../app/platform.cjs'))});spawnManaged(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`)}],{processHost:${JSON.stringify(windowsProcessHost())},stdio:'ignore'});setTimeout(()=>process.exit(0),1500);`);
  const owner=require('node:child_process').spawn(process.execPath,[entry],{stdio:'ignore'});t.after(()=>{try{owner.kill();}catch{}});
  const owned=Number(await waitFor(()=>fs.existsSync(pidFile)&&fs.readFileSync(pidFile,'utf8')));
  await waitFor(()=>owner.exitCode!==null);
  await waitFor(()=>!alive(owned));
});
