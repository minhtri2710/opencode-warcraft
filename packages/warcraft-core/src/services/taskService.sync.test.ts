import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import type { TaskStatus } from '../types.js';
import { BeadsRepository } from './beads/BeadsRepository.js';
import { createStores } from './state/index.js';
import { TaskService } from './taskService.js';

const TEST_DIR = `/tmp/warcraft-core-sync-test-${process.pid}`;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function createRepository(mode: 'on' | 'off' = 'off'): BeadsRepository {
  return new BeadsRepository(TEST_DIR, {}, mode);
}

function setupFeature(featureName: string): void {
  const featurePath = path.join(TEST_DIR, 'docs', featureName);
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
}

function setupTask(featureName: string, taskFolder: string, status: Partial<TaskStatus> = {}): void {
  const taskPath = path.join(TEST_DIR, 'docs', featureName, 'tasks', taskFolder);
  fs.mkdirSync(taskPath, { recursive: true });
  const taskStatus: TaskStatus = {
    status: 'pending',
    origin: 'plan',
    planTitle: 'Test Task',
    ...status,
  };
  fs.writeFileSync(path.join(taskPath, 'status.json'), JSON.stringify(taskStatus, null, 2));
}

describe('TaskService.sync() - rollback and fault tolerance', () => {
  let service: TaskService;

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const stores = createStores(TEST_DIR, 'off', createRepository('off'));
    service = new TaskService(TEST_DIR, stores.taskStore, 'off');
  });

  afterEach(() => {
    cleanup();
  });

  it('creates tasks successfully on clean sync', () => {
    const featureName = 'sync-test';
    setupFeature(featureName);

    const planPath = path.join(TEST_DIR, 'docs', featureName, 'plan.md');
    fs.writeFileSync(planPath, '# Plan\n\n### 1. Setup\n\nSetup the project.\n\n### 2. Build\n\nBuild it.\n');

    const result = service.sync(featureName);
    expect(result.created).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it('rolls back partially created tasks on flush failure', () => {
    const featureName = 'rollback-test';
    setupFeature(featureName);

    const planPath = path.join(TEST_DIR, 'docs', featureName, 'plan.md');
    fs.writeFileSync(
      planPath,
      '# Plan\n\n### 1. Setup\n\nSetup.\n\n### 2. Build\n\nBuild.\n\n### 3. Deploy\n\nDeploy.\n',
    );

    const stores = createStores(TEST_DIR, 'off', createRepository('off'));
    const flushSpy = spyOn(stores.taskStore, 'flush').mockImplementation(() => {
      throw new Error('Simulated flush failure');
    });

    const faultyService = new TaskService(TEST_DIR, stores.taskStore, 'off');

    expect(() => faultyService.sync(featureName)).toThrow(/Task sync failed/);
    expect(() => faultyService.sync(featureName)).toThrow(/Rolled back/);

    flushSpy.mockRestore();
  });

  it('error message includes partial creation count', () => {
    const featureName = 'partial-count-test';
    setupFeature(featureName);

    const planPath = path.join(TEST_DIR, 'docs', featureName, 'plan.md');
    fs.writeFileSync(planPath, '# Plan\n\n### 1. Task A\n\nDo A.\n\n### 2. Task B\n\nDo B.\n');

    const stores = createStores(TEST_DIR, 'off', createRepository('off'));
    // Spy on flush to throw after tasks are created
    spyOn(stores.taskStore, 'flush').mockImplementation(() => {
      throw new Error('Disk full');
    });

    const faultyService = new TaskService(TEST_DIR, stores.taskStore, 'off');

    try {
      faultyService.sync(featureName);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).toContain('creating 2 of 2 tasks');
      expect(msg).toContain('Rolled back 2');
      expect(msg).toContain('Disk full');
    }
  });

  it('sync dependency failure is non-fatal', () => {
    const featureName = 'dep-sync-test';
    setupFeature(featureName);

    const planPath = path.join(TEST_DIR, 'docs', featureName, 'plan.md');
    fs.writeFileSync(planPath, '# Plan\n\n### 1. Setup\n\nSetup.\n');

    const stores = createStores(TEST_DIR, 'off', createRepository('off'));
    // Filesystem store doesn't have syncDependencies, but let's add one that fails
    (stores.taskStore as any).syncDependencies = () => {
      throw new Error('Dependency sync explosion');
    };

    const svc = new TaskService(TEST_DIR, stores.taskStore, 'off');

    // Should not throw despite syncDependencies failing
    const result = svc.sync(featureName);
    expect(result.created).toHaveLength(1);

    // Should have captured the failure as a diagnostic
    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics!.length).toBeGreaterThan(0);
    expect(result.diagnostics![0].code).toBe('dep_sync_failed');
    expect(result.diagnostics![0].message).toContain('Dependency sync explosion');
  });
  it('reports accurate rollback counts when some rollback deletes fail', () => {
    const featureName = 'partial-rollback-test';
    setupFeature(featureName);

    const planPath = path.join(TEST_DIR, 'docs', featureName, 'plan.md');
    fs.writeFileSync(
      planPath,
      '# Plan\n\n### 1. Task A\n\nDo A.\n\n### 2. Task B\n\nDo B.\n\n### 3. Task C\n\nDo C.\n',
    );

    const stores = createStores(TEST_DIR, 'off', createRepository('off'));

    // Make flush throw so we enter the rollback path
    spyOn(stores.taskStore, 'flush').mockImplementation(() => {
      throw new Error('Simulated flush failure');
    });

    // Make delete fail for the second created folder during rollback
    const originalDelete = stores.taskStore.delete.bind(stores.taskStore);
    let deleteCallCount = 0;
    spyOn(stores.taskStore, 'delete').mockImplementation((feat: string, folder: string) => {
      // During task creation, createTask calls through to the store, not delete.
      // During rollback, delete is called for each createdFolder.
      deleteCallCount++;
      if (deleteCallCount === 2) {
        throw new Error('Permission denied');
      }
      return originalDelete(feat, folder);
    });

    const faultyService = new TaskService(TEST_DIR, stores.taskStore, 'off');

    try {
      faultyService.sync(featureName);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      const msg = (error as Error).message;
      // Should mention how many were created
      expect(msg).toContain('creating 3 of 3 tasks');
      // Should report accurate rollback counts: 2 succeeded, 1 failed
      expect(msg).toContain('Rolled back 2 of 3');
      expect(msg).toContain('1 rollback failure');
      expect(msg).toContain('Simulated flush failure');
    }
  });

  it('returns dependency diagnostics emitted by the task store', () => {
    const featureName = 'dep-diagnostics-test';
    setupFeature(featureName);

    const planPath = path.join(TEST_DIR, 'docs', featureName, 'plan.md');
    fs.writeFileSync(planPath, '# Plan\n\n### 1. Setup\n\nSetup.\n');

    const stores = createStores(TEST_DIR, 'off', createRepository('off'));
    (stores.taskStore as any).syncDependencies = () => [
      {
        code: 'dep_add_failed',
        message: 'Failed to add dependency task-1 -> task-2: add failed',
        severity: 'degraded',
        context: { beadId: 'task-1', dependsOnBeadId: 'task-2' },
      },
    ];

    const svc = new TaskService(TEST_DIR, stores.taskStore, 'off');
    const result = svc.sync(featureName);

    expect(result.diagnostics).toEqual([
      {
        code: 'dep_add_failed',
        message: 'Failed to add dependency task-1 -> task-2: add failed',
        severity: 'degraded',
        context: { beadId: 'task-1', dependsOnBeadId: 'task-2' },
      },
    ]);
  });
});

