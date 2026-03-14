import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNoopLogger } from '../utils/logger.js';
import { getPlanPath, getWarcraftPath } from '../utils/paths.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { TaskService } from './taskService.js';

describe('TaskService plan parsing edge cases', () => {
  let tempDir: string;
  let service: TaskService;
  let store: FilesystemTaskStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-parse-'));
    store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    // Create warcraft dir and feature dir
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writePlan(featureName: string, content: string) {
    const planPath = getPlanPath(tempDir, featureName, 'off');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, content);
  }

  it('sync with 3 basic tasks creates 3 folders', () => {
    writePlan(
      'basic',
      `# Plan

### 1. Setup
Initialize the project

### 2. Build
Build the core

### 3. Test
Run tests
`,
    );
    const result = service.sync('basic');
    expect(result.created.length).toBe(3);
    expect(result.removed.length).toBe(0);
  });

  it('sync creates correct folder names from task titles', () => {
    writePlan(
      'naming',
      `# Plan

### 1. Initialize Database
Set up DB

### 2. Create API Routes
Build routes
`,
    );
    const result = service.sync('naming');
    expect(result.created.length).toBe(2);
    // Folders should be derived from order + slugified name
    expect(result.created[0]).toMatch(/^01-/);
    expect(result.created[1]).toMatch(/^02-/);
  });

  it('sync with explicit dependencies', () => {
    writePlan(
      'deps',
      `# Plan

### 1. Base Setup
Depends on: none

Set up base

### 2. Feature A
Depends on: 1

Build A

### 3. Feature B
Depends on: 1, 2

Build B
`,
    );
    const result = service.sync('deps');
    expect(result.created.length).toBe(3);
  });

  it('sync with bullet-point depends on', () => {
    writePlan(
      'bullet-deps',
      `# Plan

### 1. Setup
Init project

### 2. Implement
- **Depends on**: 1

Build feature
`,
    );
    const result = service.sync('bullet-deps');
    expect(result.created.length).toBe(2);
  });

  it('sync idempotent - second call creates nothing', () => {
    writePlan(
      'idempotent',
      `# Plan

### 1. One Task
Do it
`,
    );
    service.sync('idempotent');
    const result2 = service.sync('idempotent');
    expect(result2.created.length).toBe(0);
  });

  it('previewSync matches sync for new feature', () => {
    writePlan(
      'preview',
      `# Plan

### 1. A
Task A

### 2. B
Task B
`,
    );
    const preview = service.previewSync('preview');
    const actual = service.sync('preview');
    expect(preview.created.length).toBe(actual.created.length);
  });

  it('throws on missing plan', () => {
    expect(() => service.sync('nonexistent')).toThrow(/No plan.md found/);
  });

  it('throws on duplicate task numbers', () => {
    writePlan(
      'dupes',
      `# Plan

### 1. First
Task 1

### 1. Second
Also task 1
`,
    );
    expect(() => service.sync('dupes')).toThrow(/Duplicate numbered task headers/);
  });

  it('throws on self-dependency', () => {
    writePlan(
      'self-dep',
      `# Plan

### 1. Recursive
Depends on: 1

I depend on myself
`,
    );
    expect(() => service.sync('self-dep')).toThrow(/Self-dependency/);
  });

  it('throws on unknown dependency number', () => {
    writePlan(
      'bad-dep',
      `# Plan

### 1. OK Task
Fine

### 2. Bad Task
Depends on: 99

References nonexistent task
`,
    );
    expect(() => service.sync('bad-dep')).toThrow(/Unknown task number 99/);
  });

  it('sync removes tasks no longer in plan', () => {
    writePlan(
      'shrink',
      `# Plan

### 1. Keep
Stay

### 2. Remove
Go away
`,
    );
    service.sync('shrink');

    // Rewrite plan with only task 1
    writePlan(
      'shrink',
      `# Plan

### 1. Keep
Stay
`,
    );
    const result = service.sync('shrink');
    expect(result.removed.length).toBe(1);
  });
});
