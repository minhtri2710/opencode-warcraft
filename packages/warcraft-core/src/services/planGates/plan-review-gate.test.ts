import { describe, expect, test } from 'bun:test';
import {
  formatPlanReviewChecklistIssues,
  validatePlanReviewChecklist,
} from './plan-review-gate.js';

const COMPLETE_CHECKLIST = `## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable`;

describe('plan review gate', () => {
  test('passes when all required checklist items are checked', () => {
    const result = validatePlanReviewChecklist(`# Plan\n\n${COMPLETE_CHECKLIST}`);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('fails when checklist section is missing', () => {
    const result = validatePlanReviewChecklist('# Plan\n\n## Discovery\nDetails');
    expect(result.ok).toBe(false);
    expect(result.issues[0]).toContain('Missing');
  });

  test('fails when an item is unchecked', () => {
    const content = `## Plan Review Checklist
- [x] Discovery is complete and current
- [ ] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable`;
    const result = validatePlanReviewChecklist(content);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes('Scope and non-goals'))).toBe(true);
  });

  test('formats checklist issues for tool output', () => {
    const text = formatPlanReviewChecklistIssues([
      'Checklist item must be checked: Scope and non-goals are explicit',
    ]);
    expect(text).toContain('Plan review checklist is incomplete');
    expect(text).toContain('Scope and non-goals');
  });
});
