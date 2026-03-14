import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { TaskService } from './taskService.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { createNoopLogger } from '../utils/logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWarcraftPath, getPlanPath } from '../utils/paths.js';

describe('TaskService plan parsing advanced', () => {
  let tempDir: string;
  let service: TaskService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-adv-'));
    const store = new FilesystemTaskStore(tempDir);
    service = new TaskService(tempDir, store, 'off', createNoopLogger());
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

  it('handles tasks with special characters in names', () => {
    writePlan('special', `# Plan

### 1. Setup CI/CD Pipeline
Configure CI

### 2. Add API (v2) Support
Build v2
`);
    const result = service.sync('special');
    expect(result.created.length).toBe(2);
  });

  it('handles task descriptions with code blocks', () => {
    writePlan('code-blocks', `# Plan

### 1. Add Config Parser
Parse YAML configs:
\`\`\`yaml
server:
  port: 3000
\`\`\`

### 2. Write Tests
Test the parser
`);
    const result = service.sync('code-blocks');
    expect(result.created.length).toBe(2);
  });

  it('handles non-sequential task numbers', () => {
    writePlan('non-seq', `# Plan

### 1. First
Task 1

### 3. Third
Task 3
Depends on: 1

### 5. Fifth
Task 5
Depends on: 3
`);
    const result = service.sync('non-seq');
    expect(result.created.length).toBe(3);
  });

  it('handles plan with preamble before tasks', () => {
    writePlan('preamble', `# Plan

## Overview
This is a detailed plan for implementing the feature.

## Architecture
We'll use a layered approach.

### 1. Setup
Initialize

### 2. Build
Construct
`);
    const result = service.sync('preamble');
    expect(result.created.length).toBe(2);
  });

  it('single task plan works', () => {
    writePlan('single', `# Plan

### 1. The Only Task
Do everything
`);
    const result = service.sync('single');
    expect(result.created.length).toBe(1);
  });

  it('10 task plan creates all', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => `### ${i + 1}. Task ${i + 1}\nDescription ${i + 1}\n`);
    writePlan('ten-tasks', `# Plan\n\n${tasks.join('\n')}`);
    const result = service.sync('ten-tasks');
    expect(result.created.length).toBe(10);
  });

  it('cycle detection throws', () => {
    writePlan('cycle', `# Plan

### 1. A
Depends on: 2

Task A

### 2. B
Depends on: 1

Task B
`);
    expect(() => service.sync('cycle')).toThrow(/Cycle detected/);
  });

  it('implicit dependencies for sequential tasks', () => {
    writePlan('implicit', `# Plan

### 1. First
No deps

### 2. Second
No explicit deps - implicitly depends on 1

### 3. Third
No explicit deps - implicitly depends on 2
`);
    const result = service.sync('implicit');
    expect(result.created.length).toBe(3);
    
    // Task 2 should be blocked (depends on pending task 1)
    const runnable = service.getRunnableTasks('implicit');
    expect(runnable.runnable.length).toBe(1); // Only task 1
  });

  it('explicit none dependencies makes task independent', () => {
    writePlan('no-deps', `# Plan

### 1. Independent A
Depends on: none

Task A

### 2. Independent B
Depends on: none

Task B
`);
    service.sync('no-deps');
    const runnable = service.getRunnableTasks('no-deps');
    // Both should be runnable since they have no deps
    expect(runnable.runnable.length).toBe(2);
  });

  it('diamond dependency pattern works', () => {
    writePlan('diamond', `# Plan

### 1. Base
Depends on: none

Foundation

### 2. Left
Depends on: 1

Left path

### 3. Right
Depends on: 1

Right path

### 4. Merge
Depends on: 2, 3

Combine both
`);
    const result = service.sync('diamond');
    expect(result.created.length).toBe(4);
    
    const runnable = service.getRunnableTasks('diamond');
    expect(runnable.runnable.length).toBe(1); // Only base
    expect(runnable.blocked.length).toBe(3);
  });
});
