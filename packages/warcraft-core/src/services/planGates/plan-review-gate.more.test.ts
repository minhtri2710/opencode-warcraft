import { describe, expect, it } from 'bun:test';
import { validatePlanReviewChecklist, formatPlanReviewChecklistIssues } from './plan-review-gate.js';

describe('plan-review-gate comprehensive', () => {
  describe('validatePlanReviewChecklist', () => {
    it('validates plan and returns result object', () => {
      const plan = `# Plan

## Objective
Implement the feature

## Tasks
1. Setup project
2. Implement core logic
3. Add tests

## Scope
- File: src/feature.ts
- File: src/feature.test.ts
`;
      const result = validatePlanReviewChecklist(plan);
      expect(result).toBeDefined();
      expect(typeof result.ok).toBe('boolean');
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('returns issues array', () => {
      const result = validatePlanReviewChecklist('# Plan\n\nSome text');
      expect(Array.isArray(result.issues)).toBe(true);
    });

    it('handles empty string', () => {
      const result = validatePlanReviewChecklist('');
      expect(result).toBeDefined();
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('handles plan with only heading', () => {
      const result = validatePlanReviewChecklist('# Plan');
      expect(result).toBeDefined();
    });

    it('flags missing sections', () => {
      const result = validatePlanReviewChecklist('Random text without structure');
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('formatPlanReviewChecklistIssues', () => {
    it('formats empty issues', () => {
      const result = formatPlanReviewChecklistIssues([]);
      expect(typeof result).toBe('string');
    });

    it('formats single issue', () => {
      const result = formatPlanReviewChecklistIssues(['Missing objective']);
      expect(result).toContain('Missing objective');
    });

    it('formats multiple issues', () => {
      const result = formatPlanReviewChecklistIssues(['Issue 1', 'Issue 2', 'Issue 3']);
      expect(result).toContain('Issue 1');
      expect(result).toContain('Issue 2');
      expect(result).toContain('Issue 3');
    });

    it('returns string', () => {
      expect(typeof formatPlanReviewChecklistIssues(['test'])).toBe('string');
    });
  });
});
