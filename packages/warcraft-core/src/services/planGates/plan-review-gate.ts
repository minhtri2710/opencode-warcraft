const REQUIRED_CHECKLIST_ITEMS = [
  'Discovery is complete and current',
  'Scope and non-goals are explicit',
  'Risks, rollout, and verification are defined',
  'Tasks and dependencies are actionable',
] as const;

export interface PlanReviewResult {
  ok: boolean;
  issues: string[];
}

function extractChecklistSection(content: string): string | null {
  const match = content.match(/^##\s+Plan Review Checklist\s*$/im);
  if (!match || match.index === undefined) {
    return null;
  }

  const afterHeading = content.slice(match.index + match[0].length);
  const nextHeading = afterHeading.search(/^##\s+/m);
  if (nextHeading === -1) {
    return afterHeading.trim();
  }

  return afterHeading.slice(0, nextHeading).trim();
}

export function validatePlanReviewChecklist(content: string): PlanReviewResult {
  const issues: string[] = [];
  const checklist = extractChecklistSection(content);

  if (!checklist) {
    issues.push('Missing `## Plan Review Checklist` section.');
    return { ok: false, issues };
  }

  for (const item of REQUIRED_CHECKLIST_ITEMS) {
    const itemRegex = new RegExp(
      String.raw`^\s*-\s*\[[xX]\]\s*${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*$`,
      'm',
    );
    if (!itemRegex.test(checklist)) {
      issues.push(`Checklist item must be checked: ${item}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function formatPlanReviewChecklistIssues(issues: string[]): string {
  const bullets = issues.map((issue) => `- ${issue}`).join('\n');
  return `Plan review checklist is incomplete:\n${bullets}`;
}