describe('TaskService.sync() - duplicate numbered task header validation', () => {
  let service: TaskService;

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const stores = createStores(TEST_DIR, 'off', createRepository('off'));
    service = new TaskService(TEST_DIR, stores.taskStore, 'off');
  });

  afterEach(() => {
    cleanup();
  });

  it('rejects plan with duplicate numbered task headers', () => {
    const featureName = 'dup-number-test';
    setupFeature(featureName);

    const planPath = path.join(TEST_DIR, 'docs', featureName, 'plan.md');
    fs.writeFileSync(
      planPath,
      '# Plan\n\n### 1. Setup\n\nSetup the project.\n\n### 2. API\n\nBuild API.\n\n### 2. Frontend\n\nBuild frontend.\n\n### 3. Deploy\n\nDeploy it.\n',
    );

    expect(() => service.sync(featureName)).toThrow(/[Dd]uplicate/);
    expect(() => service.sync(featureName)).toThrow(/2/);
  });

  it('error message mentions both colliding task names for duplicate numbers', () => {
    const featureName = 'dup-names-test';
    setupFeature(featureName);

    const planPath = path.join(TEST_DIR, 'docs', featureName, 'plan.md');
    fs.writeFileSync(
      planPath,
      '# Plan\n\n### 1. Init\n\nInit.\n\n### 2. Build API\n\nAPI.\n\n### 2. Build Frontend\n\nFrontend.\n',
    );

    try {
      service.sync(featureName);
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      const msg = (error as Error).message;
      expect(msg).toContain('2');
      expect(msg).toContain('Build API');
      expect(msg).toContain('Build Frontend');
    }
  });

  it('detects multiple duplicate number groups', () => {
    const featureName = 'multi-dup-test';
    setupFeature(featureName);

    const planPath = path.join(TEST_DIR, 'docs', featureName, 'plan.md');
    fs.writeFileSync(planPath, '# Plan\n\n### 1. A\n\nA.\n\n### 1. B\n\nB.\n\n### 2. C\n\nC.\n\n### 2. D\n\nD.\n');

    expect(() => service.sync(featureName)).toThrow(/[Dd]uplicate/);
  });

  it('allows plans with unique numbered task headers', () => {
    const featureName = 'unique-numbers-test';
    setupFeature(featureName);

    const planPath = path.join(TEST_DIR, 'docs', featureName, 'plan.md');
    fs.writeFileSync(
      planPath,
      '# Plan\n\n### 1. Setup\n\nSetup.\n\n### 2. Build\n\nBuild.\n\n### 3. Deploy\n\nDeploy.\n',
    );

    // Should not throw
    const result = service.sync(featureName);
    expect(result.created).toHaveLength(3);
  });
});

