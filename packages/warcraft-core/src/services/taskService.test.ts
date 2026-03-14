import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { TaskStatus } from '../types.js';
import { getLockPath } from '../utils/json-lock.js';
import { createNoopLogger } from '../utils/logger.js';
import { BeadsRepository } from './beads/BeadsRepository.js';
import { formatSpecContent } from './specFormatter.js';
import { createStores } from './state/index.js';
import { InvalidTransitionError } from './task-state-machine.js';
import { TASK_STATUS_SCHEMA_VERSION, TaskService } from './taskService.js';

const TEST_DIR = `/tmp/warcraft-core-taskservice-test-${process.pid}`;
const PROJECT_ROOT = TEST_DIR;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function createRepository(mode: 'on' | 'off' = 'off'): BeadsRepository {
  return new BeadsRepository(PROJECT_ROOT, {}, mode);
}

function setupFeature(featureName: string): void {
  const featurePath = path.join(TEST_DIR, 'docs', featureName);
  fs.mkdirSync(featurePath, { recursive: true });

  // Create a minimal feature.json
  fs.writeFileSync(
    path.join(featurePath, 'feature.json'),
    JSON.stringify({
      name: featureName,
      epicBeadId: 'bd-epic-test',
      status: 'executing',
      createdAt: new Date().toISOString(),
    }),
  );

  // Create plan.md with a task
  fs.writeFileSync(path.join(featurePath, 'plan.md'), `# Plan\n\n### 1. Test Task\n\nDescription of the test task.\n`);
}

function setupTask(featureName: string, taskFolder: string, status: Partial<TaskStatus> = {}): void {
  const taskPath = path.join(TEST_DIR, '.beads/artifacts', featureName, 'tasks', taskFolder);
  fs.mkdirSync(taskPath, { recursive: true });

  const taskStatus: TaskStatus = {
    status: 'pending',
    origin: 'plan',
    planTitle: 'Test Task',
    ...status,
  };

  fs.writeFileSync(path.join(taskPath, 'status.json'), JSON.stringify(taskStatus, null, 2));
}

