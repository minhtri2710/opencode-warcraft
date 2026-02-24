import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import type { BeadClient } from './featureService';
import { FeatureService } from './featureService';

const onMode = { getBeadsMode: () => 'on' as const };
const offMode = { getBeadsMode: () => 'off' as const };

let testRoot = '';

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-feature-service-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

describe('FeatureService flat layout', () => {
  it('creates features at canonical flat path', () => {
    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    // Use offMode to test filesystem-only behavior
    const service = new FeatureService(testRoot, beadClient, offMode);
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
    const beadClient: BeadClient = {
      createEpic: (name) => `bd-${name}`,
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    // Use offMode to test filesystem-only behavior
    const service = new FeatureService(testRoot, beadClient, offMode);
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
    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    const legacyPath = path.join(testRoot, 'docs', 'features', 'legacy-feature');
    fs.mkdirSync(legacyPath, { recursive: true });
    fs.writeFileSync(
      path.join(legacyPath, 'feature.json'),
      JSON.stringify({ name: 'legacy-feature', epicBeadId: 'bd-1', status: 'planning', createdAt: new Date().toISOString() })
    );

    const service = new FeatureService(testRoot, beadClient, offMode);

    expect(service.get('legacy-feature')).toBeNull();
    expect(fs.existsSync(legacyPath)).toBe(true);
  });

  it('does not list legacy nested features directory entries', () => {
    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    // Create features at legacy locations
    const legacyPath1 = path.join(testRoot, 'docs', 'features', 'feature-1');
    fs.mkdirSync(legacyPath1, { recursive: true });
    fs.writeFileSync(
      path.join(legacyPath1, 'feature.json'),
      JSON.stringify({ name: 'feature-1', epicBeadId: 'bd-1', status: 'planning', createdAt: new Date().toISOString() })
    );

    // Use offMode to test filesystem-only behavior
    const service = new FeatureService(testRoot, beadClient, offMode);

    // Listing now scans canonical flat artifacts only.
    const list = service.list();
    expect(list).not.toContain('feature-1');
  });
});

describe('FeatureService.create', () => {
  it('does not create feature directory when epic creation fails', () => {
    const failingBeadClient: BeadClient = {
      createEpic: () => {
        throw new Error('epic create failed');
      },
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    // Use onMode to test that bead creation failure prevents filesystem creation
    const service = new FeatureService(testRoot, failingBeadClient, onMode);

    expect(() => service.create('my-feature')).toThrow('epic create failed');

    const featurePath = path.join(testRoot, '.beads', 'artifacts', 'my-feature');
    expect(fs.existsSync(featurePath)).toBe(false);
  });

  it('rolls back partial filesystem state when initialization fails after epic creation', () => {
    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    const originalMkdirSync = fs.mkdirSync;
    const mkdirSpy = spyOn(fs, 'mkdirSync').mockImplementation(((target: fs.PathLike, options?: fs.MakeDirectoryOptions | null | undefined): string | void => {
      const targetPath = String(target);
      if (targetPath.endsWith(`${path.sep}context`)) {
        throw new Error('simulated mkdir failure');
      }
      return originalMkdirSync(target, options as fs.MakeDirectoryOptions) as string | void;
    }) as typeof fs.mkdirSync);

    try {
      const service = new FeatureService(testRoot, beadClient);
      expect(() => service.create('my-feature')).toThrow(/Failed to initialize feature/);
    } finally {
      mkdirSpy.mockRestore();
    }

    const featurePath = path.join(testRoot, '.beads', 'artifacts', 'my-feature');
    expect(fs.existsSync(featurePath)).toBe(false);
  });
});

describe('FeatureService.complete', () => {
  it('closes epic bead and flushes artifacts on completion when beadsMode is on', () => {
    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };
    const closeSpy = spyOn(beadClient, 'closeBead');
    const flushSpy = spyOn(beadClient, 'flushArtifacts');

    // Mock BeadGateway for get() call - use mockImplementation to handle multiple calls
    let callCount = 0;
    const execSpy = spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args?: string[], options?: unknown): string => {
      callCount++;
      const argStr = args?.join(' ') || '';

      if (argStr.includes('--version')) {
        return 'beads_rust 1.2.3';
      }
      if (argStr.includes('list')) {
        return JSON.stringify([{ id: 'bd-epic-1', title: 'my-feature', status: 'open', type: 'epic' }]);
      }
      if (argStr.includes('show')) {
        return JSON.stringify({
          id: 'bd-epic-1',
          title: 'my-feature',
          status: 'open',
          created_at: '2024-01-01T00:00:00Z'
        });
      }
      return '';
    }) as typeof childProcess.execFileSync);

    const service = new FeatureService(testRoot, beadClient, onMode);
    const feature = service.create('my-feature');
    const completed = service.complete('my-feature');

    expect(completed.status).toBe('completed');
    expect(closeSpy).toHaveBeenCalledWith(feature.epicBeadId, testRoot);
    expect(flushSpy).toHaveBeenCalledWith(testRoot);

    execSpy.mockRestore();
  });

  it('does not close epic bead when beadsMode is off', () => {
    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };
    const closeSpy = spyOn(beadClient, 'closeBead');
    const flushSpy = spyOn(beadClient, 'flushArtifacts');

    const service = new FeatureService(testRoot, beadClient, offMode);
    service.create('my-feature');
    const completed = service.complete('my-feature');

    expect(completed.status).toBe('completed');
    expect(closeSpy).not.toHaveBeenCalled();
    expect(flushSpy).not.toHaveBeenCalled();
  });
});

