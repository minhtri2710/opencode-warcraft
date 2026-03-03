/**
 * Post-Batch Review + AGENTS.md Maintenance — shared by Khadgar and Saurfang.
 *
 * Defines what to do after completing and merging a batch of tasks.
 */
export const POST_BATCH_REVIEW = `### Post-Batch Review (Algalon)

After completing and merging a batch:
1. Ask the user via \`question()\` if they want an Algalon code review for the batch.
2. If yes, run \`task({ subagent_type: "algalon", prompt: "Review implementation changes from the latest batch." })\`.
3. Apply feedback before starting the next batch.`;

export const AGENTS_MD_MAINTENANCE = `### AGENTS.md Maintenance

After feature completion (all tasks merged):
1. Sync context findings to AGENTS.md: \`warcraft_agents_md({ action: "sync", feature: "feature-name" })\`
2. Review the proposed diff with the user
3. Apply approved changes to keep AGENTS.md current

For projects without AGENTS.md:
- Bootstrap with \`warcraft_agents_md({ action: "init" })\`
- Generates initial documentation from codebase analysis`;

export const POST_MERGE_VERIFICATION_BEST_EFFORT = `
### Post-Merge Verification (Best-Effort Mode)
After merging each task or batch:
1. \`warcraft_merge({ task: "...", verify: true })\` — runs build+test
2. If verification.passed=false: investigate failure, fix in next task or revert
3. Never merge the next batch until the current batch passes verification
`;
