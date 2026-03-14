import { describe, expect, it } from 'bun:test';
import {
  getContextPath,
  getFeaturePath,
  getPlanPath,
  getTaskPath,
  getTaskReportPath,
  getTaskStatusPath,
  getTasksPath,
  getWarcraftPath,
  sanitizeName,
} from './paths.js';

describe('paths deep validation', () => {
  describe('path consistency', () => {
    it('feature path is child of warcraft path', () => {
      const warcraft = getWarcraftPath('/project', 'off');
      const feature = getFeaturePath('/project', 'my-feat', 'off');
      expect(feature.startsWith(warcraft)).toBe(true);
    });

    it('plan path is child of feature path', () => {
      const feature = getFeaturePath('/project', 'feat', 'off');
      const plan = getPlanPath('/project', 'feat', 'off');
      expect(plan.startsWith(feature)).toBe(true);
    });

    it('task path is child of tasks path', () => {
      const tasks = getTasksPath('/project', 'feat');
      const task = getTaskPath('/project', 'feat', '01-setup');
      expect(task.startsWith(tasks)).toBe(true);
    });

    it('task status is child of task path', () => {
      const task = getTaskPath('/project', 'feat', '01-setup');
      const status = getTaskStatusPath('/project', 'feat', '01-setup');
      expect(status.startsWith(task)).toBe(true);
    });

    it('task report is child of task path', () => {
      const task = getTaskPath('/project', 'feat', '01-setup');
      const report = getTaskReportPath('/project', 'feat', '01-setup');
      expect(report.startsWith(task)).toBe(true);
    });
  });

  describe('sanitizeName security', () => {
    it('rejects control characters', () => {
      expect(() => sanitizeName('bad\x00name')).toThrow();
    });

    it('rejects backslash paths', () => {
      expect(() => sanitizeName('a\\b')).toThrow();
    });

    it('rejects starting with dots', () => {
      expect(() => sanitizeName('.config')).toThrow();
      expect(() => sanitizeName('..sneaky')).toThrow();
    });

    it('accepts alphanumeric with hyphens', () => {
      expect(sanitizeName('valid-name-123')).toBe('valid-name-123');
    });

    it('rejects whitespace-only', () => {
      expect(() => sanitizeName('   ')).toThrow();
    });
  });

  describe('getContextPath', () => {
    it('includes feature name', () => {
      const result = getContextPath('/project', 'my-feat', 'off');
      expect(result).toContain('my-feat');
    });

    it('is child of feature path', () => {
      const feature = getFeaturePath('/project', 'feat', 'off');
      const context = getContextPath('/project', 'feat', 'off');
      expect(context.startsWith(feature)).toBe(true);
    });
  });
});
