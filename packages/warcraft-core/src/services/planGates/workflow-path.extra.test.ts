import { describe, expect, it } from 'bun:test';
import {
  countPlanTasks,
  detectWorkflowPath,
  hasLightweightMiniRecord,
  validateLightweightPlan,
} from './workflow-path.js';

describe('workflow-path extra edge cases', () => {
  describe('detectWorkflowPath', () => {
    it('returns standard for plan without any workflow marker', () => {
      expect(detectWorkflowPath('# Plan\n\n## Discovery\nContent')).toBe('standard');
    });

    it('detects lightweight from Workflow Path marker', () => {
      expect(detectWorkflowPath('Workflow Path: lightweight\n## Discovery')).toBe('lightweight');
    });

    it('detects lightweight from heading marker', () => {
      expect(detectWorkflowPath('## Lightweight Path\nContent')).toBe('lightweight');
    });

    it('is case-insensitive for lightweight marker value', () => {
      expect(detectWorkflowPath('Workflow Path: LIGHTWEIGHT')).toBe('lightweight');
    });

    it('returns standard for non-lightweight marker value', () => {
      expect(detectWorkflowPath('Workflow Path: standard')).toBe('standard');
    });

    it('returns standard for partial marker match', () => {
      expect(detectWorkflowPath('Workflow Path light')).toBe('standard');
    });
  });

  describe('hasLightweightMiniRecord', () => {
    it('returns true when all four fields present', () => {
      const content = 'Impact: low\nSafety: none\nVerify: test\nRollback: revert';
      expect(hasLightweightMiniRecord(content)).toBe(true);
    });

    it('returns false when Impact missing', () => {
      expect(hasLightweightMiniRecord('Safety: x\nVerify: x\nRollback: x')).toBe(false);
    });

    it('returns false when Safety missing', () => {
      expect(hasLightweightMiniRecord('Impact: x\nVerify: x\nRollback: x')).toBe(false);
    });

    it('returns false when Verify missing', () => {
      expect(hasLightweightMiniRecord('Impact: x\nSafety: x\nRollback: x')).toBe(false);
    });

    it('returns false when Rollback missing', () => {
      expect(hasLightweightMiniRecord('Impact: x\nSafety: x\nVerify: x')).toBe(false);
    });

    it('returns false for empty content', () => {
      expect(hasLightweightMiniRecord('')).toBe(false);
    });
  });

  describe('countPlanTasks', () => {
    it('counts h3 numbered headings', () => {
      expect(countPlanTasks('### 1. First\n### 2. Second\n### 3. Third')).toBe(3);
    });

    it('returns 0 for h2 headings (not task headings)', () => {
      expect(countPlanTasks('## 1. First\n## 2. Second')).toBe(0);
    });

    it('returns 0 for empty content', () => {
      expect(countPlanTasks('')).toBe(0);
    });

    it('counts tasks with varying whitespace', () => {
      expect(countPlanTasks('###  1. Setup\n###  2. Build')).toBe(2);
    });
  });

  describe('validateLightweightPlan', () => {
    it('returns no errors for valid lightweight plan', () => {
      const content = '### 1. Update docs\nImpact: low\nSafety: none\nVerify: test\nRollback: revert';
      const errors = validateLightweightPlan(content);
      expect(errors).toEqual([]);
    });

    it('reports too many tasks', () => {
      const content = '### 1. A\n### 2. B\n### 3. C\n### 4. D\nImpact: x\nSafety: x\nVerify: x\nRollback: x';
      const errors = validateLightweightPlan(content);
      expect(errors.some((e) => e.includes('task'))).toBe(true);
    });

    it('reports missing mini-record', () => {
      const content = '### 1. Task';
      const errors = validateLightweightPlan(content);
      expect(errors.some((e) => e.includes('mini-record'))).toBe(true);
    });

    it('reports both task count and mini-record violations', () => {
      const content = '### 1. A\n### 2. B\n### 3. C\n### 4. D';
      const errors = validateLightweightPlan(content);
      expect(errors.length).toBeGreaterThanOrEqual(2);
    });
  });
});
