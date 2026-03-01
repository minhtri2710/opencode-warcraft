export type WorkflowPath = 'standard' | 'lightweight';

const LIGHTWEIGHT_MARKERS = [
  /^workflow\s*path\s*:\s*lightweight\s*$/im,
  /^##\s+workflow\s+path\s*$/im,
  /^##\s+lightweight\s+path\s*$/im,
];

export function detectWorkflowPath(content: string): WorkflowPath {
  for (const marker of LIGHTWEIGHT_MARKERS) {
    if (marker.test(content)) {
      return 'lightweight';
    }
  }

  return 'standard';
}

export function countPlanTasks(content: string): number {
  return (content.match(/^###\s+\d+\.\s+/gm) || []).length;
}

export function hasLightweightMiniRecord(content: string): boolean {
  const requiredTokens = ['impact', 'safety', 'verify', 'rollback'];
  const normalized = content.toLowerCase();

  return requiredTokens.every((token) => normalized.includes(token));
}

export function validateLightweightPlan(content: string): string[] {
  const issues: string[] = [];
  const taskCount = countPlanTasks(content);
  if (taskCount === 0) {
    issues.push('No tasks found. Add at least one task (`### 1. Task title`).');
  }
  if (taskCount > 2) {
    issues.push(`Lightweight path supports max 2 tasks; found ${taskCount}.`);
  }
  if (!hasLightweightMiniRecord(content)) {
    issues.push('Lightweight plan must include mini-record details for Impact, Safety, Verify, and Rollback.');
  }

  return issues;
}
