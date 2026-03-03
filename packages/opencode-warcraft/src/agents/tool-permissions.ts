/**
 * Per-agent warcraft tool allowlists.
 * Replaces blanket 'allow all' with granular per-role access.
 */

export const WARCRAFT_TOOL_IDS = [
  'warcraft_skill',
  'warcraft_feature_create',
  'warcraft_feature_complete',
  'warcraft_plan_write',
  'warcraft_plan_read',
  'warcraft_plan_approve',
  'warcraft_tasks_sync',
  'warcraft_task_create',
  'warcraft_task_update',
  'warcraft_worktree_create',
  'warcraft_worktree_commit',
  'warcraft_worktree_discard',
  'warcraft_merge',
  'warcraft_batch_execute',
  'warcraft_context_write',
  'warcraft_status',
  'warcraft_agents_md',
] as const;

type WarcraftToolId = (typeof WARCRAFT_TOOL_IDS)[number];

const AGENT_ALLOWLISTS: Record<string, readonly WarcraftToolId[]> = {
  khadgar: [...WARCRAFT_TOOL_IDS],
  mimiron: [
    'warcraft_feature_create',
    'warcraft_plan_write',
    'warcraft_plan_read',
    'warcraft_context_write',
    'warcraft_status',
    'warcraft_skill',
  ],
  saurfang: WARCRAFT_TOOL_IDS.filter((id) => id !== 'warcraft_worktree_commit' && id !== 'warcraft_plan_write'),
  mekkatorque: ['warcraft_plan_read', 'warcraft_worktree_commit', 'warcraft_context_write', 'warcraft_skill'],
  brann: ['warcraft_plan_read', 'warcraft_context_write', 'warcraft_status', 'warcraft_skill'],
  algalon: ['warcraft_plan_read', 'warcraft_context_write', 'warcraft_status', 'warcraft_skill'],
};

/**
 * Apply per-agent warcraft tool permissions.
 * Tools in the agent's allowlist get 'allow'; all others get 'deny'.
 * Unknown agent names -> deny all warcraft tools (defensive).
 */
export function getWarcraftToolPermissions(
  agentName: string,
  basePermissions: Record<string, string>,
): Record<string, string> {
  const nextPermissions: Record<string, string> = { ...basePermissions };
  const allowlist = AGENT_ALLOWLISTS[agentName];

  for (const toolId of WARCRAFT_TOOL_IDS) {
    nextPermissions[toolId] = allowlist?.includes(toolId) ? 'allow' : 'deny';
  }

  return nextPermissions;
}
