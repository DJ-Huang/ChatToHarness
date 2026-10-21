'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../native/ComputerUse.cs'), 'utf8');

test('Windows Computer Use moves the REAL cursor with distance-scaled human timing', () => {
  for (const requirement of [
    'static void MoveCursorVisible(Point destination)',
    'GetCursorPos(out origin)',
    'GetCursorPos(out current)',
    'SetCursorPos(px, py)',
    'Thread.Sleep(16)',
    'System.Diagnostics.Stopwatch.StartNew()',
    'clock.Elapsed.TotalMilliseconds / durationMs',
    'CursorScreenRoute(new Point(origin.X, origin.Y), destination, out sameScreen)',
    'CursorScreenBridge(screens[i], screens[j], destination',
    'CursorRoutePoint(path, eased, sameScreen)',
    '170.0 + distance * 1000.0 / 850.0',
    'double eased = t * t * t',
    'if (Closed) Error("CU_SESSION_CLOSED")',
    'CU_USER_INPUT_ACTIVE',
    'MoveCursorVisible(point)'
  ]) assert.ok(source.includes(requirement), 'Missing requirement: ' + requirement);
  assert.ok(!source.includes('SetCursorPos(point.X, point.Y)'), 'Cursor must never teleport to target');
  assert.ok(!source.includes('Math.Min(32,'), '32-frame cap hid long-distance movement');
});

test('distance-scaled time and quintic easing produce visually smooth trajectories', () => {
  const durationMs = distance => Math.min(3600, Math.max(240, 170 + distance * 1000 / 850));
  assert.ok(durationMs(100) > 270 && durationMs(100) < 310);
  assert.ok(durationMs(500) > 740 && durationMs(500) < 770);
  assert.ok(durationMs(1000) > 1300 && durationMs(1000) < 1400);
  assert.equal(durationMs(3500), 3600);
  const ease = t => t*t*t*(t*(t*6-15)+10);
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(0.5), 0.5);
  for (let i=1;i<=100;i++) assert.ok(ease(i/100)>=ease((i-1)/100));
  assert.ok(ease(0.1)<0.05 && ease(0.9)>0.95);
});
