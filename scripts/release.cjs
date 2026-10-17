'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function version(tag = '', directory = root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json')));
  if (!stable.test('v' + manifest.version) || lock.version !== manifest.version || lock.packages[''].version !== manifest.version) throw new Error('Application and lockfile versions must match.');
  if (tag && tag !== 'v' + manifest.version) throw new Error('Release tag must equal v' + manifest.version);
  return manifest.version;
}
function gh(args, json = true, input) {
  const output = execFileSync('gh', args, {encoding:'utf8', input: input === undefined ? undefined : JSON.stringify(input), stdio:['pipe','pipe','pipe']});
  return json ? JSON.parse(output) : output;
}
function api(route, body, method) {return gh(['api', route, ...(method ? ['--method',method] : []), ...(body ? ['--input','-'] : [])], true, body);}
function requireDraft(release) {if (release && !release.draft) throw new Error('Refusing to replace an already published release.');}
function findRelease(repo, tag) {
  return gh(['api', `repos/${repo}/releases?per_page=100`, '--paginate','--slurp']).flat().find(item => item.tag_name === tag);
}
function sha(file) {return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function assets(directory, appVersion) {
  const names = [`ChatToHarness-${appVersion}-windows-x64-setup.exe`, `ChatToHarness-${appVersion}-macos-arm64.dmg`];
  const present = fs.readdirSync(directory).filter(name => /\.(exe|dmg)$/.test(name)).sort();
  if (JSON.stringify(present) !== JSON.stringify([...names].sort())) throw new Error('Exactly the two matching native installers are required.');
  return names.map(name => {const file=path.join(directory,name);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||!stat.size)throw new Error('Missing installer: '+name);return file;});
}
async function main() {
  const command = process.argv[2] || 'check';
  if (!['check','draft'].includes(command)) throw new Error('Expected check or draft.');
  const tag = process.env.RELEASE_TAG || '';
  const appVersion = version(tag);
  const repo = process.env.GITHUB_REPOSITORY;
  if (tag && (!repo || !stable.test(tag))) throw new Error('A stable tag and repository are required.');
  if (tag) requireDraft(findRelease(repo,tag));
  if(command==='check'){console.log('Version verified: '+appVersion);return;}
  if (!tag) throw new Error('Draft creation requires RELEASE_TAG.');
  const commit = api(`repos/${repo}/commits/${tag}`);
  if(commit.sha!==process.env.GITHUB_SHA)throw new Error('Release tag moved away from the workflow commit.');
  const directory=path.resolve(process.argv[3]||path.join(root,'dist','release'));
  const files=assets(directory,appVersion);
  const sums=path.join(directory,'SHA256SUMS.txt');
  fs.writeFileSync(sums,files.map(file=>`${sha(file)}  ${path.basename(file)}\n`).join(''));files.push(sums);
  let release=findRelease(repo,tag);requireDraft(release);
  const signed=process.env.CTH_SIGNED==='1';
  const signing=signed?'本次构建启用了正式签名，并验证 Mac 公证。':'Windows 安装包未签名；Mac 使用临时签名且未公证。系统可能提示或阻止安装。';
  const runURL=`https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const managed=`<!-- CTH BUILD STATUS START -->\n${signing}\n\n双平台自动检查结果见[构建记录](${runURL})。人工安装体验与真实客户端验收单独记录。\n\n请检查安装包与 SHA256SUMS.txt 后正式发布。\n<!-- CTH BUILD STATUS END -->`;
  if(!release){
    const notes=api(`repos/${repo}/releases/generate-notes`,{tag_name:tag}).body;
    release=api(`repos/${repo}/releases`,{tag_name:tag,name:`ChatToHarness ${appVersion}`,draft:true,prerelease:false,body:managed+'\n\n'+notes});
  }else{
    // Keep authored notes, but always refresh our build status when a draft is
    // rebuilt with different signing credentials. Never leave a stale claim.
    release=api(`repos/${repo}/releases/${release.id}`);requireDraft(release);
    const previous=release.body||'';
    const block=/<!-- CTH BUILD STATUS START -->[\s\S]*?<!-- CTH BUILD STATUS END -->/;
    api(`repos/${repo}/releases/${release.id}`,{body:block.test(previous)?previous.replace(block,managed):managed+'\n\n'+previous},'PATCH');
  }
  for(const file of files){requireDraft(api(`repos/${repo}/releases/${release.id}`));gh(['release','upload',tag,file,'--repo',repo,'--clobber'],false);}
  const uploaded=gh(['api',`repos/${repo}/releases/${release.id}/assets?per_page=100`,'--paginate','--slurp']).flat();
  for(const file of files){
    const asset=uploaded.find(item=>item.name===path.basename(file));
    if(!asset||asset.size!==fs.statSync(file).size)throw new Error('Uploaded asset size mismatch.');
    if(asset.digest){if(asset.digest!=='sha256:'+sha(file))throw new Error('Uploaded checksum mismatch.');}
    else {const bytes=execFileSync('gh',['api',`repos/${repo}/releases/assets/${asset.id}`,'-H','Accept: application/octet-stream'],{maxBuffer:1024*1024*1024});if(crypto.createHash('sha256').update(bytes).digest('hex')!==sha(file))throw new Error('Downloaded checksum mismatch.');}
  }
  requireDraft(api(`repos/${repo}/releases/${release.id}`));
  console.log('Release draft ready: '+release.html_url);
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## 安装包草稿\n\n[检查并正式发布](${release.html_url})\n\n双平台安装包及 SHA-256 已核对。\n`);
}
module.exports={version,requireDraft,assets,sha};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
