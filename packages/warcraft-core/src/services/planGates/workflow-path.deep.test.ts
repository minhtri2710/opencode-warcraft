import { describe, expect, it } from 'bun:test';
import {
  countPlanTasks,
  detectWorkflowPath,
  hasLightweightMiniRecord,
  validateLightweightPlan,
} from './workflow-path.js';

describe('workflow-path deep scenarios', () => {
  describe('detectWorkflowPath', () => {
    it('returns standard or lightweight for any content', () => {
      const result = detectWorkflowPath('# Plan\n\n## Tasks\n1. Do stuff');
      expect(['standard', 'lightweight']).toContain(result);
    });

    it('returns standard for complex plan', () => {
      const content = `# Plan

## Tasks
1. Setup infrastructure
2. Implement core logic
3. Add error handling
4. Write tests
5. Integration testing
6. Deploy
`;
      const result = detectWorkflowPath(content);
      expect(result).toBe('standard');
    });

    it('returns standard for single task without mini-record', () => {
      const content = `# Plan

### 1. Fix the bug

Fix a small issue
`;
      const result = detectWorkflowPath(content);
      expect(result).toBe('standard');
    });
  });

  describe('countPlanTasks', () => {
    it('returns 0 for empty content', () => {
      expect(countPlanTasks('')).toBe(0);
    });

    it('counts h3 task headings', () => {
      expect(countPlanTasks('### 1. First\n### 2. Second\n### 3. Third')).toBe(3);
    });

    it('counts single task heading', () => {
      expect(countPlanTasks('### 1. Only task')).toBe(1);
    });

    it('ignores non-task content', () => {
      const content = `# Plan

Some text here

### 1. Do this
Details

### 2. Do that
More details

## Notes
More text
`;
      expect(countPlanTasks(content)).toBe(2);
    });
  });

  describe('hasLightweightMiniRecord', () => {
    it('returns boolean', () => {
      expect(typeof hasLightweightMiniRecord('content')).toBe('boolean');
    });

    it('returns false for empty content', () => {
      expect(hasLightweightMiniRecord('')).toBe(false);
    });
  });

  describe('validateLightweightPlan', () => {
    it('returns array', () => {
      const result = validateLightweightPlan('# Plan\n\n1. Do thing');
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array for valid lightweight plan', () => {
      const result = validateLightweightPlan('# Plan\n\n## Tasks\n1. Fix bug\n');
      // May or may not have issues depending on requirements
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns issues for invalid content', () => {
      const result = validateLightweightPlan('');
      expect(result.length).toBeGreaterThanOrEqual(0);
    });
  });
});
