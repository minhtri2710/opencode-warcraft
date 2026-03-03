/**
 * Compaction hook — injected when OpenCode compacts session context.
 * Prevents agents from re-discovering state that is already available via tools.
 */

/**
 * Build the compaction resume prompt.
 * Stateless, deterministic — no service dependencies.
 */
export function buildCompactionPrompt(): string {
  return `## Warcraft Session Resume

After context compaction, resume efficiently:

1. Do NOT call warcraft_status to rediscover state — the compacted context already contains it.
2. Do NOT re-read plan.md or context files you already processed.
3. Continue from where you left off. The current task, feature, and progress are preserved above.
4. If you were mid-delegation, check the task result and proceed to the next action.
5. If you were mid-implementation, continue the current step without re-orienting.

When resuming after compaction:
- Trust the compacted context as authoritative.
- Pick up the next concrete action immediately.
- Do not summarize what happened before — act on what happens next.`;
}
