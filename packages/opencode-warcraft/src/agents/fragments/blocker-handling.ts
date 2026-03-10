/**
 * Blocker Handling — shared by Khadgar and Saurfang.
 *
 * Protocol for handling blocked workers.
 */

export const BLOCKER_PROTOCOL = `### Blocker Handling

When worker reports blocked:
1. \`warcraft_status()\` — read blocker info
2. \`question()\` — ask user (NEVER plain text)
3. \`warcraft_worktree_create({ task, continueFrom: "blocked", decision })\``;
