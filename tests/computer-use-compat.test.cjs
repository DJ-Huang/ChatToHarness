'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {withLegacySessionTitle} = require('../app/computer-use-compat.cjs');

test('old MCP open_session schema receives a descriptive task label', () => {
  const input = {action: 'open_session', window_id: '916'};
  const result = withLegacySessionTitle(input);
  assert.equal(result.session_title, '窗口操作（旧版连接器兼容）');
  assert.deepEqual(input, {action: 'open_session', window_id: '916'});
});
test('explicit session and real conversation titles are never changed', () => {
  const input = {action: 'open_session', window_id: '916', session_title: '移动 iTerm2 到第二屏中央', conversation_title: 'Real host metadata'};
  assert.equal(withLegacySessionTitle(input), input);
});
test('other actions and explicit invalid labels are not silently rewritten', () => {
  for (const input of [{action:'observe',session_id:'abc'}, {action:'open_session',session_title:''}]) assert.equal(withLegacySessionTitle(input),input);
});
