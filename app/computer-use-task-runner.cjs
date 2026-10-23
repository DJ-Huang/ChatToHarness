'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {privateDirectory, readJson, atomicJson} = require('./durable-files.cjs');
const ids=require('./computer-use-task-ids.cjs');


const TERMINAL = new Set(['succeeded', 'cancelled', 'session_terminated', 'interrupted']);
const now = () => new Date().toISOString();
const problem = code => Object.assign(new Error(code), {code});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A deliberately narrow, authorized GUI workflow. Not a shell task runner.
 * It persists checkpoints but never replays a possibly injected GUI action
 * after a process restart, because the original native session cannot survive.
 */
class ComputerUseTaskRunner {
  constructor(service, {directory = path.join(os.homedir(), '.chattoharness', 'computer-use-tasks'),
    retryDelayMs = 250} = {}) {
    this.service = service;
    this.directory = directory;
    this.retryDelayMs = retryDelayMs;
    this.tasks = new Map();
    this.activeId = null;
  }
  get active() { return this.activeId !== null; }
  file(taskId) {
    if (!ids.validId(taskId))
      throw problem('CU_INVALID_TASK_ID');
    return path.join(this.directory, taskId + '.json');
  }
  save(record) {
    record.updated_at = now();
    atomicJson(this.file(record.task_id), record);
    return record;
  }
  status(taskId, sessionId) {
    let record;
    try { record=readJson(this.file(taskId)); }
    catch (error) { if (error.code==='ENOENT') throw problem('CU_TASK_NOT_FOUND'); throw error; }
    if (record.task_id !== taskId || record.session_id !== sessionId)
      throw problem('CU_TASK_SCOPE_MISMATCH');
    // A new controller must not replay a checkpoint whose former owner vanished.
    if (!TERMINAL.has(record.state) && !this.tasks.has(taskId))
      return {...record, state: 'interrupted', reason: 'CU_OWNER_RESTARTED',
        next_action: 'Open a newly authorized session and create a new task after observing the actual window.'};
    return {...record};
  }
  start({session_id, observation_id, target_x, target_y, idempotency_key}) {
    privateDirectory(this.directory);
    const existing=ids.existing(this.directory,session_id,idempotency_key);
    if (existing) {
      const record = this.status(existing, session_id);
      if (record.goal.x !== target_x || record.goal.y !== target_y)
        throw problem('CU_TASK_IDEMPOTENCY_CONFLICT');
      return {...record, reused: true};
    }
    const session = this.service.session;
    if (!session || session.id !== session_id || session.state !== 'ready')
      throw problem('CU_SESSION_CLOSED');
    const fingerprint = crypto.createHash('sha256')
      .update(JSON.stringify([target_x, target_y, session.windowId])).digest('hex');
    if (!session.observation || session.observation.id !== observation_id ||
        Date.now() - session.observation.at > 30000)
      throw problem('CU_STALE_OBSERVATION');
    if (this.active) throw problem('CU_TASK_RUNNING');
    if (fs.readdirSync(this.directory).filter(name=>name.endsWith('.json')&&!name.startsWith('.key-')).length >= 256)
      throw problem('CU_TASK_STORE_FULL');
    const record = {schema: 2, task_id: null, session_id,
      window_id: session.windowId || null, fingerprint,
      idempotency_digest:ids.keyHash(session_id,idempotency_key),
      kind: 'move', goal: {x: target_x, y: target_y},
      state: 'queued', phase: 'created', created_at: now(),
      updated_at: now(), attempts: 0, cancel_requested: false};
    const allocated=ids.create(this.directory,this.service,session_id,idempotency_key,record);
    if(allocated.reused){
      const old=this.status(allocated.task_id,session_id);
      if(old.goal.x!==target_x||old.goal.y!==target_y)throw problem('CU_TASK_IDEMPOTENCY_CONFLICT');
      return {...old,reused:true};
    }
    const taskId=allocated.task_id;
    this.tasks.set(taskId, record);
    this.activeId = taskId;
    queueMicrotask(() => this.execute(record).catch(() => {
      try {
        if (!TERMINAL.has(record.state))
          this.finish(record, 'interrupted', 'CU_TASK_RUNNER_FAILURE');
      } catch {
        // If persistence itself failed, never leave an uncontrolled native GUI session.
        this.activeId = null;
        this.tasks.delete(record.task_id);
        this.service.stop('CU_TASK_STORE_FAILURE');
      }
    }));
    return {...record, reused: false};
  }
  finish(record, state, reason) {
    if (TERMINAL.has(record.state)) return;
    record.state = state;
    record.phase = 'finished';
    record.finished_at = now();
    if (reason) record.reason = reason;
    this.save(record);
    if (this.activeId === record.task_id) this.activeId = null;
    this.tasks.delete(record.task_id);
    // Verified completion closes native control and its STOP/HUD overlay.
    if (state === 'succeeded' && this.service.session?.id === record.session_id)
      this.service.stop('CU_TASK_COMPLETED');
  }
  onSessionStop(sessionId, code) {
    if (!this.activeId) return;
    const record = this.tasks.get(this.activeId);
    if (record && record.session_id === sessionId)
      this.finish(record, record.cancel_requested ? 'cancelled' : 'session_terminated', code);
  }
  cancel(taskId, sessionId) {
    const snapshot = this.status(taskId, sessionId);
    if (TERMINAL.has(snapshot.state)) return snapshot;
    const record = this.tasks.get(taskId);
    if (!record) return snapshot;
    record.cancel_requested = true;
    this.save(record);
    // Stop the native session to release any held input immediately.
    this.service.stop('CU_TASK_CANCELLED');
    this.finish(record, 'cancelled', 'CU_TASK_CANCELLED');
    return this.status(taskId, sessionId);
  }
  async action(record, args) {
    // Mark the exact step before crossing a native-input boundary.
    record.phase = args.action === 'drag_window' ? 'drag_issued' : args.action;
    this.save(record);
    const result = await this.service.call(args, {internalTaskId: record.task_id});
    // STOP/Esc or explicit cancellation may have won while the native call was pending.
    if (TERMINAL.has(record.state)) throw problem('CU_TASK_STOPPED');
    return result;
  }
  async execute(record) {
    let backoff = this.retryDelayMs;
    while (!TERMINAL.has(record.state)) {
      if (record.cancel_requested) { this.finish(record, 'cancelled', 'CU_TASK_CANCELLED'); break; }
      // The original native session, window identity and permission scope may
      // never be silently swapped to a new session after STOP/Esc.
      const session = this.service.session;
      if (!session || session.id !== record.session_id || session.state !== 'ready') {
        this.finish(record, 'session_terminated', 'CU_SESSION_CLOSED');
        break;
      }
      const status = await this.action(record, {action:'get_session',session_id:record.session_id});
      if (status.structuredContent?.state !== 'ready') {
        this.finish(record, 'session_terminated', 'CU_SESSION_CLOSED');
        break;
      }
      const shot = await this.action(record, {action:'observe',session_id:record.session_id});
      if (!shot.isError) {
        const observation = shot.structuredContent;
        const bounds = observation.window_bounds;
        const goal = record.goal;
        record.last_observed = {x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height};
        record.phase = 'verifying';
        this.save(record);
        // Only a fresh OS observation, never an action return value, can complete the task.
        if (Math.abs(bounds.x-goal.x) <= 2 && Math.abs(bounds.y-goal.y) <= 2) {
          this.finish(record, 'succeeded');
          break;
        }
        const displays = observation.desktop_displays || [];
        const fits = displays.some(d=>goal.x>=d.x && goal.y>=d.y &&
          goal.x+bounds.width<=d.x+d.width && goal.y+bounds.height<=d.y+d.height);
        if (!fits || observation.width < 90) {
          record.phase = 'waiting_for_safe_geometry';
          record.last_error = 'CU_TARGET_OUTSIDE_DISPLAY';
          this.save(record);
        } else {
          const gripX = Math.max(72, Math.min(observation.width - 17, Math.floor(observation.width/2)));
          const gripY = 16;
          record.attempts++;
          const move = await this.action(record,{action:'drag_window',
            session_id:record.session_id,observation_id:observation.observation_id,
            x:gripX,y:gripY,screen_x:goal.x+gripX,screen_y:goal.y+gripY});
          if (!move.isError) {
            record.phase = 'verify_after_drag';
            record.last_error = null;
            this.save(record);
            backoff = this.retryDelayMs;
            // Loop to observe real final geometry; never equate drag returned success with arrival.
            continue;
          }
          const result=move.structuredContent || {};
          record.last_error = result.code || 'CU_UNKNOWN_FAILURE';
          record.phase = 'recovering';
          this.save(record);
          if (result.task_state === 'session_terminated' ||
              this.service.session?.id !== record.session_id) {
            this.finish(record, 'session_terminated', result.code || 'CU_SESSION_CLOSED');
            break;
          }
          if (result.recovery_action === 'activate') {
            // Activation checks user input and does not bypass a user takeover.
            await this.action(record, {action:'activate',session_id:record.session_id});
          }
        }
      } else {
        const error = shot.structuredContent || {};
        record.last_error = error.code || 'CU_OBSERVE_FAILED';
        record.phase = 'recovering';
        this.save(record);
        if (error.task_state === 'session_terminated') {
          this.finish(record, 'session_terminated', error.code);
          break;
        }
      }
      await wait(backoff);
      // Backoff avoids busy loops while a user is holding a button or a target is occluded.
      backoff = Math.min(2000, Math.ceil(backoff * 1.5));
    }
  }
}
module.exports = {ComputerUseTaskRunner, TERMINAL};
