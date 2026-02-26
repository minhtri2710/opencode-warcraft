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
