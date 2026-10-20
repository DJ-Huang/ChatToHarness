'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {Client} = require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport} = require('@modelcontextprotocol/sdk/client/stdio.js');
const root = path.resolve(__dirname, '..');
const resources = path.resolve(process.argv[2] || path.join(root, 'dist/win-unpacked/resources'));
const output = path.join(root, '.cache/acceptance/computer-use');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cth-packaged-computer-use 中文 '));
const report = {platform: process.platform + '-' + process.arch, portable: false, mcp: false, native: false};
async function main() {
  if (process.platform !== 'win32') throw new Error('Windows package required.');
  // Neither source-checkout resolution nor a developer's existing MCP config is
  // available from this relocated package. Only bundled production files run.
  const directory = path.join(temporary, 'computer-use');
  fs.cpSync(path.join(resources, 'computer-use'), directory, {recursive: true});
  const node = path.join(temporary, 'node/node.exe');
  fs.mkdirSync(path.dirname(node)); fs.copyFileSync(path.join(resources, 'node/node.exe'), node);
  assert.equal(fs.existsSync(path.join(directory, 'mcp-config.json')), false, 'source config must not ship');
  assert.equal(fs.existsSync(path.join(directory, 'node_modules/electron')), false, 'dev dependencies must not ship');
  report.node = execFileSync(node, ['--version'], {encoding: 'utf8', windowsHide: true}).trim();
  const config = JSON.parse(execFileSync(node, [path.join(directory, 'configure.cjs')], {encoding: 'utf8', windowsHide: true}));
  const launch = config.mcpServers['windows-computer'];
  assert.equal(launch.command, node); assert.equal(launch.args[0], path.join(directory, 'app/windows-computer-use-stdio.cjs'));
  const client = new Client({name: 'packaged-computer-use-acceptance', version: '1'});
  try {
    await client.connect(new StdioClientTransport({...launch, cwd: temporary, stderr: 'pipe', env: {SystemRoot: process.env.SystemRoot, TEMP: os.tmpdir()}}));
    const list = await client.listTools(); assert.equal(list.tools.length, 1); assert.equal(list.tools[0].name, 'computer_use');
    const invalid = await client.callTool({name: 'computer_use', arguments: {action: 'observe', session_id: 'not-a-session'}});
    assert.equal(invalid.isError, true); assert.equal(invalid.structuredContent.code, 'CU_SESSION_CLOSED');
    report.mcp = true;
  } finally { await client.close(); }
  report.portable = true;
  report.nativeSummary = execFileSync(process.execPath, [path.join(__dirname, 'test-computer-use-native.cjs'), path.join(directory, 'ChatToHarness.ComputerUse.exe')], {encoding: 'utf8', windowsHide: true, timeout: 55000}).trim();
  assert.match(report.nativeSummary, /^NATIVE_ACCEPTANCE_PASS:/); report.native = true;
  // Provide a local ready-to-import config for the unpacked artifact. Installed
  // copies generate their own paths by running configure.cjs with bundled Node.
  const configText = execFileSync(path.join(resources, 'node/node.exe'), [path.join(resources, 'computer-use/configure.cjs')], {encoding: 'utf8', windowsHide: true});
  fs.writeFileSync(path.join(root, 'dist/windows-computer-use-mcp-config.json'), configText);
}
main().catch(error => { report.error = error.message; process.exitCode = 1; }).finally(() => {
  fs.mkdirSync(output, {recursive: true}); fs.writeFileSync(path.join(output, 'packaged-result.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('cth-packaged-computer-use ')) fs.rmSync(resolved, {recursive: true, force: true, maxRetries: 4, retryDelay: 300});
});
