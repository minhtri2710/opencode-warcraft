import { describe, expect, it, spyOn } from 'bun:test';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BeadGateway } from './BeadGateway';
import type { AuditEntry, BeadComment } from './BeadGateway.types.js';
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
      timeout: 5_000,
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
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenNthCalledWith(2, 'br', ['init'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenNthCalledWith(3, 'br', ['create', 'my-feature', '-t', 'epic', '-p', '2', '--json'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 15_000,
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
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenNthCalledWith(
      4,
      'br',
      ['create', 'Task A', '-t', 'task', '--parent', 'epic-1', '-p', '1', '--json'],
      { cwd: '/repo', encoding: 'utf-8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'] },
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

    const brOpts = {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    };

    // in_progress: removes transient labels, then claims
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--remove-label', 'blocked'], brOpts);
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--remove-label', 'failed'], brOpts);
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--remove-label', 'partial'], brOpts);
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--remove-label', 'cancelled'], brOpts);
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--claim'], brOpts);

    // blocked: removes other transient labels, then defers + adds label
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '-s', 'deferred'], brOpts);
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--add-label', 'blocked'], brOpts);

    // pending: removes transient labels, then unclaims via --assignee '' -s open
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--assignee', '', '-s', 'open'], brOpts);

    // done: close (no labels to remove)
    expect(execSpy).toHaveBeenCalledWith('br', ['close', 'bd-1'], brOpts);

    execSpy.mockRestore();
  });

  it('unclaim uses --assignee and -s open instead of nonexistent --unclaim flag', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.syncTaskStatus('bd-1', 'pending');

    // Must NOT use --unclaim (doesn't exist in br CLI)
    const allCalls = execSpy.mock.calls.map((c) => c[1]);
    const hasUnclaimFlag = allCalls.some((args: unknown) => Array.isArray(args) && args.includes('--unclaim'));
    expect(hasUnclaimFlag).toBe(false);

    // Must use --assignee '' -s open
    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--assignee', '', '-s', 'open'], expect.any(Object));

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
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(execSpy).toHaveBeenNthCalledWith(4, 'br', ['update', 'bd-2', '--description', 'Spec content'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 15_000,
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
      timeout: 15_000,
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
      timeout: 15_000,
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
      timeout: 15_000,
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
      timeout: 15_000,
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
      timeout: 5_000,
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
    expect(execSpy).toHaveBeenCalledWith(
      'br',
      ['dep', 'list', 'epic-1', '--direction', 'up', '--type', 'parent-child', '--json'],
      {
        cwd: '/repo',
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

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
      timeout: 5_000,
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
      timeout: 15_000,
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
      timeout: 15_000,
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

  it('removes label from bead via br update --remove-label', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.removeLabel('bd-1', 'blocked');

    expect(execSpy).toHaveBeenCalledWith('br', ['update', 'bd-1', '--remove-label', 'blocked'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('adds dependency between beads via br dep add', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.addDependency('task-2', 'task-1');

    expect(execSpy).toHaveBeenCalledWith('br', ['dep', 'add', 'task-2', 'task-1'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('removes dependency between beads via br dep remove', () => {
    const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
    const gateway = new BeadGateway('/repo');

    gateway.removeDependency('task-2', 'task-1');

    expect(execSpy).toHaveBeenCalledWith('br', ['dep', 'remove', 'task-2', 'task-1'], {
      cwd: '/repo',
      encoding: 'utf-8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    execSpy.mockRestore();
  });

  it('lists child beads with --type parent-child filter', () => {
    const execSpy = spyOn(childProcess, 'execFileSync')
      .mockReturnValueOnce('beads_rust 1.2.3')
      .mockReturnValue('[{"type":"parent-child","issue_id":"bd-1","title":"Task 1","status":"open"}]');
    const gateway = new BeadGateway('/repo');

    gateway.list({ type: 'task', parent: 'epic-1' });

    expect(execSpy).toHaveBeenCalledWith(
      'br',
      ['dep', 'list', 'epic-1', '--direction', 'up', '--type', 'parent-child', '--json'],
      {
        cwd: '/repo',
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    execSpy.mockRestore();
  });

  describe('listComments', () => {
    it('classifies comments list as read operation with 5s timeout', () => {
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('[]');
      const gateway = new BeadGateway('/repo');

      gateway.listComments('bd-1');

      expect(execSpy).toHaveBeenCalledWith('br', ['comments', 'list', 'bd-1', '--json'], {
        cwd: '/repo',
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      execSpy.mockRestore();
    });

    it('parses empty comment array', () => {
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('[]');
      const gateway = new BeadGateway('/repo');

      const comments = gateway.listComments('bd-1');

      expect(comments).toEqual([]);
      expect(execSpy).toHaveBeenCalledTimes(3);

      execSpy.mockRestore();
    });

    it('parses single comment with required fields', () => {
      const singleCommentFixture = '[{"id":"comment-1","body":"This is a comment"}]';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(singleCommentFixture);
      const gateway = new BeadGateway('/repo');

      const comments = gateway.listComments('bd-1');

      expect(comments).toHaveLength(1);
      expect(comments[0]).toEqual({
        id: 'comment-1',
        body: 'This is a comment',
      });
      expect(execSpy).toHaveBeenCalledTimes(3);

      execSpy.mockRestore();
    });

    it('parses single comment with optional fields', () => {
      const singleCommentFixture =
        '[{"id":"comment-1","body":"Full comment","author":"test-user","timestamp":"2024-01-01T00:00:00Z","prompt":"What should I do?","response":"Do this task"}]';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(singleCommentFixture);
      const gateway = new BeadGateway('/repo');

      const comments = gateway.listComments('bd-1');

      expect(comments).toHaveLength(1);
      expect(comments[0]).toEqual({
        id: 'comment-1',
        body: 'Full comment',
        author: 'test-user',
        timestamp: '2024-01-01T00:00:00Z',
        prompt: 'What should I do?',
        response: 'Do this task',
      });
      expect(execSpy).toHaveBeenCalledTimes(3);

      execSpy.mockRestore();
    });

    it('parses multiple comments', () => {
      const multipleCommentsFixture =
        '[{"id":"comment-1","body":"First comment"},{"id":"comment-2","body":"Second comment","author":"user2"}]';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(multipleCommentsFixture);
      const gateway = new BeadGateway('/repo');

      const comments = gateway.listComments('bd-1');

      expect(comments).toHaveLength(2);
      expect(comments[0]).toEqual({
        id: 'comment-1',
        body: 'First comment',
      });
      expect(comments[1]).toEqual({
        id: 'comment-2',
        body: 'Second comment',
        author: 'user2',
      });
      expect(execSpy).toHaveBeenCalledTimes(3);

      execSpy.mockRestore();
    });

    it('throws parse_error on malformed JSON', () => {
      const malformedJsonFixture = 'invalid json output';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(malformedJsonFixture);
      const gateway = new BeadGateway('/repo');

      expect(() => gateway.listComments('bd-1')).toThrow(BeadGatewayError);
      try {
        gateway.listComments('bd-1');
      } catch (error) {
        expect(error).toBeInstanceOf(BeadGatewayError);
        expect((error as BeadGatewayError).code).toBe('parse_error');
        expect((error as BeadGatewayError).message).toContain('invalid JSON');
        expect((error as BeadGatewayError).message).toContain('Raw excerpt');
        expect((error as BeadGatewayError).message).toContain('invalid json output');
        expect((error as BeadGatewayError).internalCode).toBe('BR_PARSE_FAILED');
      }

      execSpy.mockRestore();
    });

    it('includes truncated excerpt in error for long malformed JSON', () => {
      const longMalformedJson = 'a'.repeat(300) + '... and more invalid content';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(longMalformedJson);
      const gateway = new BeadGateway('/repo');

      expect(() => gateway.listComments('bd-1')).toThrow(BeadGatewayError);
      try {
        gateway.listComments('bd-1');
      } catch (error) {
        expect(error).toBeInstanceOf(BeadGatewayError);
        expect((error as BeadGatewayError).message).toContain('invalid JSON');
        // Should be truncated to 200 chars plus '...'
        expect((error as BeadGatewayError).message).toContain('a'.repeat(200));
        expect((error as BeadGatewayError).message).toContain('...');
        expect((error as BeadGatewayError).message).not.toContain('... and more invalid content');
      }

      execSpy.mockRestore();
    });

    it('throws parse_error when response is not an array', () => {
      const notArrayFixture = '{"comments":[]}';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(notArrayFixture);
      const gateway = new BeadGateway('/repo');

      expect(() => gateway.listComments('bd-1')).toThrow(BeadGatewayError);
      try {
        gateway.listComments('bd-1');
      } catch (error) {
        expect(error).toBeInstanceOf(BeadGatewayError);
        expect((error as BeadGatewayError).code).toBe('parse_error');
        expect((error as BeadGatewayError).message).toContain('expected JSON array');
      }

      execSpy.mockRestore();
    });

    it('throws missing_field when comment lacks id field', () => {
      const missingIdFixture = '[{"body":"Comment without id"}]';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(missingIdFixture);
      const gateway = new BeadGateway('/repo');

      expect(() => gateway.listComments('bd-1')).toThrow(BeadGatewayError);
      try {
        gateway.listComments('bd-1');
      } catch (error) {
        expect(error).toBeInstanceOf(BeadGatewayError);
        expect((error as BeadGatewayError).code).toBe('missing_field');
        expect((error as BeadGatewayError).message).toContain('missing id field');
      }

      execSpy.mockRestore();
    });

    it('throws parse_error when comment item is not an object', () => {
      const notObjectFixture = '["string comment", "another"]';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(notObjectFixture);
      const gateway = new BeadGateway('/repo');

      expect(() => gateway.listComments('bd-1')).toThrow(BeadGatewayError);
      try {
        gateway.listComments('bd-1');
      } catch (error) {
        expect(error).toBeInstanceOf(BeadGatewayError);
        expect((error as BeadGatewayError).code).toBe('parse_error');
        expect((error as BeadGatewayError).message).toContain('comment item is not an object');
      }

      execSpy.mockRestore();
    });
  });

  describe('auditRecord', () => {
    it('calls br audit record with required fields only', () => {
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
      const gateway = new BeadGateway('/repo');

      gateway.auditRecord({
        kind: 'llm_call',
        issueId: 'bd-1',
      });

      expect(execSpy).toHaveBeenCalledWith('br', ['audit', 'record', '--kind', 'llm_call', '--issue-id', 'bd-1'], {
        cwd: '/repo',
        encoding: 'utf-8',
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      execSpy.mockRestore();
    });

    it('calls br audit record with all optional fields', () => {
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
      const gateway = new BeadGateway('/repo');

      gateway.auditRecord({
        kind: 'tool_call',
        issueId: 'bd-2',
        model: 'claude-opus-4',
        toolName: 'warcraft_status',
        exitCode: 0,
        error: 'some error message',
      });

      expect(execSpy).toHaveBeenCalledWith(
        'br',
        [
          'audit',
          'record',
          '--kind',
          'tool_call',
          '--issue-id',
          'bd-2',
          '--model',
          'claude-opus-4',
          '--tool-name',
          'warcraft_status',
          '--exit-code',
          '0',
          '--error',
          'some error message',
        ],
        {
          cwd: '/repo',
          encoding: 'utf-8',
          timeout: 15_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      execSpy.mockRestore();
    });

    it('classifies audit record as write operation with 15s timeout', () => {
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
      const gateway = new BeadGateway('/repo');

      gateway.auditRecord({ kind: 'label', issueId: 'bd-1' });

      expect(execSpy).toHaveBeenCalledWith('br', expect.any(Array), expect.objectContaining({ timeout: 15_000 }));

      execSpy.mockRestore();
    });

    it('does not include --prompt or --response flags', () => {
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('');
      const gateway = new BeadGateway('/repo');

      gateway.auditRecord({
        kind: 'llm_call',
        issueId: 'bd-1',
        model: 'claude-opus-4',
      });

      const allCalls = execSpy.mock.calls.map((c) => c[1]);
      const hasPromptFlag = allCalls.some((args: unknown) => Array.isArray(args) && args.includes('--prompt'));
      const hasResponseFlag = allCalls.some((args: unknown) => Array.isArray(args) && args.includes('--response'));
      expect(hasPromptFlag).toBe(false);
      expect(hasResponseFlag).toBe(false);

      execSpy.mockRestore();
    });
  });

  describe('auditLog', () => {
    it('parses valid audit log JSON array', () => {
      const validAuditLogFixture = JSON.stringify([
        {
          id: 'audit-1',
          kind: 'llm_call',
          issue_id: 'bd-1',
          model: 'claude-opus-4',
          timestamp: '2025-01-15T10:00:00Z',
        },
        {
          id: 'audit-2',
          kind: 'tool_call',
          issue_id: 'bd-1',
          tool_name: 'warcraft_status',
          exit_code: 0,
          timestamp: '2025-01-15T10:01:00Z',
        },
      ]);
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(validAuditLogFixture);
      const gateway = new BeadGateway('/repo');

      const entries = gateway.auditLog('bd-1');

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        id: 'audit-1',
        kind: 'llm_call',
        issueId: 'bd-1',
        model: 'claude-opus-4',
        timestamp: '2025-01-15T10:00:00Z',
      });
      expect(entries[1]).toEqual({
        id: 'audit-2',
        kind: 'tool_call',
        issueId: 'bd-1',
        toolName: 'warcraft_status',
        exitCode: 0,
        timestamp: '2025-01-15T10:01:00Z',
      });

      execSpy.mockRestore();
    });

    it('classifies audit log as read operation with 5s timeout', () => {
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('[]');
      const gateway = new BeadGateway('/repo');

      gateway.auditLog('bd-1');

      expect(execSpy).toHaveBeenCalledWith('br', ['audit', 'log', 'bd-1', '--json'], {
        cwd: '/repo',
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      execSpy.mockRestore();
    });

    it('throws parse_error on malformed audit log JSON', () => {
      const malformedFixture = 'not valid json at all {{{';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(malformedFixture);
      const gateway = new BeadGateway('/repo');

      expect(() => gateway.auditLog('bd-1')).toThrow(BeadGatewayError);
      try {
        gateway.auditLog('bd-1');
      } catch (error) {
        expect(error).toBeInstanceOf(BeadGatewayError);
        expect((error as BeadGatewayError).code).toBe('parse_error');
        expect((error as BeadGatewayError).message).toContain('invalid JSON');
        expect((error as BeadGatewayError).message).toContain('Raw excerpt');
        expect((error as BeadGatewayError).message).toContain('not valid json at all');
        expect((error as BeadGatewayError).internalCode).toBe('BR_PARSE_FAILED');
      }

      execSpy.mockRestore();
    });

    it('returns empty array for empty audit log', () => {
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('[]');
      const gateway = new BeadGateway('/repo');

      const entries = gateway.auditLog('bd-1');

      expect(entries).toEqual([]);

      execSpy.mockRestore();
    });
  });

  describe('showToon', () => {
    it('calls br show with --format toon and returns raw output', () => {
      const toonOutput = 'bd-1 | My Task | open | priority:2\n  depends on: bd-0';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(toonOutput);
      const gateway = new BeadGateway('/repo');

      const result = gateway.showToon('bd-1');

      expect(result).toBe(toonOutput);
      expect(execSpy).toHaveBeenCalledWith('br', ['show', 'bd-1', '--format', 'toon'], {
        cwd: '/repo',
        encoding: 'utf-8',
        timeout: 5_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      execSpy.mockRestore();
    });

    it('classifies showToon as read operation with 5s timeout', () => {
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue('toon output');
      const gateway = new BeadGateway('/repo');

      gateway.showToon('bd-1');

      // Verify the timeout used is the read timeout (5s)
      const showCall = execSpy.mock.calls.find(
        (call) => Array.isArray(call[1]) && (call[1] as string[]).includes('--format'),
      );
      expect(showCall).toBeDefined();
      expect((showCall![2] as { timeout: number }).timeout).toBe(5_000);

      execSpy.mockRestore();
    });

    it('propagates errors from br CLI', () => {
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValueOnce('Initialized')
        .mockImplementationOnce(() => {
          throw new Error('br command failed');
        });
      const gateway = new BeadGateway('/repo');

      expect(() => gateway.showToon('bd-1')).toThrow(BeadGatewayError);

      execSpy.mockRestore();
    });
  });

  describe('generateChangelog', () => {
    it('calls br changelog without --robot by default', () => {
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue('## Changelog\n- Added feature X');
      const gateway = new BeadGateway('/repo');

      const result = gateway.generateChangelog();

      expect(result).toBe('## Changelog\n- Added feature X');
      expect(execSpy).toHaveBeenCalledWith('br', ['changelog'], {
        cwd: '/repo',
        encoding: 'utf-8',
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      execSpy.mockRestore();
    });

    it('calls br changelog --robot when robot option is true', () => {
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue('robot-format changelog output');
      const gateway = new BeadGateway('/repo');

      const result = gateway.generateChangelog({ robot: true });

      expect(result).toBe('robot-format changelog output');
      expect(execSpy).toHaveBeenCalledWith('br', ['changelog', '--robot'], {
        cwd: '/repo',
        encoding: 'utf-8',
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      execSpy.mockRestore();
    });

    it('calls br changelog without --robot when robot option is false', () => {
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue('human-format changelog');
      const gateway = new BeadGateway('/repo');

      const result = gateway.generateChangelog({ robot: false });

      expect(result).toBe('human-format changelog');
      expect(execSpy).toHaveBeenCalledWith('br', ['changelog'], {
        cwd: '/repo',
        encoding: 'utf-8',
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      execSpy.mockRestore();
    });

    it('classifies changelog as write operation with 15s timeout', () => {
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue('changelog output');
      const gateway = new BeadGateway('/repo');

      gateway.generateChangelog();

      // Verify the timeout is 15_000 (write timeout)
      const changelogCall = execSpy.mock.calls.find(
        (call) => Array.isArray(call[1]) && (call[1] as string[])[0] === 'changelog',
      );
      expect(changelogCall).toBeDefined();
      expect((changelogCall![2] as { timeout: number }).timeout).toBe(15_000);

      execSpy.mockRestore();
    });
  });

  describe('listTasksForEpic', () => {
    it('calls br dep list with correct args and parses tasks from JSON array', () => {
      const fixture = JSON.stringify([
        {
          type: 'parent-child',
          issue: {
            id: 'task-1',
            title: 'Setup auth',
            status: 'open',
            issue_type: 'task',
          },
        },
        {
          type: 'parent-child',
          issue: {
            id: 'task-2',
            title: 'Add tests',
            status: 'closed',
            issue_type: 'task',
          },
        },
      ]);
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(fixture);
      const gateway = new BeadGateway('/repo');

      const tasks = gateway.listTasksForEpic('epic-1');

      expect(tasks).toHaveLength(2);
      expect(tasks[0]).toEqual({
        folder: '',
        name: 'Setup auth',
        beadId: 'task-1',
        status: 'pending',
        origin: 'plan',
      });
      expect(tasks[1]).toEqual({
        folder: '',
        name: 'Add tests',
        beadId: 'task-2',
        status: 'done',
        origin: 'plan',
      });

      expect(execSpy).toHaveBeenCalledWith(
        'br',
        ['dep', 'list', 'epic-1', '--direction', 'up', '--type', 'parent-child', '--json'],
        {
          cwd: '/repo',
          encoding: 'utf-8',
          timeout: 5_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      execSpy.mockRestore();
    });

    it('returns empty array for empty JSON array', () => {
      const execSpy = spyOn(childProcess, 'execFileSync').mockReturnValueOnce('beads_rust 1.2.3').mockReturnValue('[]');
      const gateway = new BeadGateway('/repo');

      const tasks = gateway.listTasksForEpic('epic-1');

      expect(tasks).toEqual([]);

      execSpy.mockRestore();
    });

    it('handles flat dependency items without embedded issue object', () => {
      const fixture = JSON.stringify([
        {
          type: 'parent-child',
          id: 'task-1',
          title: 'Flat task',
          status: 'open',
          issue_type: 'task',
        },
      ]);
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(fixture);
      const gateway = new BeadGateway('/repo');

      const tasks = gateway.listTasksForEpic('epic-1');

      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual({
        folder: '',
        name: 'Flat task',
        beadId: 'task-1',
        status: 'pending',
        origin: 'plan',
      });

      execSpy.mockRestore();
    });

    it('filters out non-parent-child dependency types', () => {
      const fixture = JSON.stringify([
        {
          type: 'parent-child',
          issue: { id: 'task-1', title: 'Child task', status: 'open' },
        },
        {
          type: 'blocks',
          issue: { id: 'task-2', title: 'Blocking task', status: 'open' },
        },
      ]);
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(fixture);
      const gateway = new BeadGateway('/repo');

      const tasks = gateway.listTasksForEpic('epic-1');

      expect(tasks).toHaveLength(1);
      expect(tasks[0].beadId).toBe('task-1');

      execSpy.mockRestore();
    });

    it('throws BeadGatewayError with raw excerpt on malformed JSON', () => {
      const malformed = 'not valid json at all';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(malformed);
      const gateway = new BeadGateway('/repo');

      expect(() => gateway.listTasksForEpic('epic-1')).toThrow(BeadGatewayError);
      try {
        gateway.listTasksForEpic('epic-1');
      } catch (error) {
        expect(error).toBeInstanceOf(BeadGatewayError);
        expect((error as BeadGatewayError).code).toBe('parse_error');
        expect((error as BeadGatewayError).message).toContain('not valid json at all');
        expect((error as BeadGatewayError).internalCode).toBe('BR_PARSE_FAILED');
      }

      execSpy.mockRestore();
    });

    it('truncates raw excerpt to 200 chars on long malformed output', () => {
      const longMalformed = 'x'.repeat(300);
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(longMalformed);
      const gateway = new BeadGateway('/repo');

      expect(() => gateway.listTasksForEpic('epic-1')).toThrow(BeadGatewayError);
      try {
        gateway.listTasksForEpic('epic-1');
      } catch (error) {
        expect(error).toBeInstanceOf(BeadGatewayError);
        expect((error as BeadGatewayError).message).toContain('x'.repeat(200));
        expect((error as BeadGatewayError).message).toContain('...');
      }

      execSpy.mockRestore();
    });

    it('maps bead status to TaskStatusType correctly', () => {
      const fixture = JSON.stringify([
        { type: 'parent-child', issue: { id: 't-1', title: 'Open', status: 'open' } },
        { type: 'parent-child', issue: { id: 't-2', title: 'Closed', status: 'closed' } },
        { type: 'parent-child', issue: { id: 't-3', title: 'Deferred', status: 'deferred' } },
        { type: 'parent-child', issue: { id: 't-4', title: 'Unknown', status: 'weird' } },
      ]);
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(fixture);
      const gateway = new BeadGateway('/repo');

      const tasks = gateway.listTasksForEpic('epic-1');

      expect(tasks[0].status).toBe('pending');
      expect(tasks[1].status).toBe('done');
      expect(tasks[2].status).toBe('blocked');
      expect(tasks[3].status).toBe('pending');

      execSpy.mockRestore();
    });

    it('does not affect existing list() behavior', () => {
      const listFixture = '[{"id":"bd-1","title":"Task 1","status":"open","issue_type":"task"}]';
      const execSpy = spyOn(childProcess, 'execFileSync')
        .mockReturnValueOnce('beads_rust 1.2.3')
        .mockReturnValue(listFixture);
      const gateway = new BeadGateway('/repo');

      const result = gateway.list({ type: 'task' });

      expect(result).toEqual([{ id: 'bd-1', title: 'Task 1', status: 'open', type: 'task' }]);
      expect(execSpy).toHaveBeenCalledWith('br', ['list', '--json', '--type', 'task'], expect.any(Object));

      execSpy.mockRestore();
    });
  });
});
