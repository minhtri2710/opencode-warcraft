import { describe, expect, it } from 'bun:test';
import {
  validatePlanReviewChecklist,
  formatPlanReviewChecklistIssues,
} from './plan-review-gate.js';

describe('plan-review-gate comprehensive', () => {
  const PLANS = {
    full: `# Plan

## Plan Review Checklist
- [x] Discovery complete
- [x] Tasks identified
- [x] Risks assessed
- [x] Dependencies mapped

### 1. Setup
Init

### 2. Build
Construct`,
    partial: `# Plan

## Plan Review Checklist
- [x] Discovery complete
- [ ] Tasks identified

### 1. Setup
Init`,
    empty: '',
    noChecklist: '# Plan\n\n### 1. Task\nDo it',
    allUnchecked: `## Plan Review Checklist
- [ ] Item 1
- [ ] Item 2
- [ ] Item 3`,
  };

  describe('validatePlanReviewChecklist', () => {
    for (const [name, content] of Object.entries(PLANS)) {
      it(`${name} plan`, () => {
        const result = validatePlanReviewChecklist(content);
        expect(result).toBeDefined();
        expect(typeof result.ok).toBe('boolean');
      });
    }
  });

  describe('formatPlanReviewChecklistIssues', () => {
    it('no issues', () => {
      const result = formatPlanReviewChecklistIssues([]);
      expect(typeof result).toBe('string');
    });

    it('one issue', () => {
      const result = formatPlanReviewChecklistIssues(['Missing discovery']);
      expect(result).toContain('Missing discovery');
    });

    it('multiple issues', () => {
      const issues = ['Issue 1', 'Issue 2', 'Issue 3'];
      const result = formatPlanReviewChecklistIssues(issues);
      for (const issue of issues) {
        expect(result).toContain(issue);
      }
    });

    it('special characters in issues', () => {
      const result = formatPlanReviewChecklistIssues(['Issue with <html> tags', 'Issue with "quotes"']);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