describe('FeatureService beadsMode off', () => {
  it('creates features without calling beadClient.createEpic when beadsMode is off', () => {
    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };
    const createEpicSpy = spyOn(beadClient, 'createEpic');

    const service = new FeatureService(testRoot, beadClient, offMode);
    const feature = service.create('my-feature');

    // Should not call createEpic when beadsMode is off
    expect(createEpicSpy).not.toHaveBeenCalled();
    expect(feature.name).toBe('my-feature');
    expect(feature.epicBeadId.startsWith('local-')).toBe(true);

    // Feature should be created at flat path
    const featurePath = path.join(testRoot, 'docs', 'my-feature');
    expect(fs.existsSync(featurePath)).toBe(true);
    expect(fs.existsSync(path.join(featurePath, 'feature.json'))).toBe(true);
    expect(fs.existsSync(path.join(featurePath, 'tasks'))).toBe(true);
  });

  it('gets features from filesystem when beadsMode is off', () => {
    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    // Setup spy BEFORE creating service to catch all calls
    const execSpy = spyOn(childProcess, 'execFileSync');

    const service = new FeatureService(testRoot, beadClient, offMode);
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
    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    // Setup spy BEFORE creating service to catch all calls
    const execSpy = spyOn(childProcess, 'execFileSync');

    const service = new FeatureService(testRoot, beadClient, offMode);
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
  it('calls beadClient.createEpic when beadsMode is on', () => {
    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };
    const createEpicSpy = spyOn(beadClient, 'createEpic');

    const service = new FeatureService(testRoot, beadClient, onMode);
    const feature = service.create('my-feature');

    expect(createEpicSpy).toHaveBeenCalledWith('my-feature', testRoot, 3);
    expect(feature.epicBeadId).toBe('bd-epic-1');
    expect(fs.existsSync(path.join(testRoot, '.beads', 'artifacts', 'my-feature', 'tasks'))).toBe(false);
  });

  it('uses BeadGateway for get when beadsMode is on', () => {
    // Mock execFileSync to return proper responses for BeadGateway
    let callCount = 0;
    const execSpy = spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args?: string[], options?: unknown): string => {
      callCount++;
      const argStr = args?.join(' ') || '';

      if (argStr.includes('--version')) {
        return 'beads_rust 1.2.3';
      }
      if (argStr.includes('create') && argStr.includes('epic')) {
        return '{"id":"bd-epic-1"}';
      }
      if (argStr.includes('list')) {
        return JSON.stringify([{ id: 'bd-epic-1', title: 'my-feature', status: 'open', type: 'epic' }]);
      }
      if (argStr.includes('show')) {
        return JSON.stringify({
          id: 'bd-epic-1',
          title: 'my-feature',
          status: 'open',
          created_at: '2024-01-01T00:00:00Z'
        });
      }
      return '';
    }) as typeof childProcess.execFileSync);

    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    const service = new FeatureService(testRoot, beadClient, onMode);

    // Create the feature
    service.create('my-feature');

    // Get the feature - this uses BeadGateway.show via getViaBeads
    const feature = service.get('my-feature');
    expect(feature).not.toBeNull();
    expect(feature?.name).toBe('my-feature');
    expect(feature?.epicBeadId).toBe('bd-epic-1');

    execSpy.mockRestore();
  });

  it('maps in-progress epic bead status to executing when feature_state artifact is absent', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args?: string[], options?: unknown): string => {
      const argStr = args?.join(' ') || '';

      if (argStr.includes('--version')) {
        return 'beads_rust 1.2.3';
      }
      if (argStr.includes('list')) {
        return JSON.stringify([{ id: 'bd-epic-1', title: 'my-feature', status: 'in_progress', type: 'epic' }]);
      }
      if (argStr.includes('show')) {
        return JSON.stringify({
          id: 'bd-epic-1',
          title: 'my-feature',
          status: 'in_progress',
          created_at: '2024-01-01T00:00:00Z',
        });
      }
      return '';
    }) as typeof childProcess.execFileSync);

    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    const service = new FeatureService(testRoot, beadClient, onMode);
    service.create('my-feature');

    const feature = service.get('my-feature');
    expect(feature).not.toBeNull();
    expect(feature?.status).toBe('executing');

    execSpy.mockRestore();
  });

  it('uses BeadGateway for list when beadsMode is on', () => {
    // Mock execFileSync to return proper responses for BeadGateway
    const execSpy = spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args?: string[], options?: unknown): string => {
      const argStr = args?.join(' ') || '';

      if (argStr.includes('--version')) {
        return 'beads_rust 1.2.3';
      }
      if (argStr.includes('list')) {
        return JSON.stringify([
          { id: 'bd-epic-1', title: 'feature-a', status: 'open', type: 'epic' },
          { id: 'bd-epic-2', title: 'feature-b', status: 'open', type: 'epic' }
        ]);
      }
      return '';
    }) as typeof childProcess.execFileSync);

    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    const service = new FeatureService(testRoot, beadClient, onMode);

    // List features (uses BeadGateway directly)
    const list = service.list();
    expect(list).toContain('feature-a');
    expect(list).toContain('feature-b');

    execSpy.mockRestore();
  });

  it('returns null when feature not found via BeadGateway', () => {
    // Mock execFileSync to return empty list
    const execSpy = spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args?: string[], options?: unknown): string => {
      const argStr = args?.join(' ') || '';

      if (argStr.includes('--version')) {
        return 'beads_rust 1.2.3';
      }
      if (argStr.includes('list')) {
        return JSON.stringify([]);  // No epics found
      }
      return '';
    }) as typeof childProcess.execFileSync);

    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
    };

    const service = new FeatureService(testRoot, beadClient, onMode);

    const feature = service.get('non-existent');
    expect(feature).toBeNull();

    execSpy.mockRestore();
  });
});

