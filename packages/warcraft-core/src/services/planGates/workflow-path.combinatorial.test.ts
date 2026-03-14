import { describe, expect, it } from 'bun:test';
import {
  countPlanTasks,
  detectWorkflowPath,
  hasLightweightMiniRecord,
  validateLightweightPlan,
} from './workflow-path.js';

describe('workflow-path combinatorial', () => {
  const PLAN_TEMPLATES = {
    empty: '',
    minimal: '# Plan\n\n### 1. Task\nDo it',
    standard: `# Plan

## Discovery
Found things

### 1. Setup
Init

### 2. Build
Construct

### 3. Test
Verify`,
    lightweight: `# Plan

## Mini Record
**Impact**: Low risk change
**Safety**: No breaking changes
**Verify**: Run tests
**Rollback**: Revert commit

### 1. Quick Fix
Just fix it`,
    large: Array.from({ length: 20 }, (_, i) => `### ${i + 1}. Task ${i + 1}\nDescription ${i + 1}`).join('\n\n'),
  };

  describe('detectWorkflowPath for all templates', () => {
    for (const [name, content] of Object.entries(PLAN_TEMPLATES)) {
      it(`${name} returns valid path`, () => {
        const result = detectWorkflowPath(content);
        expect(['standard', 'lightweight', 'unknown']).toContain(result);
      });
    }
  });

  describe('countPlanTasks accuracy', () => {
    it('empty = 0', () => expect(countPlanTasks('')).toBe(0));
    it('no tasks = 0', () => expect(countPlanTasks('# Plan\n\nJust text')).toBe(0));
    it('1 task = 1', () => expect(countPlanTasks('### 1. One\nTask')).toBe(1));
    it('3 tasks = 3', () => expect(countPlanTasks('### 1. A\nx\n### 2. B\ny\n### 3. C\nz')).toBe(3));
    it('5 tasks = 5', () => {
      const plan = Array.from({ length: 5 }, (_, i) => `### ${i + 1}. Task\nDesc`).join('\n\n');
      expect(countPlanTasks(plan)).toBe(5);
    });
    it('10 tasks = 10', () => {
      const plan = Array.from({ length: 10 }, (_, i) => `### ${i + 1}. T\nD`).join('\n');
      expect(countPlanTasks(plan)).toBe(10);
    });
    it('20 tasks = 20', () => {
      expect(countPlanTasks(PLAN_TEMPLATES.large)).toBe(20);
    });
  });

  describe('hasLightweightMiniRecord', () => {
    it('false for empty', () => expect(hasLightweightMiniRecord('')).toBe(false));
    it('false for standard plan', () => expect(hasLightweightMiniRecord(PLAN_TEMPLATES.standard)).toBe(false));
    it('true for lightweight plan', () => expect(hasLightweightMiniRecord(PLAN_TEMPLATES.lightweight)).toBe(true));
  });

  describe('validateLightweightPlan', () => {
    it('returns array', () => expect(Array.isArray(validateLightweightPlan(''))).toBe(true));
    it('empty plan has issues', () => expect(validateLightweightPlan('').length).toBeGreaterThan(0));
    it('lightweight plan may have no issues', () => {
      const issues = validateLightweightPlan(PLAN_TEMPLATES.lightweight);
      expect(Array.isArray(issues)).toBe(true);
    });
  });
});
