import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { TaskService } from './taskService.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { createNoopLogger } from '../utils/logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWarcraftPath, getPlanPath } from '../utils/paths.js';

describe('TaskService spec generation', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-spec-gen-'));
    const store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('buildSpecData produces complete structure', () => {
    const spec = service.buildSpecData({
      featureName: 'my-feature',
      task: { folder: '01-setup', name: 'Setup', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-setup', name: 'Setup', order: 1 }],
      planContent: '### 1. Setup\nInit project',
    });
    expect(spec.featureName).toBe('my-feature');
    expect(spec.task.folder).toBe('01-setup');
    expect(spec.task.name).toBe('Setup');
    expect(spec.dependsOn).toEqual([]);
  });

  it('buildSpecData extracts plan section by title', () => {
    const spec = service.buildSpecData({
      featureName: 'feat',
      task: { folder: '02-build', name: 'Build Core', order: 2 },
      dependsOn: ['01-setup'],
      allTasks: [
        { folder: '01-setup', name: 'Setup', order: 1 },
        { folder: '02-build', name: 'Build Core', order: 2 },
      ],
      planContent: '### 1. Setup\nInit\n\n### 2. Build Core\nBuild the core module\n',
    });
    expect(spec.planSection).toContain('Build Core');
  });

  it('buildSpecData with no plan content has null section', () => {
    const spec = service.buildSpecData({
      featureName: 'feat',
      task: { folder: '01-a', name: 'A', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-a', name: 'A', order: 1 }],
      planContent: null,
    });
    expect(spec.planSection).toBeNull();
  });

  it('buildSpecData includes context files', () => {
    const spec = service.buildSpecData({
      featureName: 'feat',
      task: { folder: '01-a', name: 'A', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-a', name: 'A', order: 1 }],
      contextFiles: [
        { name: 'decisions', content: 'Decision 1' },
        { name: 'learnings', content: 'Learning 1' },
      ],
    });
    expect(spec.contextFiles.length).toBe(2);
    expect(spec.contextFiles[0].name).toBe('decisions');
  });

  it('buildSpecData includes completed tasks', () => {
    const spec = service.buildSpecData({
      featureName: 'feat',
      task: { folder: '02-build', name: 'Build', order: 2 },
      dependsOn: ['01-setup'],
      allTasks: [
        { folder: '01-setup', name: 'Setup', order: 1 },
        { folder: '02-build', name: 'Build', order: 2 },
      ],
      completedTasks: [{ name: 'Setup', summary: 'Project initialized' }],
    });
    expect(spec.completedTasks.length).toBe(1);
    expect(spec.completedTasks[0].summary).toBe('Project initialized');
  });

  it('extractPlanSection by order when title mismatch', () => {
    const spec = service.buildSpecData({
      featureName: 'feat',
      task: { folder: '01-a', name: 'Different Title', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-a', name: 'Different Title', order: 1 }],
      planContent: '### 1. Original Title\nThe content here',
    });
    // Should fall back to order matching
    expect(spec.planSection).toContain('content here');
  });
});
