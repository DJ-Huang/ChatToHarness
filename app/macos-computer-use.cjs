'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {BaseComputerUse,baseDefinition,SCREENSHOT_DESCRIPTION} = require('./base-computer-use.cjs');

// A distinct service ID preserves the Windows MCP tool's explicit grants.
// Schema, screenshot delivery, session IDs and freshness rules are shared.
const definition = JSON.parse(JSON.stringify(baseDefinition));
definition.title = 'macOS computer use';
definition.inputSchema.properties.session_title = {type:'string',maxLength:80,
  description:'Optional exact visible conversation title supplied by the caller only when reliably known. Omit if not available; never guess.'};
definition.description = [
  'macOS Computer Use. Local macOS Screen Recording and Accessibility permissions are required in addition to MCP tool permission.',
  'A scoped native window is selected at session start; per_window always opens a local consent picker.',
  'Before allowing control, a global local Esc listener and an always-visible STOP panel must be established or the session fails closed.',
  'Window identity and foreground state are checked before input; mouse_move and mouse_down use window screenshot coordinates and consume a fresh observation. mouse_drag requires a held left button, a fresh observation and screen_x/screen_y in Quartz desktop points; mouse_up releases without an observation. For mouse_down and mouse_up, button may be omitted or set to left; right is not a drag button.',
  'open_session accepts optional session_title ONLY if the calling ChatGPT/Codex client actually knows the visible conversation title; never invent or infer it. Omit when unknown; HUD then displays an explicit unavailable label rather than a UUID.',
  'HUD persists the previous operation result and shows the action currently executing. It never displays typed text or screenshot contents.',
  'Coordinates use the native screenshot pixel grid, and the helper converts to desktop points.',
  'CTRL+A/C/V/Z/Y are mapped to macOS Command shortcuts. A supported target may affect files and network; folder permissions are not an input sandbox.',
  'Screenshot delivery follows the same bounded, lossless, single-use observation protocol as Windows. No full-screen capture fallback or persistent screenshot files.',
  'Always invoke close_session when the GUI task finishes, before reporting completion, so STOP, Esc and overlays disappear. A 2-minute idle watchdog is only a fallback.',
  'If permissions are missing, enable them in macOS Privacy & Security and reopen the service; never retry uncertain input automatically.'
].join(' ') + SCREENSHOT_DESCRIPTION;
class MacComputerUse extends BaseComputerUse {
  constructor(options = {}) {
    const helperPath = fs.existsSync(path.join(__dirname, '../ChatToHarness.MacComputerUse'))
      ? path.join(__dirname, '../ChatToHarness.MacComputerUse')
      : path.resolve(__dirname, '../resources/computer-use/ChatToHarness.MacComputerUse');
    const {supportedPlatform: _ignored, ...requested} = options;
    super({
      platform: process.platform,
      supportedPlatform: 'darwin',
      authorizationMode: process.env.CTH_COMPUTER_USE_AUTHORIZATION_MODE || 'all_windows',
      helperPath, ...requested, supportedPlatform: 'darwin'
    });
  }
}
module.exports = {MacComputerUse, definition};
