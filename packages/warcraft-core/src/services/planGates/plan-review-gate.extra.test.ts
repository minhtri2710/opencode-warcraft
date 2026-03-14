import { describe, expect, it } from 'bun:test';
import { formatPlanReviewChecklistIssues, validatePlanReviewChecklist } from './plan-review-gate.js';

describe('plan-review-gate extra edge cases', () => {
  describe('validatePlanReviewChecklist', () => {
    it('fails when Plan Review Checklist section is missing', () => {
      const content = '# Plan\n\n## Overview\nContent';
      const result = validatePlanReviewChecklist(content);
      expect(result.ok).toBe(false);
      expect(result.issues[0]).toContain('Missing');
    });

    it('fails when required items are unchecked', () => {
      const content = `## Plan Review Checklist
- [ ] Discovery is complete and current
- [ ] Scope and non-goals are explicit
- [ ] Risks, rollout, and verification are defined
- [ ] Tasks and dependencies are actionable`;
      const result = validatePlanReviewChecklist(content);
      expect(result.ok).toBe(false);
      expect(result.issues.length).toBe(4);
    });

    it('passes when all required items are checked with [x]', () => {
      const content = `## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable`;
      const result = validatePlanReviewChecklist(content);
      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it('passes when all required items are checked with [X]', () => {
      const content = `## Plan Review Checklist
- [X] Discovery is complete and current
- [X] Scope and non-goals are explicit
- [X] Risks, rollout, and verification are defined
- [X] Tasks and dependencies are actionable`;
      const result = validatePlanReviewChecklist(content);
      expect(result.ok).toBe(true);
    });

    it('scopes checklist to section boundary', () => {
      const content = `## Plan Review Checklist
- [x] Discovery is complete and current
- [x] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable

## Implementation
- [ ] This unchecked item should not affect validation`;
      const result = validatePlanReviewChecklist(content);
      expect(result.ok).toBe(true);
    });

    it('partially checked items produce partial issues', () => {
      const content = `## Plan Review Checklist
- [x] Discovery is complete and current
- [ ] Scope and non-goals are explicit
- [x] Risks, rollout, and verification are defined
- [x] Tasks and dependencies are actionable`;
      const result = validatePlanReviewChecklist(content);
      expect(result.ok).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toContain('Scope and non-goals');
    });
  });

  describe('formatPlanReviewChecklistIssues', () => {
    it('includes header in output', () => {
      const result = formatPlanReviewChecklistIssues(['Issue 1']);
      expect(result).toContain('Plan review checklist is incomplete');
    });

    it('formats multiple issues as bullet points', () => {
      const result = formatPlanReviewChecklistIssues(['A', 'B']);
      expect(result).toContain('- A');
      expect(result).toContain('- B');
    });
  });
});
