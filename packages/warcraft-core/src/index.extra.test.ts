import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { detectContext, findProjectRoot } from './utils/detection.js';
import { fileExists, readJson, readText } from './utils/fs.js';
import {
  getContextPath,
  getFeatureJsonPath,
  getFeaturePath,
  getPlanPath,
  getTaskPath,
  getTaskReportPath,
  getTaskSpecPath,
  getTaskStatusPath,
  getTasksPath,
  getWarcraftDir,
  getWarcraftPath,
  normalizePath,
  sanitizeName,
} from './utils/paths.js';

describe('warcraft-core path helpers', () => {
  it('getWarcraftDir returns .beads/artifacts for on mode', () => {
    expect(getWarcraftDir('on')).toBe('.beads/artifacts');
  });

  it('getWarcraftDir returns docs for off mode', () => {
    expect(getWarcraftDir('off')).toBe('docs');
  });

  it('getWarcraftDir defaults to docs', () => {
    expect(getWarcraftDir()).toBe('docs');
  });

  it('getWarcraftPath joins root with warcraft dir', () => {
    expect(getWarcraftPath('/project', 'on')).toBe('/project/.beads/artifacts');
    expect(getWarcraftPath('/project', 'off')).toBe('/project/docs');
  });

  it('getFeaturePath joins correctly for both modes', () => {
    expect(getFeaturePath('/root', 'feat', 'on')).toBe('/root/.beads/artifacts/feat');
    expect(getFeaturePath('/root', 'feat', 'off')).toBe('/root/docs/feat');
  });

  it('getFeatureJsonPath points to feature.json', () => {
    const p = getFeatureJsonPath('/root', 'feat', 'off');
    expect(p).toContain('feature.json');
    expect(p).toContain('feat');
  });

  it('getPlanPath points to plan.md', () => {
    const p = getPlanPath('/root', 'feat', 'off');
    expect(p).toContain('plan.md');
  });

  it('getContextPath points to context dir', () => {
    const p = getContextPath('/root', 'feat', 'off');
    expect(p).toContain('context');
  });

  it('getTasksPath points to tasks dir', () => {
    const p = getTasksPath('/root', 'feat', 'off');
    expect(p).toContain('tasks');
  });

  it('getTaskPath includes feature and task folder', () => {
    const p = getTaskPath('/root', 'feat', '01-setup', 'off');
    expect(p).toContain('feat');
    expect(p).toContain('01-setup');
  });

  it('getTaskStatusPath points to status.json', () => {
    const p = getTaskStatusPath('/root', 'feat', '01-setup', 'off');
    expect(p).toContain('status.json');
  });

  it('getTaskReportPath points to report.md', () => {
    const p = getTaskReportPath('/root', 'feat', '01-setup', 'off');
    expect(p).toContain('report.md');
  });

  it('getTaskSpecPath points to spec.md', () => {
    const p = getTaskSpecPath('/root', 'feat', '01-setup', 'off');
    expect(p).toContain('spec.md');
  });
});

describe('sanitizeName', () => {
  it('handles names with only valid characters', () => {
    expect(sanitizeName('my-feature')).toBe('my-feature');
    expect(sanitizeName('feature_123')).toBe('feature_123');
  });
});

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('C:\\Users\\test\\project')).toBe('C:/Users/test/project');
  });

  it('leaves forward slashes unchanged', () => {
    expect(normalizePath('/Users/test/project')).toBe('/Users/test/project');
  });
});

describe('fs utilities integration', () => {
  it('fileExists returns false for non-existent paths', () => {
    expect(fileExists('/nonexistent/path/abc123')).toBe(false);
  });

  it('readJson returns null for non-existent file', () => {
    expect(readJson('/nonexistent/path/file.json')).toBeNull();
  });

  it('readText returns null for non-existent file', () => {
    expect(readText('/nonexistent/path/file.txt')).toBeNull();
  });
});