describe('FeatureService getTasks folder stability', () => {
  it('persists generated folder name so reordering does not change it', () => {
    // Track upsertArtifact calls to verify folder is persisted
    const upsertedArtifacts = new Map<string, string>();

    const beadClient: BeadClient = {
      createEpic: () => 'bd-epic-1',
      closeBead: () => {},
      flushArtifacts: () => {},
      readArtifact: (beadId: string) => upsertedArtifacts.get(beadId) ?? null,
      upsertArtifact: (beadId: string, _cwd: string, _kind: string, content: string) => {
        upsertedArtifacts.set(beadId, content);
      },
    };

    // Mock execFileSync for BeadGateway calls
    const execSpy = spyOn(childProcess, 'execFileSync').mockImplementation(((cmd: string, args?: string[]): string => {
      const argStr = args?.join(' ') || '';

      if (argStr.includes('--version')) {
        return 'beads_rust 1.2.3';
      }
      if (argStr.includes('create') && argStr.includes('epic')) {
        return '{"id":"bd-epic-1"}';
      }
      if (argStr.includes('dep list')) {
        return JSON.stringify([
          { type: 'parent-child', issue_id: 'bd-task-1', title: 'Setup', status: 'open' },
          { type: 'parent-child', issue_id: 'bd-task-2', title: 'API', status: 'open' },
          { type: 'parent-child', issue_id: 'bd-task-3', title: 'Frontend', status: 'open' },
        ]);
      }
      if (argStr.includes('show')) {
        return JSON.stringify({
          id: 'bd-epic-1',
          title: 'my-feature',
          status: 'open',
          created_at: '2024-01-01T00:00:00Z',
        });
      }
      if (argStr.includes('list')) {
        return JSON.stringify([
          { id: 'bd-epic-1', title: 'my-feature', status: 'open', type: 'epic' },
        ]);
      }
      return '';
    }) as typeof childProcess.execFileSync);

    const service = new FeatureService(testRoot, beadClient, onMode);
    service.create('my-feature');

    // First call to getTasks generates and persists folders
    const tasks1 = (service as any).getTasks('my-feature');
    expect(tasks1).toHaveLength(3);
    expect(tasks1[0].folder).toBe('01-setup');
    expect(tasks1[1].folder).toBe('02-api');
    expect(tasks1[2].folder).toBe('03-frontend');

    // Verify folders were persisted via upsertArtifact
    expect(upsertedArtifacts.has('bd-task-1')).toBe(true);
    const storedState1 = JSON.parse(upsertedArtifacts.get('bd-task-1')!);
    expect(storedState1.folder).toBe('01-setup');

    execSpy.mockRestore();
  });
});
