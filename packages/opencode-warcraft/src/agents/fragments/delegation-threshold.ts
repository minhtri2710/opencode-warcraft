/**
 * Canonical Delegation Threshold — shared by Khadgar and Mimiron.
 *
 * Defines when to delegate exploration to Brann vs. using local tools.
 */
export const CANONICAL_DELEGATION_THRESHOLD = `### Canonical Delegation Threshold

- Delegate to Brann when you cannot name the file path upfront, expect to inspect 2+ files, or the question is open-ended ("how/where does X work?").
- Prefer \`task({ subagent_type: "brann", prompt: "..." })\` for single investigations.
- Local \`read/grep/glob\` is acceptable only for a single known file and a bounded question.`;
