import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { BeadsRepository } from './beads/BeadsRepository.js';
import { FeatureService } from './featureService';
import { PlanService } from './planService.js';
import { createStores } from './state/index.js';
import { TaskService } from './taskService.js';


let testRoot = '';

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-feature-service-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

/**
 * Create a mock BeadsRepository for testing.
 * Allows overriding specific methods while providing default implementations.
 */
function createMockRepository(overrides: Partial<BeadsRepository> = {}): BeadsRepository {
  const defaultRepo: BeadsRepository = {
    createEpic: () => ({ success: true, value: 'bd-epic-1' }),
    closeBead: () => ({ success: true, value: undefined }),
    getGateway: () => ({
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
      readArtifact: () => null,
      upsertArtifact: () => {},
      readDescription: () => null,
      updateDescription: () => {},
      addComment: () => {},
      addLabel: () => {},
      list: () => [{ id: 'bd-epic-1', title: 'test-feature', status: 'open', type: 'epic' }],
      show: () => ({ id: 'bd-epic-1', title: 'test-feature', status: 'open', created_at: '2024-01-01T00:00:00Z' }),
    } as any),
    getViewerGateway: () => ({
      getRobotPlan: () => ({ success: false, error: new Error('Not implemented') }),
    } as any),
    getEpicByFeatureName: () => ({ success: true, value: 'bd-epic-1' }),
    getFeatureState: () => ({ success: true, value: null }),
    setFeatureState: () => ({ success: true, value: undefined }),
    getTaskState: () => ({ success: true, value: null }),
    setTaskState: () => ({ success: true, value: undefined }),
    getPlanDescription: () => null,
    setPlanDescription: () => ({ success: true, value: undefined }),
    getPlanApproval: () => null,
    setPlanApproval: () => ({ success: true, value: undefined }),
    getApprovedPlan: () => null,
    setApprovedPlan: () => ({ success: true, value: undefined }),
    getPlanComments: () => [],
    setPlanComments: () => ({ success: true, value: undefined }),
    appendPlanComment: () => ({ success: true, value: undefined }),
    upsertTaskArtifact: () => ({ success: true, value: undefined }),
    readTaskArtifact: () => ({ success: true, value: null }),
    listTaskBeadsForEpic: () => [],
    addWorkflowLabel: () => ({ success: true, value: undefined }),
    getRobotPlan: () => ({ success: false, error: new Error('Not implemented') }),
    getViewerHealth: () => ({ success: false, error: new Error('Not implemented') }),
    importArtifacts: () => ({ success: true, value: undefined }),
    flushArtifacts: () => ({ success: true, value: undefined }),
  };

  return { ...defaultRepo, ...overrides };
}

