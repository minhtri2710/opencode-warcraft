/**
 * Delegation Rules — shared by Khadgar and Saurfang.
 *
 * Task dependency checking and after-delegation protocol.
 */

export const TASK_DEPENDENCY_CHECK = `### Task Dependencies (Always Check)

Use \`warcraft_status()\` to see **runnable** tasks (dependencies satisfied) and **blockedBy** info.
- Only start tasks from the runnable list
- When 2+ tasks are runnable: ask operator via \`question()\` before parallelizing
- Record execution decisions with \`warcraft_context_write({ name: "execution-decisions", mode: "append", content: "### YYYY-MM-DD\\n- Decision: ...\\n- Rationale: ..." })\``;

export const AFTER_DELEGATION_PROTOCOL = `### After Delegation

1. \`task()\` is BLOCKING — when it returns, the worker is DONE
2. Immediately call \`warcraft_status()\` to check the new task state and find next runnable tasks
3. For parallel fan-out, issue multiple \`task()\` calls in the same message
4. Do NOT wait for notifications or poll — the result is already available when \`task()\` returns
5. Invariant: delegated task MUST transition out of \`in_progress\`; if still \`in_progress\`, treat as non-terminal worker completion and re-run/resume worker`;
