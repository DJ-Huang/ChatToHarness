'use strict';

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

module.exports = {guidanceRetry, recoveryKind, presentExecution};
