'use strict';

// ChatGPT may retain a previously advertised MCP schema after a tools/list update.
// Older schemas cannot send session_title even though the native UI requires it.
// Supply a truthful *task* fallback at the service boundary; never invent a
// ChatGPT conversation title or relax native authorization/STOP safeguards.
function withLegacySessionTitle(args) {
  if (args?.action !== 'open_session' || Object.prototype.hasOwnProperty.call(args, 'session_title')) return args;
  return {...args, session_title: '窗口操作（旧版连接器兼容）'};
}

module.exports = {withLegacySessionTitle};
