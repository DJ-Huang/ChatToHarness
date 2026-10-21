'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const stable = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
// Local prerelease installer builds are permitted, but public release tags
// remain strictly stable vX.Y.Z and cannot publish beta artifacts.
const localVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function version(tag = '', directory = root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json')));
  if (!localVersion.test(manifest.version) || lock.version !== manifest.version || lock.packages[''].version !== manifest.version) throw new Error('Application and lockfile versions must match.');
  if (tag && (!stable.test(tag) || tag !== 'v' + manifest.version)) throw new Error('Release tag must equal v' + manifest.version);
  return manifest.version;
}
function gh(args, json = true, input) {
  const output = execFileSync('gh', args, {encoding:'utf8', input: input === undefined ? undefined : JSON.stringify(input), stdio:['pipe','pipe','pipe']});
  return json ? JSON.parse(output) : output;
}
function api(route, body, method) {return gh(['api', route, ...(method ? ['--method',method] : []), ...(body ? ['--input','-'] : [])], true, body);}
function requireDraft(release) {if (release && !release.draft) throw new Error('Refusing to replace an already published release.');}
function findRelease(repo, tag, run = gh) {
  return run(['api', `repos/${repo}/releases?per_page=100`, '--paginate','--slurp']).flat().find(item => item.tag_name === tag);
}
function sha(file) {return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function assets(directory, appVersion) {
  const names = [`ChatToHarness-${appVersion}-windows-x64-setup.exe`, `ChatToHarness-${appVersion}-macos-arm64.dmg`];
  const present = fs.readdirSync(directory).filter(name => /\.(exe|dmg)$/.test(name)).sort();
  if (JSON.stringify(present) !== JSON.stringify([...names].sort())) throw new Error('Exactly the two matching native installers are required.');
  return names.map(name => {const file=path.join(directory,name);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||!stat.size)throw new Error('Missing installer: '+name);return file;});
}
// Upload privately first. A failed upload, digest check, or moved tag leaves a
// draft rather than exposing an incomplete or mismatched public release.
function deliver({repo, tag, appVersion, directory, commitSha, runId, signed = false, publish = true, notes = '', request = api, run = gh, download}) {
  const tagRoute=`repos/${repo}/commits/${tag}`;
  const assertTag=()=>{if(request(tagRoute).sha!==commitSha)throw new Error('Release tag moved away from the workflow commit.');};
  assertTag();
  let release=findRelease(repo,tag,run);requireDraft(release);
  const files=assets(directory,appVersion);
  const sums=path.join(directory,'SHA256SUMS.txt');
  fs.writeFileSync(sums,files.map(file=>`${sha(file)}  ${path.basename(file)}\n`).join(''));files.push(sums);
  const signing=signed
    ? '正式签名已启用，Mac 公证已验证。 / Production signing enabled; Mac notarization verified. / 正式署名を有効化し、Mac 公証を確認済み。'
    : 'Windows 未签名；Mac 临时签名、未公证。系统可能提示或阻止安装。\n\nWindows is unsigned; Mac is ad-hoc signed and not notarized. Your OS may warn or block installation.\n\nWindows は未署名、Mac はアドホック署名のみで公証なしです。OS が警告・制限する場合があります。';
  const runURL=`https://github.com/${repo}/actions/runs/${runId}`;
  const managed=`<!-- CTH BUILD STATUS START -->\n${signing}\n\n[双平台构建与验收 / Build and acceptance / ビルド・検証](${runURL})\n\nWindows x64 · macOS arm64 · SHA256SUMS.txt\n<!-- CTH BUILD STATUS END -->`;
  if(!release){
    const generated=request(`repos/${repo}/releases/generate-notes`,{tag_name:tag});
    release=request(`repos/${repo}/releases`,{tag_name:tag,name:`ChatToHarness ${appVersion}`,draft:true,prerelease:false,body:[managed,notes.trim(),generated.body].filter(Boolean).join('\n\n')});
  }else{
    release=request(`repos/${repo}/releases/${release.id}`);requireDraft(release);
    const previous=release.body||'';
    const block=/<!-- CTH BUILD STATUS START -->[\s\S]*?<!-- CTH BUILD STATUS END -->/;
    request(`repos/${repo}/releases/${release.id}`,{body:block.test(previous)?previous.replace(block,()=>managed):managed+'\n\n'+previous},'PATCH');
  }
  const releaseRoute=`repos/${repo}/releases/${release.id}`;
  for(const file of files){requireDraft(request(releaseRoute));run(['release','upload',tag,file,'--repo',repo,'--clobber'],false);}
  const uploaded=run(['api',`${releaseRoute}/assets?per_page=100`,'--paginate','--slurp']).flat();
  const expected=files.map(file=>path.basename(file)).sort();
  if(JSON.stringify(uploaded.map(asset=>asset.name).sort())!==JSON.stringify(expected))throw new Error('Release must contain exactly both installers and SHA256SUMS.txt.');
  for(const file of files){
    const asset=uploaded.find(item=>item.name===path.basename(file));
    if(!asset||asset.size!==fs.statSync(file).size)throw new Error('Uploaded asset size mismatch.');
    if(asset.digest){if(asset.digest!=='sha256:'+sha(file))throw new Error('Uploaded checksum mismatch.');}
    else {
      const bytes=download?download(asset):execFileSync('gh',['api',`repos/${repo}/releases/assets/${asset.id}`,'-H','Accept: application/octet-stream'],{maxBuffer:1024*1024*1024});
      if(crypto.createHash('sha256').update(bytes).digest('hex')!==sha(file))throw new Error('Downloaded checksum mismatch.');
    }
  }
  assertTag();requireDraft(request(releaseRoute));
  if(publish){
    release=request(releaseRoute,{draft:false,prerelease:false,make_latest:'true'},'PATCH');
    if(release.draft||release.prerelease||release.tag_name!==tag||!release.published_at)throw new Error('Public release confirmation failed.');
  }
  return release;
}
function main() {
  const command = process.argv[2] || 'check';
  if (!['check','draft','publish'].includes(command)) throw new Error('Expected check, draft, or publish.');
  const tag = process.env.RELEASE_TAG || '';
  const appVersion = version(tag);
  const repo = process.env.GITHUB_REPOSITORY;
  if (tag && (!repo || !stable.test(tag))) throw new Error('A stable tag and repository are required.');
  if (tag) requireDraft(findRelease(repo,tag));
  if(command==='check'){console.log('Version verified: '+appVersion);return;}
  if (!tag) throw new Error('Release delivery requires RELEASE_TAG.');
  const noteFile=path.join(root,'release-notes',tag+'.md');
  const release=deliver({repo,tag,appVersion,directory:path.resolve(process.argv[3]||path.join(root,'dist','release')),
    commitSha:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,signed:process.env.CTH_SIGNED==='1',publish:command==='publish',
    notes:fs.existsSync(noteFile)?fs.readFileSync(noteFile,'utf8'):''});
  console.log((command==='publish'?'Release published: ':'Release draft ready: ')+release.html_url);
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`## ${command==='publish'?'Published release':'Release draft'}\n\n[ChatToHarness ${appVersion}](${release.html_url})\n\nBoth native installers and SHA-256 verified.\n`);
}
module.exports={version,requireDraft,assets,sha,deliver};
if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
