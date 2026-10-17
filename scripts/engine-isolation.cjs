'use strict';
const fs = require('node:fs');
const path = require('node:path');
const PATCHES = [
  ['utils/toolHistory.js', "const historyDir = path.join(os.homedir(), '.claude-server-commander');", "const historyDir = process.env.LOCALHARNESS_DC_HOME || path.join(os.homedir(), '.claude-server-commander'); // ChatToHarness isolated history"],
  ['utils/fuzzySearchLogger.js', "const logDir = path.join(os.homedir(), '.claude-server-commander-logs');", "const logDir = process.env.LOCALHARNESS_DC_HOME ? path.join(process.env.LOCALHARNESS_DC_HOME, 'logs') : path.join(os.homedir(), '.claude-server-commander-logs'); // ChatToHarness isolated history"]
];
function isolateHistory(packageRoot) {
  for (const [name, original, replacement] of PATCHES) {
    const file = path.join(packageRoot, 'dist', name), source = fs.readFileSync(file, 'utf8');
    if (source.includes(replacement)) continue;
    if (source.split(original).length !== 2) throw new Error(`Desktop Commander isolation patch no longer matches ${name}; preparation stopped.`);
    fs.writeFileSync(file, source.replace(original, replacement));
  }
}
function fixPdfFontNames(packageRoot) {
  const file = path.resolve(packageRoot, '../../@opendocsg/pdf2md/lib/models/transformations/text-item/CalculateGlobalStats.js');
  const original = 'const fontName = value.name.toLowerCase()';
  const replacement = "const fontName = String(value.name || value.fontFamily || '').toLowerCase() // ChatToHarness: PDF.js may omit font.name";
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(replacement)) return;
  if (source.split(original).length !== 2) throw new Error('PDF font-name compatibility patch no longer matches the pinned dependency.');
  fs.writeFileSync(file, source.replace(original, replacement));
}
function patchEngine(packageRoot) { isolateHistory(packageRoot); fixPdfFontNames(packageRoot); }
module.exports = {isolateHistory, fixPdfFontNames, patchEngine, PATCHES};