describe('TaskService', () => {
  let service: TaskService;
  let offModeService: TaskService;
  let execFileSyncSpy: ReturnType<typeof spyOn>;
  let childCounter = 0;
  const mockDescriptions: Map<string, string> = new Map();
  const mockCreatedTasks: Array<{ id: string; title: string; status: string }> = [];
  const mockComments: Map<string, string[]> = new Map();

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const beadsArtifactsPath = path.join(TEST_DIR, '.beads', 'artifacts');
    fs.mkdirSync(beadsArtifactsPath, { recursive: true });
    const docsPath = path.join(TEST_DIR, 'docs');
    if (!fs.existsSync(docsPath)) {
      fs.symlinkSync(beadsArtifactsPath, docsPath, 'dir');
    }
    childCounter = 0;
    mockDescriptions.clear();
    mockCreatedTasks.length = 0;
    mockComments.clear();
    execFileSyncSpy = spyOn(child_process, 'execFileSync').mockImplementation((...execArgs: any[]) => {
      const [command, args] = execArgs;
      if (command !== 'br') {
        throw new Error(`Unexpected command: ${String(command)}`);
      }
      const argList = Array.isArray(args) ? args.map(String) : [];
      if (argList[0] === '--version') {
        return 'beads_rust 1.2.3' as any;
      }
      if (argList[0] === 'init') {
        return 'Initialized' as any;
      }
      if (argList[0] === 'create') {
        childCounter += 1;
        const taskId = `bd-task-${childCounter}`;
        const titleIdx = 1;
        const title = argList[titleIdx] || `Task ${childCounter}`;
        mockCreatedTasks.push({ id: taskId, title, status: 'open' });
        return JSON.stringify({ id: taskId }) as any;
      }
      if (argList[0] === 'comments' && argList[1] === 'add') {
        const beadId = argList[2] ?? '';
        const body = argList[3] ?? '';
        if (!mockComments.has(beadId)) {
          mockComments.set(beadId, []);
        }
        if (argList[3] === '--file' && argList[4]) {
          const fileBody = fs.readFileSync(argList[4], 'utf8');
          mockComments.get(beadId)?.push(fileBody);
        } else {
          mockComments.get(beadId)?.push(body);
        }
        return '' as any;
      }
      if (argList[0] === 'comments' && argList[1] === 'list') {
        const beadId = argList[2] ?? '';
        const comments = mockComments.get(beadId) ?? [];
        return JSON.stringify(
          comments.map((body, index) => ({
            id: `comment-${index + 1}`,
            body,
            timestamp: `2026-01-02T00:00:${String(index).padStart(2, '0')}Z`,
          })),
        ) as any;
      }
      if (argList[0] === 'update') {
        const descIdx = argList.indexOf('--description');
        if (descIdx !== -1 && descIdx + 1 < argList.length) {
          const beadId = argList[1];
          mockDescriptions.set(beadId, argList[descIdx + 1]);
        }
        return '' as any;
      }
      if (argList[0] === 'close') {
        return '' as any;
      }
      if (argList[0] === 'show') {
        const beadId = argList[1];
        const desc = mockDescriptions.get(beadId) ?? '';
        return JSON.stringify({ description: desc }) as any;
      }
      if (argList[0] === 'sync') {
        // Handle sync --flush-only and sync --import-only
        return '' as any;
      }
      if (argList[0] === 'list') {
        // Return epic list for getEpicByFeatureName and task list for listFromBeads
        if (argList.includes('--type') && argList[argList.indexOf('--type') + 1] === 'epic') {
          return JSON.stringify([{ id: 'bd-epic-test', title: 'test-feature', type: 'epic', status: 'open' }]) as any;
        }
        // Task listing: return created tasks (tests may override with spies)
        return JSON.stringify(mockCreatedTasks) as any;
      }
      if (argList[0] === 'dep' && argList[1] === 'list') {
        // dep list <parent> --direction up --json returns dependency objects
        // parseDependentIssues expects { type: 'parent-child', issue: { id, title, status, type } }
        return JSON.stringify(
          mockCreatedTasks.map((t) => ({
            type: 'parent-child',
            issue: { ...t, type: 'task' },
          })),
        ) as any;
      }
      throw new Error(`Unexpected br args: ${argList.join(' ')}`);
    });
    const stores = createStores(PROJECT_ROOT, 'on', createRepository());
    service = new TaskService(PROJECT_ROOT, stores.taskStore, 'on');
    const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
    offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
  });

  afterEach(() => {
    execFileSyncSpy.mockRestore();
    cleanup();
  });

  describe('update', () => {
    it('updates task status with locked atomic write', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { beadId: 'bd-task-1' });

      const result = offModeService.update(featureName, '01-test-task', {
        status: 'in_progress',
      });

      expect(result.status).toBe('in_progress');
      expect(result.startedAt).toBeDefined();
      expect(result.schemaVersion).toBe(TASK_STATUS_SCHEMA_VERSION);

      // Verify no lock file remains
      const statusPath = path.join(TEST_DIR, '.beads/artifacts', featureName, 'tasks', '01-test-task', 'status.json');
      expect(fs.existsSync(getLockPath(statusPath))).toBe(false);
    });

    it('sets completedAt when status is done', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { beadId: 'bd-task-1', startedAt: new Date().toISOString() });

      const result = offModeService.update(featureName, '01-test-task', {
        status: 'done',
        summary: 'Task completed successfully',
      });

      expect(result.status).toBe('done');
      expect(result.completedAt).toBeDefined();
      expect(result.summary).toBe('Task completed successfully');
    });

    it('throws error for non-existent task', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      expect(() => offModeService.update(featureName, 'nonexistent-task', { status: 'in_progress' })).toThrow(
        /not found/,
      );
    });

    it('preserves existing fields on update', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        beadId: 'bd-task-1',
        planTitle: 'Original Title',
        baseCommit: 'abc123',
      });

      const result = offModeService.update(featureName, '01-test-task', {
        status: 'in_progress',
      });

      expect(result.planTitle).toBe('Original Title');
      expect(result.baseCommit).toBe('abc123');
    });
  });

  describe('status change callbacks', () => {
    it('invokes the callback when a task status actually changes', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { status: 'pending' });

      const callbackCalls: Array<{
        featureName: string;
        taskFolder: string;
        previousStatus: string;
        nextStatus: string;
      }> = [];
      const stores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const serviceWithCallback = new TaskService(PROJECT_ROOT, stores.taskStore, 'off', {
        onTaskStatusChanged: (callbackFeatureName, callbackTaskFolder, previousStatus, nextStatus) => {
          callbackCalls.push({
            featureName: callbackFeatureName,
            taskFolder: callbackTaskFolder,
            previousStatus,
            nextStatus,
          });
        },
      });

      serviceWithCallback.update(featureName, '01-test-task', { status: 'in_progress' });

      expect(callbackCalls).toEqual([
        {
          featureName,
          taskFolder: '01-test-task',
          previousStatus: 'pending',
          nextStatus: 'in_progress',
        },
      ]);
    });

    it('does not invoke the callback for summary-only or no-op status updates', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { status: 'in_progress' });

      const callbackCalls: Array<{ previousStatus: string; nextStatus: string }> = [];
      const stores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const serviceWithCallback = new TaskService(PROJECT_ROOT, stores.taskStore, 'off', {
        onTaskStatusChanged: (_featureName, _taskFolder, previousStatus, nextStatus) => {
          callbackCalls.push({ previousStatus, nextStatus });
        },
      });

      serviceWithCallback.update(featureName, '01-test-task', { summary: 'Still working' });
      serviceWithCallback.update(featureName, '01-test-task', { status: 'in_progress' });

      expect(callbackCalls).toEqual([]);
    });
  });

  describe('patchBackgroundFields', () => {
    it('patches only background-owned fields', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'in_progress',
        summary: 'Working on it',
      });

      const result = offModeService.patchBackgroundFields(featureName, '01-test-task', {
        idempotencyKey: 'key-123',
        workerSession: {
          sessionId: 'session-abc',
          agent: 'forager',
          mode: 'delegate',
        },
      });

      // Background fields updated
      expect(result.idempotencyKey).toBe('key-123');
      expect(result.workerSession?.sessionId).toBe('session-abc');
      expect(result.workerSession?.agent).toBe('forager');
      expect(result.workerSession?.mode).toBe('delegate');

      // Completion-owned fields preserved
      expect(result.status).toBe('in_progress');
      expect(result.summary).toBe('Working on it');
    });

    it('deep merges workerSession fields', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        workerSession: {
          sessionId: 'session-abc',
          attempt: 1,
          messageCount: 5,
        },
      });

      // Use off-mode service: setupTask writes to local filesystem,
      // and getRawStatus in on-mode reads from bead state (which has no patched session).
      // Patch only lastHeartbeatAt
      offModeService.patchBackgroundFields(featureName, '01-test-task', {
        workerSession: {
          lastHeartbeatAt: '2025-01-23T00:00:00Z',
        } as any,
      });

      const result = offModeService.getRawStatus(featureName, '01-test-task');

      // Original workerSession fields preserved
      expect(result?.workerSession?.sessionId).toBe('session-abc');
      expect(result?.workerSession?.attempt).toBe(1);
      expect(result?.workerSession?.messageCount).toBe(5);
      // New field added
      expect(result?.workerSession?.lastHeartbeatAt).toBe('2025-01-23T00:00:00Z');
    });

    it('does not clobber completion-owned fields', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'done',
        summary: 'Completed successfully',
        completedAt: '2025-01-22T00:00:00Z',
      });

      // Background patch should not touch these
      offModeService.patchBackgroundFields(featureName, '01-test-task', {
        workerSession: { sessionId: 'new-session' },
      });

      const result = offModeService.getRawStatus(featureName, '01-test-task');

      expect(result?.status).toBe('done');
      expect(result?.summary).toBe('Completed successfully');
      expect(result?.completedAt).toBe('2025-01-22T00:00:00Z');
    });

    it('sets schemaVersion on patch', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task');

      const result = offModeService.patchBackgroundFields(featureName, '01-test-task', {
        idempotencyKey: 'key-456',
      });

      expect(result.schemaVersion).toBe(TASK_STATUS_SCHEMA_VERSION);
    });

    it('releases lock after patch', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task');

      offModeService.patchBackgroundFields(featureName, '01-test-task', {
        idempotencyKey: 'test',
      });

      const statusPath = path.join(TEST_DIR, '.beads/artifacts', featureName, 'tasks', '01-test-task', 'status.json');
      expect(fs.existsSync(getLockPath(statusPath))).toBe(false);
    });
  });

  describe('getRawStatus', () => {
    it('returns full TaskStatus including new fields', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        schemaVersion: 1,
        idempotencyKey: 'key-789',
        workerSession: {
          sessionId: 'session-xyz',
          taskId: 'bg-task-1',
          agent: 'forager',
          mode: 'delegate',
          attempt: 2,
        },
      });

      const result = offModeService.getRawStatus(featureName, '01-test-task');

      expect(result).not.toBeNull();
      expect(result?.schemaVersion).toBe(1);
      expect(result?.idempotencyKey).toBe('key-789');
      expect(result?.workerSession?.sessionId).toBe('session-xyz');
      expect(result?.workerSession?.taskId).toBe('bg-task-1');
      expect(result?.workerSession?.agent).toBe('forager');
      expect(result?.workerSession?.mode).toBe('delegate');
      expect(result?.workerSession?.attempt).toBe(2);
    });

    it('returns null for non-existent task', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      const result = offModeService.getRawStatus(featureName, 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('dependsOn field', () => {
    it('existing tasks without dependsOn continue to load and display', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      // Create task without dependsOn (current format)
      setupTask(featureName, '01-test-task', {
        status: 'pending',
        planTitle: 'Test Task',
        // No dependsOn field
      });

      const result = offModeService.getRawStatus(featureName, '01-test-task');

      expect(result).not.toBeNull();
      expect(result?.status).toBe('pending');
      expect(result?.planTitle).toBe('Test Task');
      // dependsOn should be undefined for current tasks
      expect(result?.dependsOn).toBeUndefined();
    });

    it('tasks with dependsOn array load correctly', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '02-dependent-task', {
        status: 'pending',
        planTitle: 'Dependent Task',
        dependsOn: ['01-setup', '01-core-api'],
      });

      const result = offModeService.getRawStatus(featureName, '02-dependent-task');

      expect(result).not.toBeNull();
      expect(result?.dependsOn).toEqual(['01-setup', '01-core-api']);
    });

    it('preserves dependsOn field on update', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '02-dependent-task', {
        beadId: 'bd-task-1',
        status: 'pending',
        dependsOn: ['01-setup'],
      });

      const result = offModeService.update(featureName, '02-dependent-task', {
        status: 'in_progress',
      });

      expect(result.status).toBe('in_progress');
      expect(result.dependsOn).toEqual(['01-setup']);
    });

    it('handles empty dependsOn array', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-independent-task', {
        status: 'pending',
        dependsOn: [],
      });

      const result = offModeService.getRawStatus(featureName, '01-independent-task');

      expect(result).not.toBeNull();
      expect(result?.dependsOn).toEqual([]);
    });
  });

  describe('sync() - dependency parsing', () => {
    it('parses explicit Depends on: annotations and resolves to folder names (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Plan with explicit dependencies
      const planContent = `# Plan

### 1. Setup Base

Base setup task.

### 2. Build Core

**Depends on**: 1

Build the core module.

### 3. Build UI

**Depends on**: 1, 2

Build the UI layer.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Use off-mode service to test local file creation
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      const result = offModeService.sync(featureName);

      expect(result.created).toContain('01-setup-base');
      expect(result.created).toContain('02-build-core');
      expect(result.created).toContain('03-build-ui');

      // Check status.json for dependencies
      const task1Status = offModeService.getRawStatus(featureName, '01-setup-base');
      const task2Status = offModeService.getRawStatus(featureName, '02-build-core');
      const task3Status = offModeService.getRawStatus(featureName, '03-build-ui');

      // Task 1 has no dependencies (first task, implicit none)
      expect(task1Status?.dependsOn).toEqual([]);

      // Task 2 depends on task 1
      expect(task2Status?.dependsOn).toEqual(['01-setup-base']);

      // Task 3 depends on tasks 1 and 2
      expect(task3Status?.dependsOn).toEqual(['01-setup-base', '02-build-core']);
    });

    it('parses Depends on: none and produces empty dependency list (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. Independent Task A

**Depends on**: none

Can run independently.

### 2. Independent Task B

Depends on: none

Also independent.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Use off-mode service to test local file creation
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      const _result = offModeService.sync(featureName);

      const task1Status = offModeService.getRawStatus(featureName, '01-independent-task-a');
      const task2Status = offModeService.getRawStatus(featureName, '02-independent-task-b');

      expect(task1Status?.dependsOn).toEqual([]);
      expect(task2Status?.dependsOn).toEqual([]);
    });

    it('applies implicit sequential dependencies when Depends on: is missing (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Plan without any dependency annotations - should use implicit sequential
      const planContent = `# Plan

### 1. First Task

Do the first thing.

### 2. Second Task

Do the second thing.

### 3. Third Task

Do the third thing.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Use off-mode service to test local file creation
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      const _result = offModeService.sync(featureName);

      const task1Status = offModeService.getRawStatus(featureName, '01-first-task');
      const task2Status = offModeService.getRawStatus(featureName, '02-second-task');
      const task3Status = offModeService.getRawStatus(featureName, '03-third-task');

      // Task 1 - no dependencies (first task)
      expect(task1Status?.dependsOn).toEqual([]);

      // Task 2 - implicit dependency on task 1
      expect(task2Status?.dependsOn).toEqual(['01-first-task']);

      // Task 3 - implicit dependency on task 2
      expect(task3Status?.dependsOn).toEqual(['02-second-task']);
    });

    it('stores generated spec in the main task bead', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. Setup

Setup task.

### 2. Build

**Depends on**: 1

Build task.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      service.sync(featureName);

      expect(execFileSyncSpy).toHaveBeenCalledWith(
        'br',
        expect.arrayContaining(['update', expect.any(String), '--description', expect.any(String)]),
        expect.objectContaining({ cwd: TEST_DIR }),
      );
    });

    it('stores spec in the main task bead when dependencies are explicitly none', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. Independent Task

**Depends on**: none

Independent task.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      service.sync(featureName);

      expect(execFileSyncSpy).toHaveBeenCalledWith(
        'br',
        expect.arrayContaining(['update', expect.any(String), '--description', expect.any(String)]),
        expect.objectContaining({ cwd: TEST_DIR }),
      );
    });

    it('handles mixed explicit and implicit dependencies (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. Base

Base task.

### 2. Core

No dependency annotation - implicit sequential.

### 3. UI

**Depends on**: 1

Explicitly depends only on 1, not 2.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Use off-mode service to test local file creation
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      offModeService.sync(featureName);

      const task1Status = offModeService.getRawStatus(featureName, '01-base');
      const task2Status = offModeService.getRawStatus(featureName, '02-core');
      const task3Status = offModeService.getRawStatus(featureName, '03-ui');

      // Task 1 - no dependencies
      expect(task1Status?.dependsOn).toEqual([]);

      // Task 2 - implicit dependency on task 1
      expect(task2Status?.dependsOn).toEqual(['01-base']);

      // Task 3 - explicit dependency on task 1 only (not 2)
      expect(task3Status?.dependsOn).toEqual(['01-base']);
    });
  });

  describe('sync() - dependency validation', () => {
    it('throws error for unknown task numbers in dependencies', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Task 2 depends on non-existent task 99
      const planContent = `# Plan

### 1. First Task

First task description.

### 2. Second Task

**Depends on**: 1, 99

Second task depends on unknown task 99.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      expect(() => service.sync(featureName)).toThrow(/unknown task number.*99/i);
    });

    it('throws error for self-dependency', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Task 2 depends on itself
      const planContent = `# Plan

### 1. First Task

First task description.

### 2. Self Referential Task

**Depends on**: 2

This task depends on itself.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      expect(() => service.sync(featureName)).toThrow(/self-dependency.*task 2/i);
    });

    it('throws error for cyclic dependencies (simple A->B->A)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Task 1 depends on task 2, task 2 depends on task 1
      const planContent = `# Plan

### 1. Task A

**Depends on**: 2

Task A depends on B.

### 2. Task B

**Depends on**: 1

Task B depends on A.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      expect(() => service.sync(featureName)).toThrow(/cycle.*1.*2/i);
    });

    it('throws error for cyclic dependencies (longer chain A->B->C->A)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Cycle: 1->2->3->1
      const planContent = `# Plan

### 1. Task A

**Depends on**: 3

Task A depends on C.

### 2. Task B

**Depends on**: 1

Task B depends on A.

### 3. Task C

**Depends on**: 2

Task C depends on B.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      expect(() => service.sync(featureName)).toThrow(/cycle/i);
    });

    it('error message for unknown deps points to plan.md', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. Only Task

**Depends on**: 5

Depends on non-existent task 5.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      expect(() => service.sync(featureName)).toThrow(/plan\.md/i);
    });

    it('error message for cycle points to plan.md', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. Task A

**Depends on**: 2

Cycle with B.

### 2. Task B

**Depends on**: 1

Cycle with A.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      expect(() => service.sync(featureName)).toThrow(/plan\.md/i);
    });

    it('accepts valid dependency graphs without cycles', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Valid DAG: 1 <- 2, 1 <- 3, 2 <- 4, 3 <- 4
      const planContent = `# Plan

### 1. Base

**Depends on**: none

Base task.

### 2. Left Branch

**Depends on**: 1

Left branch.

### 3. Right Branch

**Depends on**: 1

Right branch.

### 4. Merge

**Depends on**: 2, 3

Merge both branches.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Should not throw
      const result = service.sync(featureName);
      expect(result.created).toContain('01-base');
      expect(result.created).toContain('02-left-branch');
      expect(result.created).toContain('03-right-branch');
      expect(result.created).toContain('04-merge');
    });
  });

  describe('concurrent access safety', () => {
    it('handles rapid sequential updates without corruption', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task');

      // Use off-mode service: setupTask writes to local filesystem,
      // and on-mode reads from bead state which doesn't reflect local patches.
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      // Rapid sequential updates
      for (let i = 0; i < 10; i++) {
        offModeService.patchBackgroundFields(featureName, '01-test-task', {
          workerSession: {
            sessionId: 'session-1',
            messageCount: i,
          } as any,
        });
      }

      const result = offModeService.getRawStatus(featureName, '01-test-task');

      // Last write wins
      expect(result?.workerSession?.messageCount).toBe(9);
      // File should be valid JSON
      const statusPath = path.join(TEST_DIR, '.beads/artifacts', featureName, 'tasks', '01-test-task', 'status.json');
      expect(() => JSON.parse(fs.readFileSync(statusPath, 'utf-8'))).not.toThrow();
    });
  });

  describe('sync() - dependency parsing edge cases', () => {
    it('handles whitespace variations in Depends on line (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Whitespace variations: extra spaces, tabs, etc.
      const planContent = `# Plan

### 1. Base Task

Base task.

### 2. Task With Spaces

**Depends on**:   1

Task with extra spaces after colon.

### 3. Task With Comma Spaces

**Depends on**: 1 , 2

Task with spaces around comma.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Use off-mode service to test local file creation
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      const result = offModeService.sync(featureName);

      expect(result.created).toContain('01-base-task');
      expect(result.created).toContain('02-task-with-spaces');
      expect(result.created).toContain('03-task-with-comma-spaces');

      const task2Status = offModeService.getRawStatus(featureName, '02-task-with-spaces');
      const task3Status = offModeService.getRawStatus(featureName, '03-task-with-comma-spaces');

      expect(task2Status?.dependsOn).toEqual(['01-base-task']);
      expect(task3Status?.dependsOn).toEqual(['01-base-task', '02-task-with-spaces']);
    });

    it('handles non-bold Depends on format (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Non-bold format
      const planContent = `# Plan

### 1. First

First task.

### 2. Second

Depends on: 1

Second depends on first (non-bold format).
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Use off-mode service to test local file creation
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      const _result = offModeService.sync(featureName);

      const task2Status = offModeService.getRawStatus(featureName, '02-second');
      expect(task2Status?.dependsOn).toEqual(['01-first']);
    });

    it('handles bullet-point prefixed Depends on format (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Bullet-point formats: "- Depends on: 1" and "- **Depends on**: 1, 2"
      const planContent = `# Plan

### 1. Base

Base task.

### 2. Middle

- Depends on: 1

Middle task with bullet-point dependency.

### 3. Top

- **Depends on**: 1, 2

Top task with bold bullet-point dependency.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      const _result = offModeService.sync(featureName);

      const task2Status = offModeService.getRawStatus(featureName, '02-middle');
      expect(task2Status?.dependsOn).toEqual(['01-base']);

      const task3Status = offModeService.getRawStatus(featureName, '03-top');
      expect(task3Status?.dependsOn).toEqual(['01-base', '02-middle']);
    });

    it('handles case insensitive none keyword (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // "None" with capital N
      const planContent = `# Plan

### 1. Independent Task

**Depends on**: None

Independent task with capital None.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Use off-mode service to test local file creation
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      const _result = offModeService.sync(featureName);

      const task1Status = offModeService.getRawStatus(featureName, '01-independent-task');
      expect(task1Status?.dependsOn).toEqual([]);
    });
  });

  describe('sync() - dependency validation edge cases', () => {
    it('allows forward dependencies (later task depending on earlier)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Normal forward dependency
      const planContent = `# Plan

### 1. Foundation

**Depends on**: none

Foundation task.

### 2. Build

**Depends on**: 1

Build depends on foundation.

### 3. Test

**Depends on**: 2

Test depends on build.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Should not throw
      const result = service.sync(featureName);
      expect(result.created.length).toBe(3);
    });

    it('throws error for diamond with cycle', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Diamond with cycle: 1->2, 1->3, 2->4, 3->4, 4->1
      const planContent = `# Plan

### 1. Start

**Depends on**: 4

Start depends on end (creates cycle).

### 2. Left

**Depends on**: 1

Left branch.

### 3. Right

**Depends on**: 1

Right branch.

### 4. End

**Depends on**: 2, 3

End depends on both branches.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      expect(() => service.sync(featureName)).toThrow(/cycle/i);
    });

    it('provides clear error for multiple unknown dependencies', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // Multiple unknown task numbers
      const planContent = `# Plan

### 1. Only Task

**Depends on**: 5, 10, 99

Depends on multiple non-existent tasks.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      expect(() => service.sync(featureName)).toThrow(/unknown.*task/i);
    });
  });

  describe('buildSpecData - structured data generation', () => {
    it('returns structured SpecData with all required fields', () => {
      const featureName = 'test-feature';
      const planContent = `# Plan

### 1. Test Task

Description of the test task.
`;

      const result = service.buildSpecData({
        featureName,
        task: { folder: '01-test-task', name: 'Test Task', order: 1 },
        dependsOn: [],
        allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
        planContent,
        contextFiles: [],
        completedTasks: [],
      });

      expect(result.featureName).toBe(featureName);
      expect(result.task.folder).toBe('01-test-task');
      expect(result.task.name).toBe('Test Task');
      expect(result.task.order).toBe(1);
      expect(result.dependsOn).toEqual([]);
      expect(result.allTasks).toHaveLength(1);
      expect(result.planSection).toContain('Test Task');
      expect(result.contextFiles).toEqual([]);
      expect(result.completedTasks).toEqual([]);
    });

    it('includes dependencies in dependsOn', () => {
      const featureName = 'test-feature';
      const planContent = `# Plan

### 1. First Task

First description.

### 2. Second Task

**Depends on**: 1

Second description.
`;

      const result = service.buildSpecData({
        featureName,
        task: { folder: '02-second-task', name: 'Second Task', order: 2 },
        dependsOn: ['01-first-task'],
        allTasks: [
          { folder: '01-first-task', name: 'First Task', order: 1 },
          { folder: '02-second-task', name: 'Second Task', order: 2 },
        ],
        planContent,
      });

      expect(result.dependsOn).toEqual(['01-first-task']);
    });

    it('extracts correct plan section for the task', () => {
      const featureName = 'test-feature';
      const planContent = `# Plan

### 1. Setup

Setup the environment.

### 2. Build

Build the project.

### 3. Test

Run tests.
`;

      const result = service.buildSpecData({
        featureName,
        task: { folder: '02-build', name: 'Build', order: 2 },
        dependsOn: ['01-setup'],
        allTasks: [
          { folder: '01-setup', name: 'Setup', order: 1 },
          { folder: '02-build', name: 'Build', order: 2 },
          { folder: '03-test', name: 'Test', order: 3 },
        ],
        planContent,
      });

      expect(result.planSection).toContain('Build');
      expect(result.planSection).toContain('Build the project');
      expect(result.planSection).not.toContain('Setup');
      expect(result.planSection).not.toContain('Run tests');
    });

    it('returns null planSection when task not found in plan', () => {
      const featureName = 'test-feature';
      const planContent = `# Plan

### 1. Only Task

Only task description.
`;

      const result = service.buildSpecData({
        featureName,
        task: { folder: '99-missing-task', name: 'Missing Task', order: 99 },
        dependsOn: [],
        allTasks: [{ folder: '99-missing-task', name: 'Missing Task', order: 99 }],
        planContent,
      });

      expect(result.planSection).toBeNull();
    });

    it('includes context files in SpecData', () => {
      const featureName = 'test-feature';
      const planContent = `# Plan

### 1. Test Task

Description.
`;

      const contextFiles = [
        { name: 'notes.md', content: '# Notes\nSome notes' },
        { name: 'config.json', content: '{"key": "value"}' },
      ];

      const result = service.buildSpecData({
        featureName,
        task: { folder: '01-test-task', name: 'Test Task', order: 1 },
        dependsOn: [],
        allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
        planContent,
        contextFiles,
      });

      expect(result.contextFiles).toEqual(contextFiles);
    });

    it('includes completed tasks in SpecData', () => {
      const featureName = 'test-feature';
      const planContent = `# Plan

### 1. Test Task

Description.
`;

      const completedTasks = [
        { name: '01-previous-task', summary: 'Previous work done' },
        { name: '02-another-task', summary: 'Another task completed' },
      ];

      const result = service.buildSpecData({
        featureName,
        task: { folder: '03-test-task', name: 'Test Task', order: 3 },
        dependsOn: ['01-previous-task', '02-another-task'],
        allTasks: [
          { folder: '01-previous-task', name: 'Previous Task', order: 1 },
          { folder: '02-another-task', name: 'Another Task', order: 2 },
          { folder: '03-test-task', name: 'Test Task', order: 3 },
        ],
        planContent,
        completedTasks,
      });

      expect(result.completedTasks).toEqual(completedTasks);
    });

    it('handles optional parameters with defaults', () => {
      const featureName = 'test-feature';

      const result = service.buildSpecData({
        featureName,
        task: { folder: '01-test-task', name: 'Test Task', order: 1 },
        dependsOn: [],
        allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
        // No planContent, contextFiles, or completedTasks provided
      });

      expect(result.planSection).toBeNull();
      expect(result.contextFiles).toEqual([]);
      expect(result.completedTasks).toEqual([]);
    });
  });

  describe('formatSpecContent - task type inference', () => {
    it('should infer greenfield type when plan section has only Create: files', () => {
      const featureName = 'test-feature';
      const planContent = `# Plan

### 1. Greenfield Task

**Depends on**: none

**Files:**
- Create: \`packages/warcraft-core/src/new-module.ts\`

Create the new module.
`;

      const specData = service.buildSpecData({
        featureName,
        task: { folder: '01-greenfield-task', name: 'Greenfield Task', order: 1 },
        dependsOn: [],
        allTasks: [{ folder: '01-greenfield-task', name: 'Greenfield Task', order: 1 }],
        planContent,
      });
      const specContent = formatSpecContent(specData);

      expect(specContent).toContain('## Task Type');
      expect(specContent).toContain('greenfield');
    });

    it('should infer testing type when plan section has only Test: files', () => {
      const featureName = 'test-feature';
      const planContent = `# Plan

### 1. Coverage Update

**Depends on**: none

**Files:**
- Test: \`packages/warcraft-core/src/services/taskService.test.ts\`

Add coverage for task specs.
`;

      const specData = service.buildSpecData({
        featureName,
        task: { folder: '01-coverage-update', name: 'Coverage Update', order: 1 },
        dependsOn: [],
        allTasks: [{ folder: '01-coverage-update', name: 'Coverage Update', order: 1 }],
        planContent,
      });
      const specContent = formatSpecContent(specData);

      expect(specContent).toContain('## Task Type');
      expect(specContent).toContain('testing');
    });

    it('should infer modification type when plan section has Modify: files', () => {
      const featureName = 'test-feature';
      const planContent = `# Plan

### 1. Update Worker Prompt

**Depends on**: none

**Files:**
- Modify: \`packages/opencode-warcraft/src/agents/forager.ts\`

Update prompt copy.
`;

      const specData = service.buildSpecData({
        featureName,
        task: { folder: '01-update-worker-prompt', name: 'Update Worker Prompt', order: 1 },
        dependsOn: [],
        allTasks: [{ folder: '01-update-worker-prompt', name: 'Update Worker Prompt', order: 1 }],
        planContent,
      });
      const specContent = formatSpecContent(specData);

      expect(specContent).toContain('## Task Type');
      expect(specContent).toContain('modification');
    });

    it('should omit task type when no inference signal is present', () => {
      const featureName = 'test-feature';
      const planContent = `# Plan

### 1. Align Docs

**Depends on**: none

Align documentation wording.
`;

      const specData = service.buildSpecData({
        featureName,
        task: { folder: '01-align-docs', name: 'Align Docs', order: 1 },
        dependsOn: [],
        allTasks: [{ folder: '01-align-docs', name: 'Align Docs', order: 1 }],
        planContent,
      });
      const specContent = formatSpecContent(specData);

      expect(specContent).not.toContain('## Task Type');
    });
  });

  describe('import/flush lifecycle', () => {
    it('does not force importArtifacts before readTaskBeadArtifact when beadsMode is on', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { beadId: 'bd-task-1' });

      // Create a new service with beadsMode on
      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      const getRawStatusSpy = spyOn(onStores.taskStore, 'getRawStatus').mockReturnValue({
        status: 'pending',
        origin: 'plan',
        planTitle: 'Test Task',
        beadId: 'bd-task-1',
      } as TaskStatus);

      // Spy on importArtifacts (read path should not force import)
      const importSpy = spyOn(onRepo.getGateway(), 'importArtifacts').mockImplementation(() => {});
      const readArtifactSpy = spyOn(onRepo.getGateway(), 'readArtifact').mockReturnValue('spec content');

      const result = onModeService.readTaskBeadArtifact(featureName, '01-test-task', 'spec');

      expect(importSpy).not.toHaveBeenCalled();
      expect(readArtifactSpy).toHaveBeenCalledWith('bd-task-1', 'spec');
      expect(result).toBe('spec content');

      importSpy.mockRestore();
      readArtifactSpy.mockRestore();
      getRawStatusSpy.mockRestore();
    });

    it('does not call importArtifacts when beadsMode is off', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { beadId: 'bd-task-1' });

      // Create a new service with beadsMode off
      // In off mode, FilesystemTaskStore does not receive BeadsRepository
      const offRepo = createRepository('off');
      const offStores = createStores(PROJECT_ROOT, 'off', offRepo);
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      // Spy on importArtifacts
      const importSpy = spyOn(offRepo, 'importArtifacts').mockImplementation(() => ({
        success: true,
        value: undefined,
      }));
      const readArtifactSpy = spyOn(offRepo, 'readTaskArtifact').mockReturnValue({ success: true, value: null });

      const result = offModeService.readTaskBeadArtifact(featureName, '01-test-task', 'spec');

      expect(importSpy).not.toHaveBeenCalled();
      // In off mode, the store has no repository reference, so readTaskArtifact is NOT called
      expect(readArtifactSpy).not.toHaveBeenCalled();
      expect(result).toBeNull();

      importSpy.mockRestore();
      readArtifactSpy.mockRestore();
    });

    it('calls flushArtifacts after update when status changes and beadsMode is on', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { beadId: 'bd-task-1', status: 'pending' });

      // Create a new service with beadsMode on
      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      const getRawStatusSpy = spyOn(onStores.taskStore, 'getRawStatus').mockReturnValue({
        status: 'pending',
        origin: 'plan',
        planTitle: 'Test Task',
        beadId: 'bd-task-1',
      } as TaskStatus);

      // Spy on flushArtifacts
      const flushSpy = spyOn(onRepo.getGateway(), 'flushArtifacts').mockImplementation(() => {});
      const syncStatusSpy = spyOn(onRepo.getGateway(), 'syncTaskStatus').mockImplementation(() => {});

      const result = onModeService.update(featureName, '01-test-task', { status: 'in_progress' });

      expect(syncStatusSpy).toHaveBeenCalledWith('bd-task-1', 'in_progress');
      expect(flushSpy).toHaveBeenCalled();
      expect(result.status).toBe('in_progress');

      flushSpy.mockRestore();
      syncStatusSpy.mockRestore();
      getRawStatusSpy.mockRestore();
    });

    it('does not sync bead status when status is unchanged', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { beadId: 'bd-task-1', status: 'pending' });

      // Create a new service with beadsMode on
      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      const getRawStatusSpy = spyOn(onStores.taskStore, 'getRawStatus').mockReturnValue({
        status: 'pending',
        origin: 'plan',
        planTitle: 'Test Task',
        beadId: 'bd-task-1',
      } as TaskStatus);

      // Spy on syncTaskStatus
      const syncStatusSpy = spyOn(onRepo.getGateway(), 'syncTaskStatus').mockImplementation(() => {});

      // Update without changing status
      const result = onModeService.update(featureName, '01-test-task', { summary: 'Updated summary' });

      expect(syncStatusSpy).not.toHaveBeenCalled();
      expect(result.summary).toBe('Updated summary');

      syncStatusSpy.mockRestore();
      getRawStatusSpy.mockRestore();
    });

    it('calls flushArtifacts after writeSpec when beadsMode is on', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { beadId: 'bd-task-1' });

      // Create a new service with beadsMode on
      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      const getRawStatusSpy = spyOn(onStores.taskStore, 'getRawStatus').mockReturnValue({
        status: 'pending',
        origin: 'plan',
        planTitle: 'Test Task',
        beadId: 'bd-task-1',
      } as TaskStatus);

      // Spy on flushArtifacts
      const flushSpy = spyOn(onRepo.getGateway(), 'flushArtifacts').mockImplementation(() => {});
      const upsertSpy = spyOn(onRepo.getGateway(), 'upsertArtifact').mockImplementation(() => {});

      const beadId = onModeService.writeSpec(featureName, '01-test-task', 'spec content');

      expect(upsertSpy).toHaveBeenCalledWith('bd-task-1', 'spec', 'spec content');
      expect(flushSpy).toHaveBeenCalled();
      expect(beadId).toBe('bd-task-1');

      flushSpy.mockRestore();
      upsertSpy.mockRestore();
      getRawStatusSpy.mockRestore();
    });

    it('does not call flushArtifacts in writeSpec when beadsMode is off', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { beadId: 'bd-task-1' });

      // Create a new service with beadsMode off
      // In off mode, FilesystemTaskStore does not receive BeadsRepository
      const offRepo = createRepository('off');
      const offStores = createStores(PROJECT_ROOT, 'off', offRepo);
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      // Spy on repository methods
      const flushSpy = spyOn(offRepo, 'flushArtifacts').mockImplementation(() => ({ success: true, value: undefined }));
      const upsertSpy = spyOn(offRepo, 'upsertTaskArtifact').mockImplementation(() => ({
        success: true,
        value: undefined,
      }));

      const result = offModeService.writeSpec(featureName, '01-test-task', 'spec content');

      // In off mode, the store has no repository reference, so upsertTaskArtifact is NOT called
      expect(upsertSpy).not.toHaveBeenCalled();
      expect(flushSpy).not.toHaveBeenCalled();
      // Returns folder name as fallback identifier when repository is absent
      expect(result).toBe('01-test-task');

      flushSpy.mockRestore();
      upsertSpy.mockRestore();
    });
  });

  describe('writeReport - beadsMode integration', () => {
    it('writes report to bead artifact only (no filesystem) when beadsMode is on', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { beadId: 'bd-task-1' });

      // Create mock repository
      const mockRepository = {
        upsertTaskArtifact: () => ({ success: true, value: undefined }),
        flushArtifacts: () => ({ success: true, value: undefined }),
        importArtifacts: () => ({ success: true, value: undefined }),
        readTaskArtifact: () => ({ success: true, value: null }),
        getGateway: () => ({ list: () => [], readArtifact: () => null }),
        getEpicByFeatureName: () => ({ success: true, value: 'bd-epic-test' }),
        listTaskBeadsForEpic: () => ({ success: true, value: [] }),
        getRobotPlan: () => null,
      };
      const upsertSpy = spyOn(mockRepository, 'upsertTaskArtifact').mockImplementation(() => ({
        success: true,
        value: undefined,
      }));

      // Create service with beadsMode on and mock repository
      const onStores = createStores(PROJECT_ROOT, 'on', mockRepository as any);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      const getRawStatusSpy = spyOn(onStores.taskStore, 'getRawStatus').mockReturnValue({
        status: 'done',
        origin: 'plan',
        planTitle: 'Test Task',
        beadId: 'bd-task-1',
      } as TaskStatus);

      const reportContent = '# Task Report\n\nCompleted successfully.';
      const reportPath = onModeService.writeReport(featureName, '01-test-task', reportContent);

      // In on-mode, report is NOT written to filesystem (only bead artifacts)
      expect(fs.existsSync(reportPath)).toBe(false);

      // Verify bead artifact was upserted through the repository write path
      expect(upsertSpy).toHaveBeenCalledWith('bd-task-1', 'report', reportContent);

      // Verify a virtual path is still returned
      expect(reportPath).toContain('01-test-task');

      upsertSpy.mockRestore();
      getRawStatusSpy.mockRestore();
    });

    it('writes report to filesystem only when beadsMode is off', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { beadId: 'bd-task-1' });

      // Create mock repository
      const mockRepository = {
        upsertTaskArtifact: () => ({ success: true, value: undefined }),
        flushArtifacts: () => ({ success: true, value: undefined }),
        importArtifacts: () => ({ success: true, value: undefined }),
        readTaskArtifact: () => ({ success: true, value: null }),
        getGateway: () => ({ list: () => [], readArtifact: () => null }),
        getEpicByFeatureName: () => ({ success: true, value: 'bd-epic-test' }),
        listTaskBeadsForEpic: () => ({ success: true, value: [] }),
        getRobotPlan: () => null,
      };
      const upsertSpy = spyOn(mockRepository, 'upsertTaskArtifact').mockImplementation(() => ({
        success: true,
        value: undefined,
      }));
      const flushSpy = spyOn(mockRepository, 'flushArtifacts').mockImplementation(() => ({
        success: true,
        value: undefined,
      }));

      // Create service with beadsMode off and mock repository
      const offStores = createStores(PROJECT_ROOT, 'off', mockRepository as any);
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      const reportContent = '# Task Report\n\nCompleted successfully.';
      const reportPath = offModeService.writeReport(featureName, '01-test-task', reportContent);

      // Verify filesystem write
      expect(fs.existsSync(reportPath)).toBe(true);
      expect(fs.readFileSync(reportPath, 'utf-8')).toBe(reportContent);

      // Verify bead methods not called
      expect(upsertSpy).not.toHaveBeenCalled();
      expect(flushSpy).not.toHaveBeenCalled();

      upsertSpy.mockRestore();
      flushSpy.mockRestore();
    });

    it('throws when beadId is missing in writeReport and beadsMode is on', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      // Task without beadId
      setupTask(featureName, '01-test-task', { status: 'pending' });

      // Create mock repository
      const mockRepository = {
        upsertTaskArtifact: () => ({ success: true, value: undefined }),
        flushArtifacts: () => ({ success: true, value: undefined }),
        importArtifacts: () => ({ success: true, value: undefined }),
        readTaskArtifact: () => ({ success: true, value: null }),
        getGateway: () => ({ list: () => [], readArtifact: () => null }),
        getEpicByFeatureName: () => ({ success: true, value: 'bd-epic-test' }),
        listTaskBeadsForEpic: () => ({ success: true, value: [] }),
        getRobotPlan: () => null,
      };

      // Create service with beadsMode on and mock repository
      const onStores = createStores(PROJECT_ROOT, 'on', mockRepository as any);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');

      const reportContent = '# Task Report';
      expect(() => onModeService.writeReport(featureName, '01-test-task', reportContent)).toThrow(
        /does not have beadId/,
      );
    });
  });

  describe('getRunnableTasks - filesystem mode (beadsMode off)', () => {
    it('returns empty result when no tasks exist', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      // Create service with beadsMode off
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      const result = offModeService.getRunnableTasks(featureName);

      expect(result.runnable).toEqual([]);
      expect(result.blocked).toEqual([]);
      expect(result.completed).toEqual([]);
      expect(result.inProgress).toEqual([]);
      expect(result.source).toBe('filesystem');
    });

    it('categorizes tasks by status correctly', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-pending', { status: 'pending' });
      setupTask(featureName, '02-in-progress', { status: 'in_progress' });
      setupTask(featureName, '03-done', { status: 'done' });
      setupTask(featureName, '04-blocked', { status: 'blocked' });

      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      const result = offModeService.getRunnableTasks(featureName);

      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].folder).toBe('01-pending');
      expect(result.inProgress).toHaveLength(1);
      expect(result.inProgress[0].folder).toBe('02-in-progress');
      expect(result.completed).toHaveLength(1);
      expect(result.completed[0].folder).toBe('03-done');
      expect(result.blocked).toHaveLength(1);
      expect(result.blocked[0].folder).toBe('04-blocked');
    });

    it('respects dependencies - task with incomplete deps is blocked', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-setup', { status: 'pending' });
      setupTask(featureName, '02-dependent', { status: 'pending', dependsOn: ['01-setup'] });

      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      const result = offModeService.getRunnableTasks(featureName);

      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].folder).toBe('01-setup');
      expect(result.blocked).toHaveLength(1);
      expect(result.blocked[0].folder).toBe('02-dependent');
    });

    it('task with completed deps is runnable', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-setup', { status: 'done' });
      setupTask(featureName, '02-dependent', { status: 'pending', dependsOn: ['01-setup'] });

      const offRepo = createRepository('off');
      const offStores = createStores(PROJECT_ROOT, 'off', offRepo);
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      const result = offModeService.getRunnableTasks(featureName);

      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].folder).toBe('02-dependent');
      expect(result.blocked).toHaveLength(0);
    });
  });

  describe('getRunnableTasks - beads mode (beadsMode on)', () => {
    it('falls back to filesystem when robot plan fails', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test', { status: 'pending', beadId: 'bd-1' });

      // Create service with mocked robot plan that returns null
      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      // Mock getRobotPlan to simulate viewer failure
      spyOn(onRepo, 'getRobotPlan').mockImplementation(() => null);

      // Mock gateway list to return the task
      const listSpy = spyOn(onRepo, 'listTaskBeadsForEpic').mockReturnValue({
        success: true,
        value: [{ id: 'bd-1', title: 'Test', status: 'open' }],
      });

      const result = onModeService.getRunnableTasks(featureName);

      // Robot plan fails, falls back to filesystem-based dependency resolution
      // But tasks are listed from beads
      expect(result.source).toBe('filesystem');
      expect(result.runnable).toHaveLength(1);

      listSpy.mockRestore();
    });

    it('uses beads viewer when available', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test', { status: 'pending', beadId: 'bd-task-1' });

      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      // Mock getRobotPlan to return a robot plan
      spyOn(onRepo, 'getRobotPlan').mockImplementation(() => ({
        summary: { total_tracks: 1, total_tasks: 1 },
        tracks: [{ track_id: 1, tasks: ['bd-task-1'] }],
      }));

      // Mock gateway list so listFromBeads can find the task
      const listSpy = spyOn(onRepo, 'listTaskBeadsForEpic').mockReturnValue({
        success: true,
        value: [{ id: 'bd-task-1', title: 'Test', status: 'open' }],
      });

      const result = onModeService.getRunnableTasks(featureName);

      expect(result.source).toBe('beads');
      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].folder).toBe('01-test');

      listSpy.mockRestore();
    });

    it('categorizes tasks from robot plan correctly', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-pending', { status: 'pending', beadId: 'bd-1' });
      setupTask(featureName, '02-in-progress', { status: 'in_progress', beadId: 'bd-2' });
      setupTask(featureName, '03-done', { status: 'done', beadId: 'bd-3' });

      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      // Mock getRobotPlan to return categorized tasks
      spyOn(onRepo, 'getRobotPlan').mockImplementation(() => ({
        summary: { total_tracks: 1, total_tasks: 3 },
        tracks: [{ track_id: 1, tasks: ['bd-1', 'bd-2', 'bd-3'] }],
      }));

      // Mock gateway list so listFromBeads resolves tasks
      const listSpy = spyOn(onRepo, 'listTaskBeadsForEpic').mockReturnValue({
        success: true,
        value: [
          { id: 'bd-1', title: 'Pending', status: 'open' },
          { id: 'bd-2', title: 'In Progress', status: 'in_progress' },
          { id: 'bd-3', title: 'Done', status: 'closed' },
        ],
      });

      const result = onModeService.getRunnableTasks(featureName);

      expect(result.source).toBe('beads');
      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].beadId).toBe('bd-1');
      expect(result.inProgress).toHaveLength(1);
      expect(result.inProgress[0].beadId).toBe('bd-2');
      expect(result.completed).toHaveLength(1);
      expect(result.completed[0].beadId).toBe('bd-3');

      listSpy.mockRestore();
    });

    it('treats dispatch_prepared as active work in both filesystem and beads modes', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-prepared', { status: 'dispatch_prepared', beadId: 'bd-1' });

      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      const offResult = offModeService.getRunnableTasks(featureName);

      expect(offResult.source).toBe('filesystem');
      expect(offResult.runnable).toHaveLength(0);
      expect(offResult.inProgress).toHaveLength(1);
      expect(offResult.inProgress[0].folder).toBe('01-prepared');

      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      spyOn(onRepo, 'getRobotPlan').mockImplementation(() => ({
        summary: { total_tracks: 1, total_tasks: 1 },
        tracks: [{ track_id: 1, tasks: ['bd-1'] }],
      }));

      const listSpy = spyOn(onRepo, 'listTaskBeadsForEpic').mockReturnValue({
        success: true,
        value: [{ id: 'bd-1', title: 'Prepared Task', status: 'in_progress' }],
      });

      const onResult = onModeService.getRunnableTasks(featureName);

      expect(onResult.source).toBe('beads');
      expect(onResult.runnable).toHaveLength(0);
      expect(onResult.inProgress).toHaveLength(1);
      expect(onResult.inProgress[0].beadId).toBe('bd-1');

      listSpy.mockRestore();
    });
  });

  describe('sync() - diagnostics on degraded paths', () => {
    it('returns diagnostics when dependency sync fails', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. Test Task

**Depends on**: none

Test task.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Use off-mode service so we can control the store
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));

      // Add syncDependencies to the store and mock it to simulate failure
      (offStores.taskStore as any).syncDependencies = () => {
        throw new Error('Dependency sync failed: network timeout');
      };

      const logger = createNoopLogger();
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off', logger);

      const result = offModeService.sync(featureName);

      // sync should still succeed
      expect(result.created).toContain('01-test-task');
      // but diagnostics should capture the dependency sync failure
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics!.length).toBeGreaterThan(0);
      expect(result.diagnostics![0].code).toBe('dep_sync_failed');
    });

    it('returns empty diagnostics when sync completes without issues', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. Simple Task

**Depends on**: none

Simple task.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const logger = createNoopLogger();
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off', logger);

      const result = offModeService.sync(featureName);

      expect(result.created).toContain('01-simple-task');
      expect(result.diagnostics).toBeDefined();
      expect(result.diagnostics!.length).toBe(0);
    });
  });

  describe('slug collision detection', () => {
    it('sync() throws when two plan tasks produce the same slug from different names', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // "My Task" (slug: my-task) and "my-task" (slug: my-task) collide
      const planContent = `# Plan

### 1. My Task

**Depends on**: none

First task.

### 2. my-task

**Depends on**: none

Second task with colliding slug.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      expect(() => service.sync(featureName)).toThrow(
        /Task name 'my-task' collides with existing task after slugification \(folder: my-task\)\. Please rename the task\./,
      );
    });

    it('sync() throws when task names differ only by extra whitespace', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      // "My Task" and "My  Task" (double space) both slugify to "my-task"
      const planContent = `# Plan

### 1. My Task

**Depends on**: none

First task.

### 2. My  Task

**Depends on**: none

Second task with extra whitespace.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      expect(() => service.sync(featureName)).toThrow(/collides with existing task after slugification/);
    });

    it('sync() does not throw when tasks have genuinely different slugs', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. Setup API

**Depends on**: none

First task.

### 2. Build UI

**Depends on**: 1

Second task.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Use off-mode to avoid beadId issues
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      // Should NOT throw
      const result = offModeService.sync(featureName);
      expect(result.created).toContain('01-setup-api');
      expect(result.created).toContain('02-build-ui');
    });

    it('create() throws when slug collides with existing task from a different name', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      // Use off-mode so we can verify local filesystem state
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      // Create "My Task" first
      offModeService.create(featureName, 'My Task', 1, 3);

      // "my-task" slugifies to the same slug as "My Task"
      expect(() => offModeService.create(featureName, 'my-task', 2, 3)).toThrow(
        /Task name 'my-task' collides with existing task after slugification \(folder: my-task\)\. Please rename the task\./,
      );
    });

    it('create() throws when the requested order is already in use', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      offModeService.create(featureName, 'Setup API', 1, 3);

      expect(() => offModeService.create(featureName, 'Build UI', 1, 3)).toThrow(
        /Task order 1 is already in use by '01-setup-api'/,
      );
    });

    it('create() throws when the exact task folder already exists', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      offModeService.create(featureName, 'Setup API', 1, 3);

      expect(() => offModeService.create(featureName, 'Setup API', 1, 3)).toThrow(
        /Task order 1 is already in use by '01-setup-api'/,
      );
    });

    it('create() does not throw when slug is unique', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      // Use off-mode
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offModeService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      offModeService.create(featureName, 'Setup API', 1, 3);
      // Different slug, should not throw
      const folder = offModeService.create(featureName, 'Build UI', 2, 3);
      expect(folder).toBe('02-build-ui');
    });
  });

  describe('create validates order parameter', () => {
    it('rejects zero order', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const svc = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      expect(() => svc.create(featureName, 'Test Task', 0, 3)).toThrow(/positive integer/);
    });

    it('rejects negative order', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const svc = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      expect(() => svc.create(featureName, 'Test Task', -1, 3)).toThrow(/positive integer/);
    });

    it('rejects non-integer order', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const svc = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      expect(() => svc.create(featureName, 'Test Task', 1.5, 3)).toThrow(/positive integer/);
    });

    it('accepts valid positive integer order', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const svc = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      const folder = svc.create(featureName, 'Valid Task', 1, 3);
      expect(folder).toBe('01-valid-task');
    });

    it('stores an optional self-contained brief for manual tasks', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const svc = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');
      const folder = svc.create(
        featureName,
        'Valid Task',
        1,
        3,
        'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
      );

      const status = svc.getRawStatus(featureName, folder);
      expect(status?.brief).toContain('Background: tiny change.');
    });
  });

  describe('previewSync and sync produce identical classification', () => {
    it('both methods agree on created/removed/kept/manual for the same input (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. Keep This

**Depends on**: none

Task to keep.

### 2. New Task

**Depends on**: 1

Brand new task.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Setup existing tasks: one matching plan, one removed, one manual, one done
      const offStores1 = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const previewService = new TaskService(PROJECT_ROOT, offStores1.taskStore, 'off');

      // Manually create existing task state on filesystem
      const tasksDir = path.join(featurePath, 'tasks');
      // 01-keep-this: pending, in plan → kept
      const keepDir = path.join(tasksDir, '01-keep-this');
      fs.mkdirSync(keepDir, { recursive: true });
      fs.writeFileSync(
        path.join(keepDir, 'status.json'),
        JSON.stringify({ status: 'pending', origin: 'plan', planTitle: 'Keep This' }),
      );
      // 03-old-task: pending, NOT in plan → removed
      const oldDir = path.join(tasksDir, '03-old-task');
      fs.mkdirSync(oldDir, { recursive: true });
      fs.writeFileSync(
        path.join(oldDir, 'status.json'),
        JSON.stringify({ status: 'pending', origin: 'plan', planTitle: 'Old Task' }),
      );
      // 04-manual-task: manual origin → manual
      const manualDir = path.join(tasksDir, '04-manual-task');
      fs.mkdirSync(manualDir, { recursive: true });
      fs.writeFileSync(
        path.join(manualDir, 'status.json'),
        JSON.stringify({ status: 'pending', origin: 'manual', planTitle: 'Manual Task' }),
      );
      // 05-done-task: done → kept regardless of plan
      const doneDir = path.join(tasksDir, '05-done-task');
      fs.mkdirSync(doneDir, { recursive: true });
      fs.writeFileSync(
        path.join(doneDir, 'status.json'),
        JSON.stringify({ status: 'done', origin: 'plan', planTitle: 'Done Task' }),
      );

      const preview = previewService.previewSync(featureName);

      // Now create a fresh service for sync with the same initial state
      // Recreate the filesystem state since previewSync doesn't mutate
      const offStores2 = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const syncService = new TaskService(PROJECT_ROOT, offStores2.taskStore, 'off');

      const syncResult = syncService.sync(featureName);

      // Classification must be identical
      expect(preview.created.sort()).toEqual(syncResult.created.sort());
      expect(preview.removed.sort()).toEqual(syncResult.removed.sort());
      expect(preview.kept.sort()).toEqual(syncResult.kept.sort());
      expect(preview.manual.sort()).toEqual(syncResult.manual.sort());
    });

    it('previewSync does not mutate store state (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. New Task

**Depends on**: none

New task to create.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Setup a task that will be "removed" by sync
      const tasksDir = path.join(featurePath, 'tasks');
      const oldDir = path.join(tasksDir, '99-old-task');
      fs.mkdirSync(oldDir, { recursive: true });
      fs.writeFileSync(
        path.join(oldDir, 'status.json'),
        JSON.stringify({ status: 'pending', origin: 'plan', planTitle: 'Old Task' }),
      );

      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const svc = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      const tasksBefore = svc.list(featureName);
      const preview = svc.previewSync(featureName);
      const tasksAfter = svc.list(featureName);

      // previewSync should report removal but NOT actually delete
      expect(preview.removed).toContain('99-old-task');
      expect(preview.created).toContain('01-new-task');

      // Store state unchanged
      expect(tasksBefore.length).toBe(tasksAfter.length);
      expect(tasksBefore.map((t) => t.folder).sort()).toEqual(tasksAfter.map((t) => t.folder).sort());
    });
  });

  describe('beads-only mode (beadsMode: on)', () => {
    it('does NOT create local task cache during create()', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      // Create service with beadsMode on
      const onStores = createStores(PROJECT_ROOT, 'on', createRepository('on'));
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');

      const taskFolder = onModeService.create(featureName, 'test-task', 1, 3);

      // Verify task folder name is correct
      expect(taskFolder).toBe('01-test-task');

      // In on-mode, local task cache is NOT created (bead artifacts are canonical)
      const taskPath = path.join(TEST_DIR, '.beads/artifacts', featureName, 'tasks', taskFolder);
      expect(fs.existsSync(taskPath)).toBe(false);
    });

    it('does NOT create local task cache during sync()', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );

      const planContent = `# Plan

### 1. First Task

First task description.

### 2. Second Task

Second task description.
`;
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Create service with beadsMode on
      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      const result = onModeService.sync(featureName);

      // Verify tasks were reported as created
      expect(result.created).toContain('01-first-task');
      expect(result.created).toContain('02-second-task');

      // In on-mode, local task cache directories are NOT created
      const tasksPath = path.join(featurePath, 'tasks');
      expect(fs.existsSync(tasksPath)).toBe(false);
    });

    it('lists tasks from beads in on-mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-task-one', { status: 'pending', beadId: 'bd-task-1', planTitle: 'Task One' });
      setupTask(featureName, '02-task-two', { status: 'pending', beadId: 'bd-task-2', planTitle: 'Task Two' });

      // Create service with beadsMode on
      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');

      // Mock BeadGateway.list to return tasks
      const listSpy = spyOn(onRepo, 'listTaskBeadsForEpic').mockReturnValue({
        success: true,
        value: [
          { id: 'bd-task-1', title: 'Task One', status: 'closed' },
          { id: 'bd-task-2', title: 'Task Two', status: 'closed' },
        ],
      });

      const tasks = onModeService.list(featureName);

      expect(tasks).toHaveLength(2);
      expect(tasks[0].folder).toBe('01-task-one');
      expect(tasks[0].beadId).toBe('bd-task-1');
      expect(tasks[0].status).toBe('done');
      expect(tasks[1].folder).toBe('02-task-two');
      expect(tasks[1].beadId).toBe('bd-task-2');
      expect(tasks[1].status).toBe('done');

      // In on-mode, list() returns from beads — no local cache write verification needed

      listSpy.mockRestore();
    });

    it('maps in-progress, deferred, and pinned bead statuses', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      const listSpy = spyOn(onRepo, 'listTaskBeadsForEpic').mockReturnValue({
        success: true,
        value: [
          { id: 'bd-task-1', title: 'Task In Progress', status: 'in_progress' },
          { id: 'bd-task-2', title: 'Task Deferred', status: 'deferred' },
          { id: 'bd-task-3', title: 'Task Pinned', status: 'pinned' },
        ],
      });

      const tasks = onModeService.list(featureName);

      expect(tasks).toHaveLength(3);
      expect(tasks.find((t) => t.beadId === 'bd-task-1')?.status).toBe('in_progress');
      expect(tasks.find((t) => t.beadId === 'bd-task-2')?.status).toBe('blocked');
      expect(tasks.find((t) => t.beadId === 'bd-task-3')?.status).toBe('pending');

      listSpy.mockRestore();
    });

    it('returns empty when beads returns empty in on-mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      // Setup local task (legacy feature with local files)
      setupTask(featureName, '01-local-task', { status: 'pending', beadId: 'bd-local-1' });

      // Create service with beadsMode on, but beads returns empty
      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');
      const listSpy = spyOn(onRepo, 'listTaskBeadsForEpic').mockReturnValue({ success: true, value: [] });

      const tasks = onModeService.list(featureName);

      // On-mode: beads is canonical — no filesystem fallback
      expect(tasks).toHaveLength(0);

      listSpy.mockRestore();
    });

    it('uses beads-based listing in getRunnableTasksFromBeads', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      // Create service with beadsMode on
      const onRepo = createRepository('on');
      const onStores = createStores(PROJECT_ROOT, 'on', onRepo);
      const _onModeService = new TaskService(PROJECT_ROOT, onStores.taskStore, 'on');

      // Mock BeadGateway.list to return tasks
      const listSpy = spyOn(onRepo, 'listTaskBeadsForEpic').mockReturnValue({
        success: true,
        value: [{ id: 'bd-task-1', title: 'Pending Task', status: 'open' }],
      });

      // Mock robot plan viewer
      const mockViewerRepo = createRepository('on');
      const mockViewerStores = createStores(PROJECT_ROOT, 'on', mockViewerRepo);
      const serviceWithMockViewer = new TaskService(PROJECT_ROOT, mockViewerStores.taskStore, 'on');
      // Mock getRobotPlan
      spyOn(mockViewerRepo, 'getRobotPlan').mockImplementation(() => ({
        summary: { total_tracks: 1, total_tasks: 1 },
        tracks: [{ track_id: 1, tasks: ['bd-task-1'] }],
      }));

      // Apply the same list spy to the new service
      const listSpy2 = spyOn(mockViewerRepo, 'listTaskBeadsForEpic').mockReturnValue({
        success: true,
        value: [{ id: 'bd-task-1', title: 'Pending Task', status: 'open' }],
      });

      const result = serviceWithMockViewer.getRunnableTasks(featureName);

      expect(result.source).toBe('beads');
      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].beadId).toBe('bd-task-1');

      listSpy.mockRestore();
      listSpy2.mockRestore();
    });
  });

  describe('transition() - state machine enforcement', () => {
    it('allows valid transition: pending -> in_progress', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { status: 'pending', beadId: 'bd-task-1' });

      const result = offModeService.transition(featureName, '01-test-task', 'in_progress');

      expect(result.status).toBe('in_progress');
      expect(result.startedAt).toBeDefined();
    });

    it('allows valid transition: in_progress -> done', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'in_progress',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const result = offModeService.transition(featureName, '01-test-task', 'done', {
        summary: 'All done',
      });

      expect(result.status).toBe('done');
      expect(result.completedAt).toBeDefined();
      expect(result.summary).toBe('All done');
    });

    it('allows valid transition: in_progress -> blocked', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'in_progress',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const result = offModeService.transition(featureName, '01-test-task', 'blocked', {
        summary: 'Waiting for input',
        blocker: { reason: 'Need decision' },
      });

      expect(result.status).toBe('blocked');
      expect(result.summary).toBe('Waiting for input');
      expect(result.blocker?.reason).toBe('Need decision');
    });

    it('allows valid transition: blocked -> in_progress (resume)', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'blocked',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const result = offModeService.transition(featureName, '01-test-task', 'in_progress');

      expect(result.status).toBe('in_progress');
    });

    it('rejects done -> in_progress in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'done',
        beadId: 'bd-task-1',
        completedAt: new Date().toISOString(),
      });

      // Default mode (strict=true) should throw
      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      expect(() => strictService.transition(featureName, '01-test-task', 'in_progress')).toThrow(
        InvalidTransitionError,
      );
    });

    it('allows done -> in_progress in non-strict mode (compat)', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'done',
        beadId: 'bd-task-1',
        completedAt: new Date().toISOString(),
      });

      const compatStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const compatService = new TaskService(PROJECT_ROOT, compatStores.taskStore, 'off', {
        strictTaskTransitions: false,
      });

      // Should NOT throw in compat mode - falls through to update()
      const result = compatService.transition(featureName, '01-test-task', 'in_progress');
      expect(result.status).toBe('in_progress');
    });

    it('stamps startedAt on transition to in_progress', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { status: 'pending', beadId: 'bd-task-1' });

      const before = new Date().toISOString();
      const result = offModeService.transition(featureName, '01-test-task', 'in_progress');
      const after = new Date().toISOString();

      expect(result.startedAt).toBeDefined();
      expect(result.startedAt! >= before).toBe(true);
      expect(result.startedAt! <= after).toBe(true);
    });

    it('stamps preparedAt on transition to dispatch_prepared', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { status: 'pending', beadId: 'bd-task-1' });

      const before = new Date().toISOString();
      const result = offModeService.transition(featureName, '01-test-task', 'dispatch_prepared');
      const after = new Date().toISOString();

      expect(result.preparedAt).toBeDefined();
      expect(result.preparedAt! >= before).toBe(true);
      expect(result.preparedAt! <= after).toBe(true);
    });

    it('preserves preparedAt and stamps startedAt when dispatch_prepared transitions to in_progress', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'dispatch_prepared',
        beadId: 'bd-task-1',
        preparedAt: '2026-01-01T00:00:00Z',
      });

      const before = new Date().toISOString();
      const result = offModeService.transition(featureName, '01-test-task', 'in_progress');
      const after = new Date().toISOString();

      expect(result.preparedAt).toBe('2026-01-01T00:00:00Z');
      expect(result.startedAt).toBeDefined();
      expect(result.startedAt! >= before).toBe(true);
      expect(result.startedAt! <= after).toBe(true);
    });

    it('stamps completedAt on transition to done', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'in_progress',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const before = new Date().toISOString();
      const result = offModeService.transition(featureName, '01-test-task', 'done', {
        summary: 'Complete',
      });
      const after = new Date().toISOString();

      expect(result.completedAt).toBeDefined();
      expect(result.completedAt! >= before).toBe(true);
      expect(result.completedAt! <= after).toBe(true);
    });

    it('throws for non-existent task', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);

      expect(() => offModeService.transition(featureName, 'nonexistent-task', 'in_progress')).toThrow(/not found/);
    });

    it('preserves existing fields through transition', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'pending',
        beadId: 'bd-task-1',
        planTitle: 'My Task',
        dependsOn: ['00-setup'],
      });

      const result = offModeService.transition(featureName, '01-test-task', 'in_progress');

      expect(result.planTitle).toBe('My Task');
      expect(result.dependsOn).toEqual(['00-setup']);
    });

    it('allows same-status transition as no-op', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'in_progress',
        beadId: 'bd-task-1',
        startedAt: '2026-01-01T00:00:00Z',
      });

      const result = offModeService.transition(featureName, '01-test-task', 'in_progress');

      // Should succeed and not re-stamp timestamps
      expect(result.status).toBe('in_progress');
      expect(result.startedAt).toBe('2026-01-01T00:00:00Z');
    });

    it('rejects pending -> done (skip states) in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { status: 'pending', beadId: 'bd-task-1' });

      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      expect(() => strictService.transition(featureName, '01-test-task', 'done')).toThrow(InvalidTransitionError);
    });

    it('rejects pending -> blocked in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', { status: 'pending', beadId: 'bd-task-1' });

      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      expect(() => strictService.transition(featureName, '01-test-task', 'blocked')).toThrow(InvalidTransitionError);
    });

    it('persists learnings through transition', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'in_progress',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const result = offModeService.transition(featureName, '01-test-task', 'done', {
        summary: 'All done',
        learnings: ['Pattern A works', 'Avoid approach B'],
      });

      expect(result.status).toBe('done');
      expect(result.learnings).toEqual(['Pattern A works', 'Avoid approach B']);
    });

    it('persists learnings through transition to blocked', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'in_progress',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const result = offModeService.transition(featureName, '01-test-task', 'blocked', {
        summary: 'Blocked on decision',
        blocker: { reason: 'Need clarification' },
        learnings: ['Discovered dependency X'],
      });

      expect(result.status).toBe('blocked');
      expect(result.learnings).toEqual(['Discovered dependency X']);
    });

    it('allows in_progress -> cancelled transition in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'in_progress',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      const result = strictService.transition(featureName, '01-test-task', 'cancelled');

      expect(result.status).toBe('cancelled');
    });

    it('allows in_progress -> partial transition in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'in_progress',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      const result = strictService.transition(featureName, '01-test-task', 'partial', {
        summary: 'Partial progress',
      });

      expect(result.status).toBe('partial');
    });

    it('allows in_progress -> failed transition in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'in_progress',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      const result = strictService.transition(featureName, '01-test-task', 'failed', {
        summary: 'Everything broke',
        learnings: ['Found root cause'],
      });

      expect(result.status).toBe('failed');
      expect(result.learnings).toEqual(['Found root cause']);
    });

    it('allows partial -> in_progress transition in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'partial',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      const result = strictService.transition(featureName, '01-test-task', 'in_progress');

      expect(result.status).toBe('in_progress');
    });

    it('allows failed -> pending transition in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'failed',
        beadId: 'bd-task-1',
        startedAt: new Date().toISOString(),
      });

      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      const result = strictService.transition(featureName, '01-test-task', 'pending');

      expect(result.status).toBe('pending');
    });

    it('allows cancelled -> pending transition in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'cancelled',
        beadId: 'bd-task-1',
      });

      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      const result = strictService.transition(featureName, '01-test-task', 'pending');

      expect(result.status).toBe('pending');
    });

    it('rejects done -> pending in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'done',
        beadId: 'bd-task-1',
        completedAt: new Date().toISOString(),
      });

      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      expect(() => strictService.transition(featureName, '01-test-task', 'pending')).toThrow(InvalidTransitionError);
    });

    it('allows done -> cancelled in strict mode', () => {
      const featureName = 'test-feature';
      setupFeature(featureName);
      setupTask(featureName, '01-test-task', {
        status: 'done',
        beadId: 'bd-task-1',
        completedAt: new Date().toISOString(),
      });

      const strictStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const strictService = new TaskService(PROJECT_ROOT, strictStores.taskStore, 'off', {
        strictTaskTransitions: true,
      });

      const result = strictService.transition(featureName, '01-test-task', 'cancelled');

      expect(result.status).toBe('cancelled');
    });
  });

  describe('sync() - secondary title matching prevents duplicates', () => {
    it('reconciles existing task by planTitle when folder mismatches (off-mode)', () => {
      const featureName = 'test-feature';
      const featurePath = path.join(TEST_DIR, 'docs', featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      // Plan expects tasks: "01-setup-environment" and "02-build-feature"
      const planContent = [
        '# Plan',
        '',
        '### 1. Setup Environment',
        '',
        '**Depends on**: none',
        '',
        'Setup task.',
        '',
        '### 2. Build Feature',
        '',
        '**Depends on**: 1',
        '',
        'Build task.',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);

      // Simulate existing tasks with DIFFERENT folders than what the plan derives,
      // as if task_state.folder was missing and list() used title-sort-based numbering.
      // Plan expects: 01-setup-environment, 02-build-feature
      // Existing has: 01-build-feature, 02-setup-environment (alphabetical title sort)
      const offStores = createStores(PROJECT_ROOT, 'off', createRepository('off'));
      const offService = new TaskService(PROJECT_ROOT, offStores.taskStore, 'off');

      // Create tasks on disk with mismatched folders but matching planTitles
      const task1Path = path.join(featurePath, 'tasks', '01-build-feature');
      const task2Path = path.join(featurePath, 'tasks', '02-setup-environment');
      fs.mkdirSync(task1Path, { recursive: true });
      fs.mkdirSync(task2Path, { recursive: true });

      fs.writeFileSync(
        path.join(task1Path, 'status.json'),
        JSON.stringify({
          status: 'pending',
          origin: 'plan',
          planTitle: 'Build Feature',
        }),
      );
      fs.writeFileSync(
        path.join(task2Path, 'status.json'),
        JSON.stringify({
          status: 'pending',
          origin: 'plan',
          planTitle: 'Setup Environment',
        }),
      );

      // previewSync: plan tasks don't match existing folders, but planTitles match.
      // Without secondary matching, this would create 2 new tasks + remove 2 existing = duplicates.
      // With secondary matching, the existing tasks are reconciled by title.
      const result = offService.previewSync(featureName);

      // Both existing tasks should be kept (reconciled by title), none created or removed
      expect(result.created.length).toBe(0);
      expect(result.removed.length).toBe(0);
      expect(result.kept.length).toBe(2);
    });
  });
  describe('sync() - bead reconciliation', () => {
    const setupApprovedOnModePlan = (featureName: string, planContent: string): void => {
      const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
      fs.mkdirSync(featurePath, { recursive: true });
      fs.writeFileSync(
        path.join(featurePath, 'feature.json'),
        JSON.stringify({
          name: featureName,
          epicBeadId: 'bd-epic-test',
          status: 'executing',
          createdAt: new Date().toISOString(),
        }),
      );
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);
    };

    const createReconcilingStore = () => {
      const existingTask = {
        folder: '02-setup-environment',
        name: 'setup-environment',
        beadId: 'task-1',
        status: 'pending',
        origin: 'plan',
        planTitle: 'Setup Environment',
        folderSource: 'derived' as const,
      };
      const currentStatus: TaskStatus = {
        status: 'pending',
        origin: 'plan',
        planTitle: 'Setup Environment',
        beadId: 'task-1',
      };
      const actions = {
        created: [] as string[],
        reconciled: [] as Array<{ currentFolder: string; nextFolder: string; status: TaskStatus }>,
      };

      const store = {
        list: () => [existingTask],
        getRawStatus: (_featureName: string, folder: string) => (folder === existingTask.folder ? currentStatus : null),
        createTask: (_featureName: string, folder: string) => {
          actions.created.push(folder);
          return { ...currentStatus, beadId: 'new-task' };
        },
        get: () => existingTask,
        getNextOrder: () => 2,
        save: () => {},
        patchBackground: () => currentStatus,
        delete: () => {},
        writeArtifact: () => 'task-1',
        readArtifact: () => null,
        writeReport: () => '/tmp/report.md',
        getRunnableTasks: () => null,
        flush: () => {},
        reconcilePlanTask: (_featureName: string, currentFolder: string, nextFolder: string, status: TaskStatus) => {
          actions.reconciled.push({ currentFolder, nextFolder, status });
        },
      };

      return { store, actions };
    };

    it('previewSync reports reconciliations instead of duplicate creation for bead-backed tasks', () => {
      const featureName = 'reconcile-preview';
      setupApprovedOnModePlan(
        featureName,
        ['# Plan', '', '### 1. Setup Environment', '', '**Depends on**: none', '', 'Prepare the environment.', ''].join(
          '\n',
        ),
      );

      const { store } = createReconcilingStore();
      const service = new TaskService(TEST_DIR, store as any, 'on');
      const result = service.previewSync(featureName);

      expect(result.created).toEqual([]);
      expect(result.removed).toEqual([]);
      expect(result.kept).toEqual([]);
      expect(result.reconciled).toEqual([
        {
          from: '02-setup-environment',
          to: '01-setup-environment',
          planTitle: 'Setup Environment',
          beadId: 'task-1',
        },
      ]);
    });

    it('sync reuses the existing bead and persists canonical plan metadata', () => {
      const featureName = 'reconcile-sync';
      setupApprovedOnModePlan(
        featureName,
        ['# Plan', '', '### 1. Setup Environment', '', '**Depends on**: none', '', 'Prepare the environment.', ''].join(
          '\n',
        ),
      );

      const { store, actions } = createReconcilingStore();
      const service = new TaskService(TEST_DIR, store as any, 'on');
      const result = service.sync(featureName);

      expect(actions.created).toEqual([]);
      expect(actions.reconciled).toHaveLength(1);
      expect(actions.reconciled[0]).toEqual({
        currentFolder: '02-setup-environment',
        nextFolder: '01-setup-environment',
        status: {
          status: 'pending',
          origin: 'plan',
          planTitle: 'Setup Environment',
          dependsOn: [],
          beadId: 'task-1',
          folder: '01-setup-environment',
        },
      });
      expect(result.created).toEqual([]);
      expect(result.reconciled).toEqual([
        {
          from: '02-setup-environment',
          to: '01-setup-environment',
          planTitle: 'Setup Environment',
          beadId: 'task-1',
        },
      ]);
    });
  });
});
