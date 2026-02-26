import { describe, expect, test } from 'bun:test';
import {
  countPlanTasks,
  detectWorkflowPath,
  hasLightweightMiniRecord,
  validateLightweightPlan,
} from './workflow-path.js';

describe('workflow path utilities', () => {
  test('defaults to standard path', () => {
    expect(detectWorkflowPath('# Plan\n\n## Discovery\ntext')).toBe('standard');
  });

  test('detects lightweight via marker', () => {
    const plan = `# Plan\n\nWorkflow Path: lightweight\n\n## Discovery\ntext`;
    expect(detectWorkflowPath(plan)).toBe('lightweight');
  });

  test('counts plan tasks from headings', () => {
    const plan = `### 1. Task A\n\n### 2. Task B`;
    expect(countPlanTasks(plan)).toBe(2);
  });

  test('detects lightweight mini-record fields', () => {
    const plan = 'Impact: low\nSafety: high\nVerify: bun run test\nRollback: git revert';
    expect(hasLightweightMiniRecord(plan)).toBe(true);
  });

  test('validates lightweight plan constraints', () => {
    const plan = `# Plan\n\nWorkflow Path: lightweight\n\n## Discovery\nSufficient lightweight discovery block for small change.\n\nImpact: low\nSafety: safe\nVerify: bun run test\nRollback: revert commit\n\n### 1. Keep API stable`;
    expect(validateLightweightPlan(plan)).toEqual([]);
  });

  test('reports task-count violation', () => {
    const plan = `# Plan\n\nWorkflow Path: lightweight\n\n## Discovery\nSufficient lightweight discovery block for small change.\n\nImpact: low\nSafety: safe\nVerify: bun run test\nRollback: revert commit\n\n### 1. A\n### 2. B\n### 3. C`;
    const issues = validateLightweightPlan(plan);
    expect(issues.some((item) => item.includes('max 2 tasks'))).toBe(true);
  });
});
