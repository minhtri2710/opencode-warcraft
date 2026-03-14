import { describe, expect, it } from 'bun:test';
import {
  getContextPath,
  getFeaturePath,
  getPlanPath,
  getTaskPath,
  getTaskReportPath,
  getTaskStatusPath,
  getTasksPath,
  getWarcraftDir,
  getWarcraftPath,
  sanitizeName,
} from './paths.js';

describe('paths correctness', () => {
  const PROJECT = '/project';

  describe('off mode path hierarchy', () => {
    it('warcraft dir is project subdirectory', () => {
      const warcraftPath = getWarcraftPath(PROJECT, 'off');
      expect(warcraftPath.startsWith(PROJECT)).toBe(true);
      expect(warcraftPath.length).toBeGreaterThan(PROJECT.length);
    });

    it('feature path contains feature name', () => {
      expect(getFeaturePath(PROJECT, 'auth', 'off')).toContain('auth');
    });

    it('feature path is under warcraft path', () => {
      const warcraftPath = getWarcraftPath(PROJECT, 'off');
      const featurePath = getFeaturePath(PROJECT, 'auth', 'off');
      expect(featurePath.startsWith(warcraftPath)).toBe(true);
    });

    it('plan path is under feature path', () => {
      const featurePath = getFeaturePath(PROJECT, 'auth', 'off');
      const planPath = getPlanPath(PROJECT, 'auth', 'off');
      expect(planPath.startsWith(featurePath)).toBe(true);
    });

    it('tasks path is under feature path', () => {
      const featurePath = getFeaturePath(PROJECT, 'auth', 'off');
      const tasksPath = getTasksPath(PROJECT, 'auth', 'off');
      expect(tasksPath.startsWith(featurePath)).toBe(true);
    });

    it('task path is under tasks path', () => {
      const tasksPath = getTasksPath(PROJECT, 'auth', 'off');
      const taskPath = getTaskPath(PROJECT, 'auth', '01-setup', 'off');
      expect(taskPath.startsWith(tasksPath)).toBe(true);
    });

    it('task status path is under task path', () => {
      const taskPath = getTaskPath(PROJECT, 'auth', '01-setup', 'off');
      const statusPath = getTaskStatusPath(PROJECT, 'auth', '01-setup', 'off');
      expect(statusPath.startsWith(taskPath)).toBe(true);
    });

    it('task report path is under task path', () => {
      const taskPath = getTaskPath(PROJECT, 'auth', '01-setup', 'off');
      const reportPath = getTaskReportPath(PROJECT, 'auth', '01-setup', 'off');
      expect(reportPath.startsWith(taskPath)).toBe(true);
    });

    it('context path is under feature path', () => {
      const featurePath = getFeaturePath(PROJECT, 'auth', 'off');
      const contextPath = getContextPath(PROJECT, 'auth', 'off');
      expect(contextPath.startsWith(featurePath)).toBe(true);
    });
  });

  describe('on mode path hierarchy', () => {
    it('warcraft dir contains .beads', () => {
      expect(getWarcraftPath(PROJECT, 'on')).toContain('.beads');
    });

    it('feature path is under warcraft path', () => {
      const warcraftPath = getWarcraftPath(PROJECT, 'on');
      const featurePath = getFeaturePath(PROJECT, 'auth', 'on');
      expect(featurePath.startsWith(warcraftPath)).toBe(true);
    });
  });

  describe('sanitizeName security', () => {
    it('path traversal blocked', () => {
      expect(() => sanitizeName('../escape')).toThrow();
      expect(() => sanitizeName('../../etc/passwd')).toThrow();
    });

    it('null bytes blocked', () => {
      expect(() => sanitizeName('test\x00bad')).toThrow();
    });

    it('dots only blocked', () => {
      expect(() => sanitizeName('.')).toThrow();
      expect(() => sanitizeName('..')).toThrow();
    });

    it('slashes blocked', () => {
      expect(() => sanitizeName('a/b')).toThrow();
      expect(() => sanitizeName('a\\b')).toThrow();
    });

    it('whitespace only blocked', () => {
      expect(() => sanitizeName('')).toThrow();
      expect(() => sanitizeName('  ')).toThrow();
    });

    it('valid names pass', () => {
      expect(() => sanitizeName('valid-name')).not.toThrow();
      expect(() => sanitizeName('test_123')).not.toThrow();
      expect(() => sanitizeName('CamelCase')).not.toThrow();
    });
  });
});
