import { describe, expect, it } from 'bun:test';
import { detectWorkflowPath, countPlanTasks, hasLightweightMiniRecord } from './workflow-path.js';

describe('workflow-path more scenarios', () => {
  describe('detectWorkflowPath', () => {
    it('detects "Workflow path: lightweight"', () => {
      expect(detectWorkflowPath('Workflow path: lightweight\n## Plan')).toBe('lightweight');
    });

    it('detects "## Workflow Path" heading', () => {
      expect(detectWorkflowPath('# Plan\n\n## Workflow Path\n\nLightweight')).toBe('lightweight');
    });

    it('detects "## Lightweight Path" heading', () => {
      expect(detectWorkflowPath('## Lightweight Path\n\nContent')).toBe('lightweight');
    });

    it('returns standard for normal plans', () => {
      expect(detectWorkflowPath('# Plan\n\n## Overview\n\nContent')).toBe('standard');
    });

    it('case insensitive detection', () => {
      expect(detectWorkflowPath('WORKFLOW PATH: LIGHTWEIGHT')).toBe('lightweight');
    });
  });

  describe('countPlanTasks', () => {
    it('counts ### N. headers', () => {
      const content = `### 1. First\n\nContent\n\n### 2. Second\n\nMore`;
      expect(countPlanTasks(content)).toBe(2);
    });

    it('returns 0 for no tasks', () => {
      expect(countPlanTasks('# Plan\n\nNo tasks here')).toBe(0);
    });

    it('counts single task', () => {
      expect(countPlanTasks('### 1. Only task')).toBe(1);
    });

    it('handles many tasks', () => {
      const lines = Array.from({ length: 20 }, (_, i) => `### ${i + 1}. Task ${i + 1}`);
      expect(countPlanTasks(lines.join('\n\n'))).toBe(20);
    });

    it('does not count non-numbered ### headers', () => {
      expect(countPlanTasks('### Overview\n\n### Notes\n\n### 1. Real task')).toBe(1);
    });
  });

  describe('hasLightweightMiniRecord', () => {
    it('returns true when all fields present', () => {
      const content = `Impact: Low\nSafety: Safe\nVerify: Tests\nRollback: Revert`;
      expect(hasLightweightMiniRecord(content)).toBe(true);
    });

    it('returns false when Impact missing', () => {
      expect(hasLightweightMiniRecord('Safety: Safe\nVerify: Tests\nRollback: Revert')).toBe(false);
    });

    it('returns false when Safety missing', () => {
      expect(hasLightweightMiniRecord('Impact: Low\nVerify: Tests\nRollback: Revert')).toBe(false);
    });

    it('returns false when Verify missing', () => {
      expect(hasLightweightMiniRecord('Impact: Low\nSafety: Safe\nRollback: Revert')).toBe(false);
    });

    it('returns false when Rollback missing', () => {
      expect(hasLightweightMiniRecord('Impact: Low\nSafety: Safe\nVerify: Tests')).toBe(false);
    });

    it('returns false for empty content', () => {
      expect(hasLightweightMiniRecord('')).toBe(false);
    });

    it('case insensitive field detection', () => {
      const content = `IMPACT: High\nSAFETY: Careful\nVERIFY: Check\nROLLBACK: Undo`;
      expect(hasLightweightMiniRecord(content)).toBe(true);
    });
  });
});
