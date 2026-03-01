import { describe, expect, it, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BeadGateway } from './BeadGateway';
import { BeadGatewayError } from './BeadGateway.types.js';

describe('BeadGateway', () => {
  it('checkAvailable returns version when br is available', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValue('beads_rust 1.2.3');
    const gateway = new BeadGateway('/repo');
    const version = gateway.checkAvailable();
    expect(version).toBe('1.2.3');
    expect(execSpy).toHaveBeenCalledWith('br', ['--version'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execSpy.mockRestore();
  });

  it('checkAvailable throws br_not_found error when br is not found', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      const error = new Error('spawn br ENOENT');
      (error as Error & { code: string }).code = 'ENOENT';
      throw error;
    });
    const gateway = new BeadGateway('/repo');
    expect(() => gateway.checkAvailable()).toThrow(BeadGatewayError);
    try {
      gateway.checkAvailable();
    } catch (error) {
      expect(error).toBeInstanceOf(BeadGatewayError);
      expect((error as BeadGatewayError).code).toBe('br_not_found');
      expect((error as BeadGatewayError).message).toContain('br CLI not found');
      expect((error as BeadGatewayError).message).toContain('https://github.com/Dicklesworthstone/beads_rust');
    }
    execSpy.mockRestore();
  });

  it('checkAvailable throws br_not_found error on other spawn errors', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      const error = new Error('some other error');
      throw error;
    });
    const gateway = new BeadGateway('/repo');
    expect(() => gateway.checkAvailable()).toThrow(BeadGatewayError);
    try {
      gateway.checkAvailable();
    } catch (error) {
      expect(error).toBeInstanceOf(BeadGatewayError);
      expect((error as BeadGatewayError).code).toBe('br_not_found');
    }
    execSpy.mockRestore();
  });

  it('runs preflight check and initialization before first operational command', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockReturnValueOnce('{"id":"epic-1"}');

    const gateway = new BeadGateway('/repo');
    gateway.createEpic('my-feature', 3);

    expect(execSpy).toHaveBeenCalledTimes(3);
    expect(execSpy).toHaveBeenNthCalledWith(1, 'br', ['--version'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenNthCalledWith(2, 'br', ['init'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenNthCalledWith(3, 'br', ['create', 'my-feature', '-t', 'epic', '-p', '2', '--json'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('skips br init when .beads/beads.db already exists', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bead-gateway-init-skip-'));
    fs.mkdirSync(path.join(projectRoot, '.beads'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, '.beads', 'beads.db'), '');

    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('{"id":"epic-1"}');

    const gateway = new BeadGateway(projectRoot);
    expect(gateway.createEpic('my-feature', 3)).toBe('epic-1');

    expect(execSpy).toHaveBeenCalledTimes(2);
    expect(execSpy).toHaveBeenNthCalledWith(1, 'br', ['--version'], expect.any(Object));
    expect(execSpy).toHaveBeenNthCalledWith(
      2,
      'br',
      ['create', 'my-feature', '-t', 'epic', '-p', '2', '--json'],
      expect.any(Object),
    );

    execSpy.mockRestore();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
  it('tolerates already-initialized response during preflight and proceeds', () => {
    const initError = new Error('Command failed');
    (initError as Error & { stderr?: string }).stderr = 'Repository already initialized';

    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockImplementationOnce(() => {
        throw initError;
      })
      .mockReturnValueOnce('{"id":"epic-1"}');

    const gateway = new BeadGateway('/repo');
    expect(gateway.createEpic('my-feature', 3)).toBe('epic-1');
    expect(execSpy).toHaveBeenCalledTimes(3);
    expect(execSpy).toHaveBeenNthCalledWith(2, 'br', ['init'], expect.any(Object));

    execSpy.mockRestore();
  });

  it('treats ALREADY_INITIALIZED init payload as already initialized and proceeds', () => {
    const alreadyInitializedPayload = JSON.stringify({
      error: {
        code: 'ALREADY_INITIALIZED',
        message: "Already initialized at './.beads/beads.db'",
        hint: 'Use --force to reinitialize',
        retryable: false,
        context: {
          path: './.beads/beads.db',
        },
      },
    });

    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce(alreadyInitializedPayload)
      .mockReturnValueOnce('{"id":"epic-1"}');

    const gateway = new BeadGateway('/repo');
    expect(gateway.createEpic('my-feature', 3)).toBe('epic-1');
    expect(execSpy).toHaveBeenCalledTimes(3);
    expect(execSpy).toHaveBeenNthCalledWith(2, 'br', ['init'], expect.any(Object));

    execSpy.mockRestore();
  });
  it('fails fast when preflight initialization fails with a non-benign error', () => {
    const initError = new Error('Command failed');
    (initError as Error & { stderr?: string; stdout?: string }).stderr = 'permission denied';
    (initError as Error & { stderr?: string; stdout?: string }).stdout = 'init output details';
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockImplementationOnce(() => {
        throw initError;
      });

    const gateway = new BeadGateway('/repo');

    try {
      gateway.createEpic('my-feature', 3);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BeadGatewayError);
      expect((error as BeadGatewayError).code).toBe('command_error');
      expect((error as BeadGatewayError).message).toContain('Failed to initialize beads repository');
      expect((error as BeadGatewayError).message).not.toContain('permission denied');
      expect((error as BeadGatewayError).message).not.toContain('init output details');
    }
    expect(execSpy).toHaveBeenCalledTimes(2);
    expect(execSpy).toHaveBeenNthCalledWith(2, 'br', ['init'], expect.any(Object));

    execSpy.mockRestore();
  });

  it('memoizes preflight success and does not run again', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockReturnValueOnce('{"id":"epic-1"}')
      .mockReturnValueOnce('{"id":"task-1"}');

    const gateway = new BeadGateway('/repo');
    gateway.createEpic('my-feature', 3);
    gateway.createTask('Task A', 'epic-1', 2);

    expect(execSpy).toHaveBeenCalledTimes(4);
    expect(execSpy).toHaveBeenNthCalledWith(1, 'br', ['--version'], expect.any(Object));
    expect(execSpy).toHaveBeenNthCalledWith(2, 'br', ['init'], expect.any(Object));
    expect(execSpy).toHaveBeenNthCalledWith(
      3,
      'br',
      ['create', 'my-feature', '-t', 'epic', '-p', '2', '--json'],
      expect.any(Object),
    );
    expect(execSpy).toHaveBeenNthCalledWith(
      4,
      'br',
      ['create', 'Task A', '-t', 'task', '--parent', 'epic-1', '-p', '1', '--json'],
      expect.any(Object),
    );

    execSpy.mockRestore();
  });

  it('includes operation context without exposing CLI stderr/stdout in command errors', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockImplementationOnce(() => {
        const error = new Error('Command failed');
        (error as Error & { stderr?: string; stdout?: string }).stderr = 'Error: invalid argument';
        (error as Error & { stderr?: string; stdout?: string }).stdout = 'raw cli stdout details';
        throw error;
      });
    const gateway = new BeadGateway('/repo');
    try {
      gateway.createEpic('my-feature', 3);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BeadGatewayError);
      expect((error as BeadGatewayError).code).toBe('command_error');
      expect((error as BeadGatewayError).message).toContain('create epic bead');
      expect((error as BeadGatewayError).message).not.toContain('invalid argument');
      expect((error as BeadGatewayError).message).not.toContain('raw cli stdout details');
    }
    execSpy.mockRestore();
  });

  it('re-initializes and retries when a command fails with NOT_INITIALIZED', () => {
    const commandError = new Error('Command failed');
    (commandError as Error & { stderr?: string }).stderr = 'NOT_INITIALIZED: repository not initialized';

    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockImplementationOnce(() => {
        throw commandError;
      })
      .mockReturnValueOnce('Initialized')
      .mockReturnValueOnce('{"id":"epic-1"}');

    const gateway = new BeadGateway('/repo');
    expect(gateway.createEpic('my-feature', 3)).toBe('epic-1');

    expect(execSpy).toHaveBeenCalledTimes(5);
    expect(execSpy).toHaveBeenNthCalledWith(4, 'br', ['init'], expect.any(Object));
    expect(execSpy).toHaveBeenNthCalledWith(
      5,
      'br',
      ['create', 'my-feature', '-t', 'epic', '-p', '2', '--json'],
      expect.any(Object),
    );

    execSpy.mockRestore();
  });

  it('throws sanitized initialization failure when NOT_INITIALIZED persists after retry', () => {
    const commandError = new Error('Command failed');
    (commandError as Error & { stderr?: string }).stderr = 'NOT_INITIALIZED: repository not initialized';

    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockImplementationOnce(() => {
        throw commandError;
      })
      .mockReturnValueOnce('Initialized')
      .mockImplementationOnce(() => {
        throw commandError;
      });

    const gateway = new BeadGateway('/repo');
    try {
      gateway.createEpic('my-feature', 3);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BeadGatewayError);
      expect((error as BeadGatewayError).code).toBe('command_error');
      expect((error as BeadGatewayError).message).toContain('create epic bead');
      expect((error as BeadGatewayError).message).toContain('beads repository initialization failed');
      expect((error as BeadGatewayError).message).toContain('[BR_NOT_INITIALIZED]');
      expect((error as BeadGatewayError).message).not.toContain('repository not initialized');
    }

    execSpy.mockRestore();
  });
  it('fails immediately without retrying the original command when re-initialization fails', () => {
    const commandError = new Error('Command failed');
    (commandError as Error & { stderr?: string }).stderr = 'NOT_INITIALIZED: repository not initialized';

    const initFailure = new Error('init failed');
    (initFailure as Error & { stderr?: string }).stderr = 'permission denied';

    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockImplementationOnce(() => {
        throw commandError;
      })
      .mockImplementationOnce(() => {
        throw initFailure;
      });

    const gateway = new BeadGateway('/repo');

    expect(() => gateway.createEpic('my-feature', 3)).toThrow('Failed to initialize beads repository [BR_INIT_FAILED]');
    expect(execSpy).toHaveBeenCalledTimes(4);
    expect(execSpy).toHaveBeenLastCalledWith('br', ['init'], expect.any(Object));

    execSpy.mockRestore();
  });
  it('re-initializes and retries when command returns NOT_INITIALIZED payload', () => {
    const notInitializedPayload = JSON.stringify({
      error: {
        code: 'NOT_INITIALIZED',
        message: "Beads not initialized: run 'br init' first",
        hint: 'Run: br init',
      },
    });

    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockReturnValueOnce(notInitializedPayload)
      .mockReturnValueOnce('Initialized')
      .mockReturnValueOnce('{"id":"epic-1"}');

    const gateway = new BeadGateway('/repo');
    expect(gateway.createEpic('my-feature', 3)).toBe('epic-1');

    expect(execSpy).toHaveBeenCalledTimes(5);
    expect(execSpy).toHaveBeenNthCalledWith(4, 'br', ['init'], expect.any(Object));
    expect(execSpy).toHaveBeenNthCalledWith(
      5,
      'br',
      ['create', 'my-feature', '-t', 'epic', '-p', '2', '--json'],
      expect.any(Object),
    );

    execSpy.mockRestore();
  });

  it('throws sanitized error when NOT_INITIALIZED payload persists after retry', () => {
    const notInitializedPayload = JSON.stringify({
      error: {
        code: 'NOT_INITIALIZED',
        message: "Beads not initialized: run 'br init' first",
        hint: 'Run: br init',
      },
    });

    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockReturnValueOnce(notInitializedPayload)
      .mockReturnValueOnce('Initialized')
      .mockReturnValueOnce(notInitializedPayload);

    const gateway = new BeadGateway('/repo');
    try {
      gateway.createEpic('my-feature', 3);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BeadGatewayError);
      expect((error as BeadGatewayError).code).toBe('command_error');
      expect((error as BeadGatewayError).message).toContain('beads repository initialization failed');
      expect((error as BeadGatewayError).message).toContain('[BR_NOT_INITIALIZED]');
      expect((error as BeadGatewayError).message).not.toContain("Beads not initialized: run 'br init' first");
    }

    execSpy.mockRestore();
  });
  it('creates epic and task beads via br with priority', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockReturnValueOnce('{"id":"epic-1"}')
      .mockReturnValueOnce('{"id":"task-1"}');

    const gateway = new BeadGateway('/repo');
    expect(gateway.createEpic('my-feature', 3)).toBe('epic-1');
    expect(gateway.createTask('Task A', 'epic-1', 2)).toBe('task-1');

    expect(execSpy).toHaveBeenNthCalledWith(3, 'br', ['create', 'my-feature', '-t', 'epic', '-p', '2', '--json'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenNthCalledWith(
      4,
      'br',
      ['create', 'Task A', '-t', 'task', '--parent', 'epic-1', '-p', '1', '--json'],
      { cwd: '/repo', encoding: 'utf-8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    execSpy.mockRestore();
  });

  it('validates Warcraft priority must be integer between 1 and 5', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized');

    const gateway = new BeadGateway('/repo');

    // Test invalid priorities
    expect(() => gateway.createEpic('my-feature', 0)).toThrow(BeadGatewayError);
    expect(() => gateway.createEpic('my-feature', 6)).toThrow(BeadGatewayError);
    expect(() => gateway.createEpic('my-feature', 2.5)).toThrow(BeadGatewayError);
    expect(() => gateway.createTask('Task A', 'epic-1', -1)).toThrow(BeadGatewayError);
    expect(() => gateway.createTask('Task A', 'epic-1', 10)).toThrow(BeadGatewayError);

    // Test valid priorities (should not throw)
    execSpy.mockReturnValue('{"id":"epic-2"}');
    expect(() => gateway.createEpic('my-feature-2', 1)).not.toThrow();
    expect(() => gateway.createEpic('my-feature-3', 5)).not.toThrow();

    execSpy.mockRestore();
  });

  it('includes priority in error message for invalid priority', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized');

    const gateway = new BeadGateway('/repo');

    try {
      gateway.createEpic('my-feature', 0);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(BeadGatewayError);
      expect((error as BeadGatewayError).code).toBe('invalid_priority');
      expect((error as BeadGatewayError).message).toContain('Priority must be an integer between 1 and 5');
      expect((error as BeadGatewayError).message).toContain('1->0, 2->1, 3->2, 4->3, 5->4');
      expect((error as BeadGatewayError).message).toContain('0');
    }

    execSpy.mockRestore();
  });

  it('syncs task status with expected br commands', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.syncTaskStatus('bd-1', 'in_progress');
    gateway.syncTaskStatus('bd-1', 'blocked');
    gateway.syncTaskStatus('bd-1', 'pending');
    gateway.syncTaskStatus('bd-1', 'done');

    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--claim'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '-s', 'deferred'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--add-label', 'blocked'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--unclaim'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenCalledWith('br', ['close', 'bd-1'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('upserts and reads artifact payload from bead description', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockReturnValueOnce('{}')
      .mockReturnValueOnce('')
      .mockReturnValueOnce('{"description":"Spec content"}');

    const gateway = new BeadGateway('/repo');
    gateway.upsertArtifact('bd-2', 'spec', 'Spec content');
    const spec = gateway.readArtifact('bd-2', 'spec');

    expect(spec).toBe('Spec content');
    expect(execSpy).toHaveBeenNthCalledWith(3, 'br', ['show', 'bd-2', '--json'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenNthCalledWith(4, 'br', ['update', 'bd-2', '--description', 'Spec content'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('spec upsert preserves existing artifacts in description', () => {
    const existingDesc =
      'Old prefix\n\n<!-- WARCRAFT:ARTIFACTS:BEGIN -->\n{"task_state":"{\\"status\\":\\"pending\\",\\"dependsOn\\":[]}"}\n<!-- WARCRAFT:ARTIFACTS:END -->';
    const expectedDesc =
      'New spec content\n\n<!-- WARCRAFT:ARTIFACTS:BEGIN -->\n{\n  "task_state": "{\\"status\\":\\"pending\\",\\"dependsOn\\":[]}"\n}\n<!-- WARCRAFT:ARTIFACTS:END -->';
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValueOnce('Initialized')
      .mockReturnValueOnce(JSON.stringify({ description: existingDesc }))
      .mockReturnValueOnce('')
      .mockReturnValueOnce(JSON.stringify({ description: expectedDesc }));

    const gateway = new BeadGateway('/repo');
    gateway.upsertArtifact('bd-2', 'spec', 'New spec content');

    // The update call should include both spec as prefix and preserved artifacts
    expect(execSpy).toHaveBeenNthCalledWith(
      4,
      'br',
      ['update', 'bd-2', '--description', expect.stringContaining('New spec content')],
      expect.any(Object),
    );
    expect(execSpy).toHaveBeenNthCalledWith(
      4,
      'br',
      ['update', 'bd-2', '--description', expect.stringContaining('WARCRAFT:ARTIFACTS:BEGIN')],
      expect.any(Object),
    );
    expect(execSpy).toHaveBeenNthCalledWith(
      4,
      'br',
      ['update', 'bd-2', '--description', expect.stringContaining('task_state')],
      expect.any(Object),
    );

    const spec = gateway.readArtifact('bd-2', 'spec');
    expect(spec).toBe('New spec content');

    execSpy.mockRestore();
  });

  it('reads spec artifact from plain markdown description', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValue('{"description":"# Task Spec\\n\\nDo the thing."}');
    const gateway = new BeadGateway('/repo');

    const spec = gateway.readArtifact('bd-2', 'spec');

    expect(spec).toBe('# Task Spec\n\nDo the thing.');

    execSpy.mockRestore();
  });

  it('supports explicit close and flush operations', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.closeBead('bd-77');
    gateway.flushArtifacts();

    expect(execSpy).toHaveBeenCalledWith('br', ['close', 'bd-77'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenCalledWith('br', ['sync', '--flush-only'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('supports import artifacts operation', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.importArtifacts();

    expect(execSpy).toHaveBeenCalledWith('br', ['sync', '--import-only'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('updates bead description via br update --description', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.updateDescription('bd-1', 'New description content');

    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--description', 'New description content'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('updates bead description with multiline content', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    const multilineContent = 'Line 1\nLine 2\nLine 3';
    gateway.updateDescription('bd-1', multilineContent);

    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--description', multilineContent], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('adds comment to bead via br comments add', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.addComment('bd-1', 'This is a comment');

    expect(execSpy).toHaveBeenCalledWith('br', ['comments', 'add', 'bd-1', 'This is a comment'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('shows bead details via br show --json', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValue('{"id":"bd-1","title":"Test Bead"}');
    const gateway = new BeadGateway('/repo');

    const result = gateway.show('bd-1');

    expect(result).toEqual({ id: 'bd-1', title: 'Test Bead' });
    expect(execSpy).toHaveBeenCalledWith('br', ['show', 'bd-1', '--json'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('lists child beads via br dep list when parent is provided', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValue(
        '[{"type":"parent-child","issue_id":"bd-1","title":"Task 1","status":"open"},{"type":"blocks","issue_id":"bd-2","title":"Not a child","status":"open"}]',
      );
    const gateway = new BeadGateway('/repo');

    const result = gateway.list({ type: 'task', parent: 'epic-1' });

    expect(result).toEqual([{ id: 'bd-1', title: 'Task 1', status: 'open', type: 'task' }]);
    expect(execSpy).toHaveBeenCalledWith('br', ['dep', 'list', 'epic-1', '--direction', 'up', '--json'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('filters child beads by status when parent is provided', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValue(
        '[{"type":"parent-child","issue":{"id":"bd-1","title":"Task 1","status":"open","type":"task"}},{"type":"parent-child","issue":{"id":"bd-2","title":"Task 2","status":"closed","type":"task"}}]',
      );
    const gateway = new BeadGateway('/repo');

    const result = gateway.list({ parent: 'epic-1', status: 'closed' });

    expect(result).toEqual([{ id: 'bd-2', title: 'Task 2', status: 'closed', type: 'task' }]);

    execSpy.mockRestore();
  });

  it('lists beads without options', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValue('[{"id":"bd-1"}]');
    const gateway = new BeadGateway('/repo');

    const result = gateway.list();

    expect(result).toEqual([{ id: 'bd-1', title: '', status: '' }]);
    expect(execSpy).toHaveBeenCalledWith('br', ['list', '--json'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('maps issue_type from br CLI output to type field', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValue(
        '[{"id":"bd-1","title":"my-feature","status":"open","issue_type":"epic"},{"id":"bd-2","title":"my-task","status":"open","issue_type":"task"}]',
      );
    const gateway = new BeadGateway('/repo');

    const result = gateway.list({ type: 'epic', status: 'all' });

    expect(result).toEqual([{ id: 'bd-1', title: 'my-feature', status: 'open', type: 'epic' }]);

    execSpy.mockRestore();
  });

  it('falls back to type field when issue_type is absent', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValue('[{"id":"bd-1","title":"my-feature","status":"open","type":"epic"}]');
    const gateway = new BeadGateway('/repo');

    const result = gateway.list({ type: 'epic', status: 'all' });

    expect(result).toEqual([{ id: 'bd-1', title: 'my-feature', status: 'open', type: 'epic' }]);

    execSpy.mockRestore();
  });

  it('handles wrapped array response in list', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValue('{"issues":[{"id":"bd-1"}]}');
    const gateway = new BeadGateway('/repo');

    const result = gateway.list();

    expect(result).toEqual([{ id: 'bd-1', title: '', status: '' }]);

    execSpy.mockRestore();
  });

  it('returns empty array for non-array list response', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValue('{"other":"data"}');
    const gateway = new BeadGateway('/repo');

    const result = gateway.list();

    expect(result).toEqual([]);

    execSpy.mockRestore();
  });

  it('updates bead status via br update --status', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.updateStatus('bd-1', 'in_progress');

    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--status', 'in_progress'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('adds label to bead via br update --add-label', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.addLabel('bd-1', 'blocked');

    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--add-label', 'blocked'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('concurrent upsertArtifact calls on same bead preserve both artifacts', () => {
    // Use a real temp directory so the lock file I/O succeeds
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beadgw-test-'));

    // Track all update calls to verify both artifacts end up in the final description
    let currentDescription = '';

    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockImplementation(((_cmd: string, args?: string[]): string => {
        const argStr = args?.join(' ') || '';

        if (argStr.includes('show')) {
          return JSON.stringify({ description: currentDescription });
        }
        if (argStr.includes('--description')) {
          // Capture the description that gets written
          const descIdx = args!.indexOf('--description');
          currentDescription = args![descIdx + 1];
          return '';
        }
        return '';
      }) as typeof childProcess.execFileSync);

    const gateway = new BeadGateway(tmpDir);

    // First upsert: plan_approval artifact
    gateway.upsertArtifact('bd-1', 'plan_approval', '{"approved":true}');

    // Second upsert: feature_state artifact on same bead
    gateway.upsertArtifact('bd-1', 'feature_state', '{"status":"active"}');

    // The final description should contain both artifacts
    // Note: artifact values are JSON-stringified within the artifacts block
    expect(currentDescription).toContain('plan_approval');
    expect(currentDescription).toContain('approved');
    expect(currentDescription).toContain('feature_state');
    expect(currentDescription).toContain('active');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    execSpy.mockRestore();
  });

  it('preserves all artifact kinds including report, plan_comments, feature_state, and task_state', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beadgw-test-'));
    let currentDescription = '';

    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockImplementation(((_cmd: string, args?: string[]): string => {
        const argStr = args?.join(' ') || '';
        if (argStr.includes('show')) {
          return JSON.stringify({ description: currentDescription });
        }
        if (argStr.includes('--description')) {
          const descIdx = args!.indexOf('--description');
          currentDescription = args![descIdx + 1];
          return '';
        }
        return '';
      }) as typeof childProcess.execFileSync);

    const gateway = new BeadGateway(tmpDir);

    // Upsert several artifact kinds
    gateway.upsertArtifact('bd-1', 'worker_prompt', 'prompt content');
    gateway.upsertArtifact('bd-1', 'report', 'report content');
    gateway.upsertArtifact('bd-1', 'plan_comments', '{"threads":[]}');
    gateway.upsertArtifact('bd-1', 'feature_state', '{"status":"active"}');
    gateway.upsertArtifact('bd-1', 'task_state', '{"status":"pending"}');

    // All artifacts should be present in final description
    expect(currentDescription).toContain('worker_prompt');
    expect(currentDescription).toContain('prompt content');
    expect(currentDescription).toContain('report');
    expect(currentDescription).toContain('report content');
    expect(currentDescription).toContain('plan_comments');
    expect(currentDescription).toContain('feature_state');
    expect(currentDescription).toContain('task_state');

    // Verify roundtrip: read each artifact back
    const workerPrompt = gateway.readArtifact('bd-1', 'worker_prompt');
    const report = gateway.readArtifact('bd-1', 'report');
    const planComments = gateway.readArtifact('bd-1', 'plan_comments');
    const featureState = gateway.readArtifact('bd-1', 'feature_state');
    const taskState = gateway.readArtifact('bd-1', 'task_state');

    expect(workerPrompt).toBe('prompt content');
    expect(report).toBe('report content');
    expect(planComments).toBe('{"threads":[]}');
    expect(featureState).toBe('{"status":"active"}');
    expect(taskState).toBe('{"status":"pending"}');

    fs.rmSync(tmpDir, { recursive: true, force: true });
    execSpy.mockRestore();
  });
});