describe('Concurrent patchBackground interleaving', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('interleaved update and patchBackground preserve both fields', () => {
    const featureName = 'interleave-test';
    setupFeature(featureName);
    setupTask(featureName, '01-task', { status: 'in_progress', beadId: 'bd-123' });

    const stores = createStores(TEST_DIR, 'off', createRepository('off'));
    const service = new TaskService(TEST_DIR, stores.taskStore, 'off');

    // Simulate concurrent: background patch heartbeat, then status update
    service.patchBackgroundFields(featureName, '01-task', {
      workerSession: { sessionId: 'sess-1', lastHeartbeatAt: '2024-01-01T00:00:00Z' } as any,
    });

    // Status update (like marking done)
    service.update(featureName, '01-task', { status: 'done', summary: 'Completed' });

    const final = service.getRawStatus(featureName, '01-task');
    expect(final?.status).toBe('done');
    expect(final?.summary).toBe('Completed');
    // workerSession should be preserved from the patch
    expect(final?.workerSession?.sessionId).toBe('sess-1');
  });

  it('rapid interleaved patches maintain consistency', () => {
    const featureName = 'rapid-interleave';
    setupFeature(featureName);
    setupTask(featureName, '01-task', { status: 'in_progress' });

    const stores = createStores(TEST_DIR, 'off', createRepository('off'));
    const service = new TaskService(TEST_DIR, stores.taskStore, 'off');

    // Simulate rapid background heartbeats interleaved with idempotency key updates
    for (let i = 0; i < 20; i++) {
      if (i % 3 === 0) {
        service.patchBackgroundFields(featureName, '01-task', {
          idempotencyKey: `key-${i}`,
        });
      } else {
        service.patchBackgroundFields(featureName, '01-task', {
          workerSession: { sessionId: 'sess-1', messageCount: i } as any,
        });
      }
    }

    const final = service.getRawStatus(featureName, '01-task');
    expect(final).toBeTruthy();
    // Last idempotency key was at i=18 (18 % 3 === 0)
    expect(final?.idempotencyKey).toBe('key-18');
    // Last message count was at i=19 (19 % 3 !== 0)
    expect(final?.workerSession?.messageCount).toBe(19);
  });
});