describe('FeatureService flat layout', () => {
  it('creates features at canonical flat path', () => {
  const mockRepository = createMockRepository({
    createEpic: () => 'bd-epic-1',
  });

    // Use offMode to test filesystem-only behavior
    const stores = createStores(testRoot, 'off', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');
    const feature = service.create('my-feature');

    // Feature should be created at docs/<feature> (flat)
    const featurePath = path.join(testRoot, 'docs', 'my-feature');
    expect(fs.existsSync(featurePath)).toBe(true);
    expect(fs.existsSync(path.join(featurePath, 'feature.json'))).toBe(true);

    // Should NOT be in the old nested path
    const oldPath = path.join(testRoot, 'docs', 'features', 'my-feature');
    expect(fs.existsSync(oldPath)).toBe(false);

    expect(feature.name).toBe('my-feature');
  });

  it('lists features from canonical flat path excluding .worktrees', () => {
  const mockRepository = createMockRepository({
    createEpic: (name) => `bd-${name}`,
  });

    // Use offMode to test filesystem-only behavior
    const stores = createStores(testRoot, 'off', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');
    service.create('feature-a');
    service.create('feature-b');

    // Create a .worktrees directory (should be excluded)
    const worktreesPath = path.join(testRoot, 'docs', '.worktrees');
    fs.mkdirSync(worktreesPath, { recursive: true });
    fs.mkdirSync(path.join(worktreesPath, 'some-worktree'), { recursive: true });

    const list = service.list();
    expect(list).toContain('feature-a');
    expect(list).toContain('feature-b');
    expect(list).not.toContain('.worktrees');
    expect(list).not.toContain('some-worktree');
  });

  it('does not resolve features from legacy nested path', () => {
  const mockRepository = createMockRepository({
    createEpic: () => 'bd-epic-1',
  });

    const legacyPath = path.join(testRoot, 'docs', 'features', 'legacy-feature');
    fs.mkdirSync(legacyPath, { recursive: true });
    fs.writeFileSync(
      path.join(legacyPath, 'feature.json'),
      JSON.stringify({ name: 'legacy-feature', epicBeadId: 'bd-1', status: 'planning', createdAt: new Date().toISOString() })
    );

    const stores = createStores(testRoot, 'off', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');

    expect(service.get('legacy-feature')).toBeNull();
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  it('does not list legacy nested features directory entries', () => {
  const mockRepository = createMockRepository({
    createEpic: () => 'bd-epic-1',
  });

    // Create features at legacy locations
    const legacyPath1 = path.join(testRoot, 'docs', 'features', 'feature-1');
    fs.mkdirSync(legacyPath1, { recursive: true });
    fs.writeFileSync(
      path.join(legacyPath1, 'feature.json'),
      JSON.stringify({ name: 'feature-1', epicBeadId: 'bd-1', status: 'planning', createdAt: new Date().toISOString() })
    );

    // Use offMode to test filesystem-only behavior
    const stores = createStores(testRoot, 'off', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');

    // Listing now scans canonical flat artifacts only.
    const list = service.list();
    expect(list).not.toContain('feature-1');
  });
});

describe('FeatureService.create', () => {
  it('does not create feature directory when epic creation fails', () => {
    const failingRepository = createMockRepository({
      createEpic: () => ({ success: false, error: new Error('epic create failed') }),
    });

    // Use onMode to test that bead creation failure prevents filesystem creation
    const stores = createStores(testRoot, 'on', failingRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'on');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'on');

    expect(() => service.create('my-feature')).toThrow('epic create failed');

    const featurePath = path.join(testRoot, '.beads', 'artifacts', 'my-feature');
    expect(fs.existsSync(featurePath)).toBe(false);
  });

  it('rolls back partial filesystem state when initialization fails after epic creation', () => {
  const mockRepository = createMockRepository({
    createEpic: () => 'bd-epic-1',
  });

    const originalMkdirSync = fs.mkdirSync;
    const mkdirSpy = spyOn(fs, 'mkdirSync').mockImplementation(((target: fs.PathLike, options?: fs.MakeDirectoryOptions | null | undefined): string | void => {
      const targetPath = String(target);
      if (targetPath.endsWith(`${path.sep}context`)) {
        throw new Error('simulated mkdir failure');
      }
      return originalMkdirSync(target, options as fs.MakeDirectoryOptions) as string | void;
    }) as typeof fs.mkdirSync);

    try {
      const stores = createStores(testRoot, 'on', mockRepository);
      const planService = new PlanService(testRoot, stores.planStore);
      const service = new FeatureService(testRoot, stores.featureStore, planService);
      expect(() => service.create('my-feature')).toThrow(/Failed to initialize feature/);
    } finally {
      mkdirSpy.mockRestore();
    }

    const featurePath = path.join(testRoot, '.beads', 'artifacts', 'my-feature');
    expect(fs.existsSync(featurePath)).toBe(false);
  });

  it('allows only one winner for concurrent create attempts in beadsMode off', async () => {
    const mockRepository = createMockRepository({
      createEpic: () => 'bd-epic-1',
    });

    const stores = createStores(testRoot, 'off', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');

    const results = await Promise.allSettled([
      Promise.resolve().then(() => service.create('race-feature')),
      Promise.resolve().then(() => service.create('race-feature')),
    ]);

    const fulfilled = results.filter((result): result is PromiseFulfilledResult<unknown> => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain("Feature 'race-feature' already exists");
  });

  it('allows only one winner for concurrent create attempts in beadsMode on', async () => {
    const createEpicCalls: Array<{ name: string; priority: number }> = [];
    const mockRepository = createMockRepository({
      createEpic: (name: string, priority: number) => {
        createEpicCalls.push({ name, priority });
        return { success: true, value: `bd-${name}` };
      },
    });

    const stores = createStores(testRoot, 'on', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'on');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'on');

    const results = await Promise.allSettled([
      Promise.resolve().then(() => service.create('race-feature')),
      Promise.resolve().then(() => service.create('race-feature')),
    ]);

    const fulfilled = results.filter((result): result is PromiseFulfilledResult<unknown> => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain("Feature 'race-feature' already exists");
    expect(createEpicCalls).toHaveLength(1);
  });
});

describe('FeatureService.complete', () => {
  it('closes epic bead on completion when beadsMode is on', () => {
    // Track repository method calls
    const closeCalls: Array<string> = [];
    const mockRepository = createMockRepository({
      createEpic: (name: string, priority: number) => ({ success: true, value: 'bd-epic-1' }),
      closeBead: (beadId: string) => {
        closeCalls.push(beadId);
        return { success: true, value: undefined };
      },
    });

    const stores = createStores(testRoot, 'on', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'on');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'on');
    const feature = service.create('my-feature');
    const completed = service.complete('my-feature');

    expect(completed.status).toBe('completed');
    expect(closeCalls).toContain(feature.epicBeadId);
  });

  it('does not close epic bead when beadsMode is off', () => {
    const closeCalls: Array<string> = [];
    const mockRepository = createMockRepository({
      createEpic: () => 'bd-epic-1',
      closeBead: (beadId: string) => {
        closeCalls.push(beadId);
        return { success: true, value: undefined };
      },
    });

    const stores = createStores(testRoot, 'off', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');
    const feature = service.create('my-feature');
    service.complete('my-feature');

    expect(closeCalls).toHaveLength(0);
  });
});

describe('FeatureService beadsMode off', () => {
  it('creates features without calling repository.createEpic when beadsMode is off', () => {
    const createEpicCalls: Array<{ name: string; priority: number }> = [];
    const mockRepository = createMockRepository({
      createEpic: (name: string, priority: number) => {
        createEpicCalls.push({ name, priority });
        return { success: true, value: 'bd-epic-1' };
      },
    });

    const stores = createStores(testRoot, 'off', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');
    const feature = service.create('my-feature');

    // Should not call createEpic when beadsMode is off
    expect(createEpicCalls).toHaveLength(0);
    expect(feature.name).toBe('my-feature');
    expect(feature.epicBeadId.startsWith('local-')).toBe(true);

    // Feature should be created at flat path
    const featurePath = path.join(testRoot, 'docs', 'my-feature');
    expect(fs.existsSync(featurePath)).toBe(true);
    expect(fs.existsSync(path.join(featurePath, 'feature.json'))).toBe(true);
    expect(fs.existsSync(path.join(featurePath, 'tasks'))).toBe(true);
  });

  it('gets features from filesystem when beadsMode is off', () => {
  const mockRepository = createMockRepository({
    createEpic: () => 'bd-epic-1',
  });

    // Setup spy BEFORE creating service to catch all calls
    const execSpy = spyOn(childProcess, 'execFileSync');

    const stores = createStores(testRoot, 'off', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');
    service.create('my-feature');

    // Reset spy after setup to only count get() calls
    execSpy.mockClear();

    const feature = service.get('my-feature');
    expect(feature).not.toBeNull();
    expect(feature?.name).toBe('my-feature');

    // BeadGateway should not be called in off mode
    expect(execSpy).not.toHaveBeenCalled();
    execSpy.mockRestore();
  });

  it('lists features from filesystem when beadsMode is off', () => {
  const mockRepository = createMockRepository({
    createEpic: () => 'bd-epic-1',
  });

    // Setup spy BEFORE creating service to catch all calls
    const execSpy = spyOn(childProcess, 'execFileSync');

    const stores = createStores(testRoot, 'off', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');
    service.create('feature-a');
    service.create('feature-b');

    // Reset spy after setup to only count list() calls
    execSpy.mockClear();

    const list = service.list();
    expect(list).toContain('feature-a');
    expect(list).toContain('feature-b');

    // BeadGateway should not be called in off mode
    expect(execSpy).not.toHaveBeenCalled();
    execSpy.mockRestore();
  });
});

describe('FeatureService beadsMode on', () => {
  it('calls repository.createEpic when beadsMode is on', () => {
    const createEpicCalls: Array<{ name: string; priority: number }> = [];
    const mockRepository = createMockRepository({
      createEpic: (name: string, priority: number) => {
        createEpicCalls.push({ name, priority });
        return { success: true, value: 'bd-epic-1' };
      },
    });

    const stores = createStores(testRoot, 'on', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'on');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'on');
    const feature = service.create('my-feature');

    expect(createEpicCalls).toHaveLength(1);
    expect(createEpicCalls[0].name).toBe('my-feature');
    expect(createEpicCalls[0].priority).toBe(3);
    expect(feature.epicBeadId).toBe('bd-epic-1');
    expect(fs.existsSync(path.join(testRoot, '.beads', 'artifacts', 'my-feature', 'tasks'))).toBe(false);
  });

  it('uses BeadGateway for get when beadsMode is on', () => {
    const mockRepository = createMockRepository({
      createEpic: (name: string, priority: number) => ({ success: true, value: 'bd-epic-1' }),
      getGateway: () => ({
        createEpic: () => 'bd-epic-1',
        closeBead: () => {},
        flushArtifacts: () => {},
        readArtifact: () => null,
        upsertArtifact: () => {},
        readDescription: () => null,
        updateDescription: () => {},
        addComment: () => {},
        addLabel: () => {},
        list: () => [],
        show: () => ({ id: 'bd-epic-1', title: 'my-feature', status: 'open', created_at: '2024-01-01T00:00:00Z' }),
      } as any),
    });

    const stores = createStores(testRoot, 'on', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'on');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'on');

    // Create the feature
    service.create('my-feature');

    // Get the feature - this uses BeadGateway.show via getViaBeads
    const feature = service.get('my-feature');
    expect(feature).not.toBeNull();
    expect(feature?.name).toBe('my-feature');
    expect(feature?.epicBeadId).toBe('bd-epic-1');
  });

  it('maps in-progress epic bead status to executing when feature_state artifact is absent', () => {
    const mockRepository = createMockRepository({
      createEpic: (name: string, priority: number) => ({ success: true, value: 'bd-epic-1' }),
      getGateway: () => ({
        createEpic: () => 'bd-epic-1',
        closeBead: () => {},
        flushArtifacts: () => {},
        readArtifact: () => null,
        upsertArtifact: () => {},
        readDescription: () => null,
        updateDescription: () => {},
        addComment: () => {},
        addLabel: () => {},
        list: () => [],
        show: () => ({ id: 'bd-epic-1', title: 'my-feature', status: 'in_progress', created_at: '2024-01-01T00:00:00Z' }),
      } as any),
      getFeatureState: () => ({ success: true, value: null }),
    });

    const stores = createStores(testRoot, 'on', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'on');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'on');
    service.create('my-feature');

    const feature = service.get('my-feature');
    expect(feature).not.toBeNull();
    expect(feature?.status).toBe('executing');
  });

  it('uses BeadGateway for list when beadsMode is on', () => {
    const mockRepository = createMockRepository({
      createEpic: (name: string, priority: number) => ({ success: true, value: 'bd-epic-1' }),
      getGateway: () => ({
        createEpic: () => 'bd-epic-1',
        closeBead: () => {},
        flushArtifacts: () => {},
        readArtifact: () => null,
        upsertArtifact: () => {},
        readDescription: () => null,
        updateDescription: () => {},
        addComment: () => {},
        addLabel: () => {},
        list: () => [
          { id: 'bd-epic-1', title: 'feature-a', status: 'open', type: 'epic' },
          { id: 'bd-epic-2', title: 'feature-b', status: 'open', type: 'epic' },
        ],
        show: () => ({}),
      } as any),
    });

    const stores = createStores(testRoot, 'on', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'on');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'on');

    // List features (uses BeadGateway directly)
    const list = service.list();
    expect(list).toContain('feature-a');
    expect(list).toContain('feature-b');
  });

  it('returns null when feature not found via BeadGateway', () => {
    const mockRepository = createMockRepository({
      createEpic: (name: string, priority: number) => ({ success: true, value: 'bd-epic-1' }),
      getEpicByFeatureName: (name: string) => {
        // Return failure for non-existent feature
        if (name === 'non-existent') {
          return { success: false, error: new Error('Feature not found') };
        }
        return { success: true, value: 'bd-epic-1' };
      },
    });

    const stores = createStores(testRoot, 'on', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'on');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'on');

    const feature = service.get('non-existent');
    expect(feature).toBeNull();
  });
});

describe('FeatureService getTasks folder stability', () => {
  it('persists generated folder name so reordering does not change it', () => {
    const mockRepository = createMockRepository({
      getGateway: () => ({
        createEpic: () => 'bd-epic-1',
        closeBead: () => {},
        flushArtifacts: () => {},
        readArtifact: () => null,
        upsertArtifact: () => {},
        readDescription: () => null,
        updateDescription: () => {},
        addComment: () => {},
        addLabel: () => {},
        list: (opts?: any) => {
          if (opts?.type === 'task') {
            return [
              { id: 'bd-task-1', title: 'Setup', status: 'open', type: 'task' },
              { id: 'bd-task-2', title: 'API', status: 'open', type: 'task' },
              { id: 'bd-task-3', title: 'Frontend', status: 'open', type: 'task' },
            ];
          }
          return [];
        },
        show: () => ({ id: 'bd-epic-1', title: 'my-feature', status: 'open', created_at: '2024-01-01T00:00:00Z' }),
      } as any),
      createEpic: (_name, _priority) => ({ success: true, value: 'bd-epic-1' }),
      // getEpicByFeatureName: (_name, _useCache) => ({ success: true, value: 'bd-epic-1' }),
      listTaskBeadsForEpic: () => ({ success: true, value: [
        { id: 'bd-task-1', title: 'Setup', status: 'open' },
        { id: 'bd-task-2', title: 'API', status: 'open' },
        { id: 'bd-task-3', title: 'Frontend', status: 'open' },
      ] }),
    });

    const stores = createStores(testRoot, 'on', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'on');
    const taskService = new TaskService(testRoot, stores.taskStore, 'on');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'on', taskService);
    service.create('my-feature');

    // First call to getTasks generates and persists folders
    const tasks1 = taskService.list('my-feature');
    expect(tasks1).toHaveLength(3);
    expect(tasks1[0].folder).toBe('01-api');
    expect(tasks1[1].folder).toBe('02-frontend');
    expect(tasks1[2].folder).toBe('03-setup');
  });

  it('derives same folders regardless of gateway return order', () => {
    // Gateway returns tasks in REVERSE alphabetical order
    const mockRepository = createMockRepository({
      getGateway: () => ({
        createEpic: () => 'bd-epic-1',
        closeBead: () => {},
        flushArtifacts: () => {},
        readArtifact: () => null,
        upsertArtifact: () => {},
        readDescription: () => null,
        updateDescription: () => {},
        addComment: () => {},
        addLabel: () => {},
        list: (opts?: any) => {
          if (opts?.type === 'task') {
            // Deliberately reversed order compared to existing test
            return [
              { id: 'bd-task-3', title: 'Frontend', status: 'open', type: 'task' },
              { id: 'bd-task-2', title: 'API', status: 'open', type: 'task' },
              { id: 'bd-task-1', title: 'Setup', status: 'open', type: 'task' },
            ];
          }
          return [];
        },
        show: () => ({ id: 'bd-epic-1', title: 'my-feature', status: 'open', created_at: '2024-01-01T00:00:00Z' }),
      } as any),
      createEpic: (_name: string, _priority: number) => ({ success: true, value: 'bd-epic-1' }),
      listTaskBeadsForEpic: () => ({ success: true, value: [
        { id: 'bd-task-3', title: 'Frontend', status: 'open' },
        { id: 'bd-task-2', title: 'API', status: 'open' },
        { id: 'bd-task-1', title: 'Setup', status: 'open' },
      ] }),
    });

    const stores = createStores(testRoot, 'on', mockRepository);
    const planService = new PlanService(testRoot, stores.planStore, 'on');
    const taskService = new TaskService(testRoot, stores.taskStore, 'on');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'on', taskService);
    service.create('my-feature');

    const tasks = taskService.list('my-feature');
    expect(tasks).toHaveLength(3);
    // After sorting by title: API, Frontend, Setup
    expect(tasks[0].folder).toBe('01-api');
    expect(tasks[1].folder).toBe('02-frontend');
    expect(tasks[2].folder).toBe('03-setup');
  });
});

describe('FeatureService.patchMetadata', () => {
  it('ignores immutable fields and warns when callers attempt to overwrite them', () => {
    const stores = createStores(testRoot, 'off', createMockRepository());
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');
    const created = service.create('immutable-fields');

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const updated = service.patchMetadata('immutable-fields', {
        name: 'renamed-feature',
        epicBeadId: 'bd-other',
        createdAt: '2000-01-01T00:00:00.000Z',
        ticket: 'NEW-TICKET',
      });

      expect(updated.name).toBe(created.name);
      expect(updated.epicBeadId).toBe(created.epicBeadId);
      expect(updated.createdAt).toBe(created.createdAt);
      expect(updated.ticket).toBe('NEW-TICKET');
      expect(warnSpy).toHaveBeenCalledWith(
        '[warcraft] Ignoring immutable feature metadata fields: name, epicBeadId, createdAt',
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('updates mutable metadata fields without warning', () => {
    const stores = createStores(testRoot, 'off', createMockRepository());
    const planService = new PlanService(testRoot, stores.planStore, 'off');
    const service = new FeatureService(testRoot, stores.featureStore, planService, 'off');
    service.create('mutable-fields');

    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const updated = service.patchMetadata('mutable-fields', {
        status: 'approved',
        ticket: 'ABC-123',
      });

      expect(updated.status).toBe('approved');
      expect(updated.ticket).toBe('ABC-123');
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
