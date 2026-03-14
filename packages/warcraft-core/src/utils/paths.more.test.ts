import { describe, expect, it } from 'bun:test';
import {
  getFeaturePath,
  getPlanPath,
  getTaskPath,
  getTaskStatusPath,
  getTasksPath,
  getTaskReportPath,
  getWarcraftPath,
  sanitizeName,
} from './paths.js';

describe('paths more edge cases', () => {
  describe('sanitizeName', () => {
    it('throws for empty string', () => {
      expect(() => sanitizeName('')).toThrow('empty');
    });

    it('throws for path separators', () => {
      expect(() => sanitizeName('a/b')).toThrow('path separator');
      expect(() => sanitizeName('a\\b')).toThrow('path separator');
    });

    it('throws for dotdot', () => {
      expect(() => sanitizeName('..')).toThrow('relative path');
    });

    it('throws for dot prefix', () => {
      expect(() => sanitizeName('.hidden')).toThrow('dot');
    });

    it('preserves valid names', () => {
      expect(sanitizeName('valid-name')).toBe('valid-name');
      expect(sanitizeName('name_with_underscore')).toBe('name_with_underscore');
    });
  });

  describe('getWarcraftPath', () => {
    it('off mode uses docs directory', () => {
      const result = getWarcraftPath('/project', 'off');
      expect(result).toContain('docs');
    });

    it('on mode uses .beads/artifacts', () => {
      const result = getWarcraftPath('/project', 'on');
      expect(result).toContain('.beads');
    });
  });

  describe('getFeaturePath', () => {
    it('includes feature name', () => {
      const result = getFeaturePath('/project', 'my-feature', 'off');
      expect(result).toContain('my-feature');
    });
  });

  describe('getPlanPath', () => {
    it('includes plan.md', () => {
      expect(getPlanPath('/project', 'feat', 'off')).toContain('plan.md');
    });

    it('includes feature name', () => {
      expect(getPlanPath('/project', 'my-feat', 'off')).toContain('my-feat');
    });
  });

  describe('getTasksPath', () => {
    it('includes tasks directory', () => {
      expect(getTasksPath('/project', 'feat')).toContain('tasks');
    });
  });

  describe('getTaskPath', () => {
    it('includes feature and folder', () => {
      const result = getTaskPath('/project', 'feat', '01-setup');
      expect(result).toContain('feat');
      expect(result).toContain('01-setup');
    });
  });

  describe('getTaskStatusPath', () => {
    it('includes status.json', () => {
      expect(getTaskStatusPath('/project', 'feat', '01-setup')).toContain('status.json');
    });
  });

  describe('getTaskReportPath', () => {
    it('includes report in path', () => {
      expect(getTaskReportPath('/project', 'feat', '01-setup')).toContain('report');
    });
  });
});
