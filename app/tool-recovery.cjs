'use strict';
const DIAGNOSTIC_WORKFLOW='For ChatToHarness tool/error logs use get_execution_summary with the authorized project; add include_connection:true for connection events. For connection/reconnect diagnosis alone use get_harness_status. For task stdout/stderr use get_task_result or get_task_logs. These tools read saved diagnostics without a filesystem log path. Do not guess OS log folders, broaden project_path, request app-storage access or use a shell to bypass folder checks.';

function scopeRecovery(error,name,args={}) {
  if(!['TARGET_OUTSIDE_PROJECT','PATH_NOT_ALLOWED'].includes(error?.code))return {};
  const logRead=['list_directory','read_file','read_multiple_files','get_file_info','get_file_result'].includes(name)&&
    [args.path,...(Array.isArray(args.paths)?args.paths:[])].some(value=>typeof value==='string'&&/(?:^|[/\\])logs?(?:[/\\]|$)|\.log(?:$|\.)/i.test(value));
  return {next_action:logRead?'use_saved_diagnostics':'choose_authorized_target',
    instructions:`This operation did not execute. Keep targets inside the selected project and desktop-authorized folders. Do not broaden the project scope or switch to a shell to bypass this rejection. ${DIAGNOSTIC_WORKFLOW}`,
    ...(logRead?{next_tool:'get_harness_status',next_arguments:{}}:{})};
}

// Guidance is delivered to the caller before it explicitly retries a mutation.
function guidanceRetry(tool, contexts) {
  const delivered = Array.isArray(contexts) && contexts.length > 0 && contexts.every(context =>
    typeof context?.project_context_token === 'string' && context.project_context_token.length > 0 &&
    Array.isArray(context.agents) && Array.isArray(context.loaded_rules) &&
    Array.isArray(context.loaded_skills) && Array.isArray(context.diagnostics) &&
    !context.reused && !context.diagnostics.some(item => item.blocks_writes));
  return {contexts, recovery_kind: 'needs_context',
    next_action: delivered ? 'read_contexts_then_retry' : 'load_project_context_then_retry',
    next_tool: delivered ? tool : 'get_project_context',
    instructions: delivered
      ? 'Read the returned contexts, merge retry_patch into the original arguments, then retry the original tool. Preserve other arguments, including any idempotency_key. The operation has not run.'
      : 'Load the complete project guidance with get_project_context, read it, then retry the original tool with its tokens. The operation has not run.',
    ...(delivered ? {retry_patch: {project_context_tokens: [...new Set(contexts.map(context => context.project_context_token))]}} : {})};
}

// These exact built-in codes have always meant rejection before execution.
// Legacy records may lack execution_state; external tools cannot opt into this
// presentation just by returning a similarly named error or recovery_kind.
function recoveryKind(row) {
  if (!['builtin', 'Harness'].includes(row.service) || row.state !== 'failed' ||
      row.delivery === 'local_write_failed' ||
      (row.execution_state !== undefined && row.execution_state !== 'not_started')) return undefined;
  if (row.error_code === 'context_paths_required') return 'needs_arguments';
  if (row.error_code === 'PROJECT_CONTEXT_REFRESH_REQUIRED') return 'needs_context';
  return undefined;
}
function presentExecution(row) {
  if (!row) return row;
  const {recovery_kind, ...record} = row;
  const kind = recoveryKind(record);
  return kind ? {...record, execution_state: 'not_started', recovery_kind: kind} : record;
}

function taskError(task) {
  if (task.error) return task.error;
  if (task.state === 'timed_out') return {code: 'TASK_TIMED_OUT', message: 'The task exceeded its runtime limit.'};
  if (task.state === 'failed') return Number.isInteger(task.exit_code) && task.exit_code !== 0
    ? {code: 'TASK_EXIT_NONZERO', message: `The command exited with code ${task.exit_code}. Inspect its saved stderr and artifacts.`}
    : {code: 'TASK_FAILED', message: 'The task failed. Inspect its saved output and artifacts.'};
  return {};
}

function recoveryInfo(row) {
  if(!row)return null;
  const info={request_id:row.request_id,tool:row.tool,state:row.state,execution_state:row.execution_state,
    result_status:row.result_status||'not_recorded',instructions:'Inspect original task/results before continuing. Do not replay writes or restart commands. A local response write does not prove the chat received it.'};
  if(row.project)info.project_path=row.project;
  if(row.task_id)info.task_id=row.task_id;
  if(row.result_id)info.result_id=row.result_id;
  if(row.task_id&&row.project)Object.assign(info,{next_tool:'get_task_result',next_arguments:{project_path:row.project,task_id:row.task_id,wait_ms:5000}});
  else if(row.result_id&&row.result_status==='available')Object.assign(info,{next_tool:'get_tool_result_page',next_arguments:{result_id:row.result_id,offset:0}});
  else if(row.project)Object.assign(info,{next_tool:'get_execution_summary',next_arguments:{project_path:row.project,limit:10}});
  return info;
}
module.exports = {guidanceRetry, recoveryKind, presentExecution, recoveryInfo, taskError, scopeRecovery, DIAGNOSTIC_WORKFLOW};
