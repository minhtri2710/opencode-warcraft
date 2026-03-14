import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { TaskService } from './taskService.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { createNoopLogger } from '../utils/logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWarcraftPath, getPlanPath } from '../utils/paths.js';

describe('TaskService plan dependency patterns', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-dep-pat-'));
    const store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
    fs.mkdirSync(getWarcraftPath(tempDir, 'off'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function writePlan(feat: string, content: string) {
    const planPath = getPlanPath(tempDir, feat, 'off');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, content);
  }

  it('fan-out pattern: one task depended on by many', () => {
    writePlan('fan-out', `# Plan

### 1. Core
Depends on: none
Foundation

### 2. Module A
Depends on: 1
Build A

### 3. Module B
Depends on: 1
Build B

### 4. Module C
Depends on: 1
Build C
`);
    service.sync('fan-out');
    const runnable = service.getRunnableTasks('fan-out');
    expect(runnable.runnable.length).toBe(1); // Only Core
    expect(runnable.blocked.length).toBe(3);

    // Complete Core - all 3 modules become runnable
    const tasks = service.list('fan-out');
    service.update('fan-out', tasks[0].folder, { status: 'done', summary: 'Done' });
    const after = service.getRunnableTasks('fan-out');
    expect(after.runnable.length).toBe(3);
  });

  it('fan-in pattern: one task depends on many', () => {
    writePlan('fan-in', `# Plan

### 1. A
Depends on: none
Part A

### 2. B
Depends on: none
Part B

### 3. C
Depends on: none
Part C

### 4. Merge
Depends on: 1, 2, 3
Combine all
`);
    service.sync('fan-in');
    const runnable = service.getRunnableTasks('fan-in');
    expect(runnable.runnable.length).toBe(3); // A, B, C
    expect(runnable.blocked.length).toBe(1); // Merge

    // Complete A and B - Merge still blocked (C pending)
    const tasks = service.list('fan-in');
    service.update('fan-in', tasks[0].folder, { status: 'done', summary: 'A' });
    service.update('fan-in', tasks[1].folder, { status: 'done', summary: 'B' });
    const partial = service.getRunnableTasks('fan-in');
    expect(partial.blocked.length).toBe(1); // Merge still blocked

    // Complete C - Merge becomes runnable
    service.update('fan-in', tasks[2].folder, { status: 'done', summary: 'C' });
    const final = service.getRunnableTasks('fan-in');
    expect(final.runnable.length).toBe(1); // Merge
    expect(final.completed.length).toBe(3);
  });

  it('parallel independent tasks', () => {
    writePlan('parallel', `# Plan

### 1. Task A
Depends on: none
Independent A

### 2. Task B
Depends on: none
Independent B

### 3. Task C
Depends on: none
Independent C
`);
    service.sync('parallel');
    const runnable = service.getRunnableTasks('parallel');
    expect(runnable.runnable.length).toBe(3);
    expect(runnable.blocked.length).toBe(0);
  });

  it('linear chain', () => {
    writePlan('linear', `# Plan

### 1. Step 1
First step

### 2. Step 2
Second step

### 3. Step 3
Third step

### 4. Step 4
Fourth step
`);
    service.sync('linear');
    const r1 = service.getRunnableTasks('linear');
    expect(r1.runnable.length).toBe(1);
    expect(r1.blocked.length).toBe(3);

    const tasks = service.list('linear');
    // Complete step by step
    for (let i = 0; i < 3; i++) {
      service.update('linear', tasks[i].folder, { status: 'done', summary: `Done ${i + 1}` });
      const r = service.getRunnableTasks('linear');
      expect(r.runnable.length).toBe(1);
      expect(r.completed.length).toBe(i + 1);
    }

    // Complete last
    service.update('linear', tasks[3].folder, { status: 'done', summary: 'Done 4' });
    const rFinal = service.getRunnableTasks('linear');
    expect(rFinal.runnable.length).toBe(0);
    expect(rFinal.completed.length).toBe(4);
  });
});
