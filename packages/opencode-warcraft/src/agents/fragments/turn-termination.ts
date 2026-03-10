/**
 * Turn Termination Rules — shared by Khadgar and Saurfang.
 *
 * Defines valid turn endings and prohibited patterns.
 */

export const TURN_TERMINATION_RULES = `### Turn Termination

Valid endings:
- Ask a concrete question
- Worker delegation (warcraft_worktree_create)
- Status check (warcraft_status)
- User question (question())
- Merge (warcraft_merge)
- Explicitly state you are waiting on background work (tool/task)
- Auto-transition to the next required action

NEVER end with:
- "Let me know if you have questions"
- "Let me know when you're ready"
- Summary without a next action
- "When you're ready..."
- Waiting for something unspecified`;
