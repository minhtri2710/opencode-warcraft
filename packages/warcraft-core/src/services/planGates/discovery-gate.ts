import { detectWorkflowPath, hasLightweightMiniRecord } from './workflow-path.js';

export function validateDiscoverySection(content: string): string | null {
  const workflowPath = detectWorkflowPath(content);
  const discoveryMatch = content.match(/^##\s+Discovery\s*$/im);
  if (!discoveryMatch) {
    return `BLOCKED: Discovery section required before planning.

Your plan must include a \`## Discovery\` section documenting:
- Questions you asked and answers received
- Research findings from codebase exploration
- Key decisions made

Add this section to your plan content and try again.`;
  }

  const afterDiscovery = content.slice(
    discoveryMatch.index! + discoveryMatch[0].length,
  );
  const nextHeading = afterDiscovery.search(/^##\s+/m);
  const discoveryContent =
    nextHeading > -1
      ? afterDiscovery.slice(0, nextHeading).trim()
      : afterDiscovery.trim();

  const minLength = workflowPath === 'lightweight' ? 40 : 100;
  if (discoveryContent.length < minLength) {
    return `BLOCKED: Discovery section is too thin (${discoveryContent.length} chars, minimum ${minLength}).

A substantive Discovery section should include:
- Original request quoted
- Interview summary (key decisions)
- Research findings with file:line references

Expand your Discovery section and try again.`;
  }

  if (workflowPath === 'lightweight' && !hasLightweightMiniRecord(content)) {
    return `BLOCKED: Lightweight workflow requires a mini-record.

Include these fields in the plan:
- Impact
- Safety
- Verify
- Rollback

Then try \`warcraft_plan_write\` again.`;
  }

  return null;
}
