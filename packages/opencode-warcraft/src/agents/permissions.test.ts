import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import * as path from 'path';
import { ConfigService } from 'warcraft-core';
import plugin from '../index';

type PluginInput = {
  directory: string;
  worktree: string;
  serverUrl: URL;
  project: { id: string; worktree: string; time: { created: number } };
  client: unknown;
  $: unknown;
};

function createStubShell(): unknown {
  const fn = ((..._args: unknown[]) => {
    throw new Error('shell not available in this test');
  }) as unknown as Record<string, unknown>;

  return Object.assign(fn, {
    braces(pattern: string) {
      return [pattern];
    },
    escape(input: string) {
      return input;
    },
    env() {
      return fn;
    },
    cwd() {
      return fn;
    },
    nothrow() {
      return fn;
    },
    throws() {
      return fn;
    },
  });
}

function createStubClient(): unknown {
  return {
    session: {
      create: async () => ({ data: { id: 'test-session' } }),
      prompt: async () => ({ data: {} }),
      get: async () => ({ data: { status: 'idle' } }),
      messages: async () => ({ data: [] }),
      abort: async () => {},
    },
    app: {
      agents: async () => ({ data: [] }),
      log: async () => {},
    },
    config: {
      get: async () => ({ data: {} }),
    },
  };
}

describe('Agent permissions', () => {
  afterEach(() => {
    mock.restore();
  });

  it('registers khadgar, brann, mekkatorque, and algalon in unified mode', async () => {
    // Mock ConfigService to return unified mode
    spyOn(ConfigService.prototype, 'get').mockReturnValue({
      agentMode: 'unified',
      agents: {
        khadgar: {},
      },
    } as any);

    const repoRoot = path.resolve(import.meta.dir, '..', '..', '..', '..');

    const ctx: PluginInput = {
      directory: repoRoot,
      worktree: repoRoot,
      serverUrl: new URL('http://localhost:1'),
      project: { id: 'test', worktree: repoRoot, time: { created: Date.now() } },
      client: createStubClient(),
      $: createStubShell(),
    };

    const hooks = await plugin(ctx as any);

    const opencodeConfig: {
      agent?: Record<string, { permission?: Record<string, string> }>;
      default_agent?: string;
    } = {};
    await hooks.config?.(opencodeConfig);

    expect(opencodeConfig.agent?.khadgar).toBeTruthy();
    expect(opencodeConfig.agent?.saurfang).toBeUndefined();
    expect(opencodeConfig.agent?.mimiron).toBeUndefined();
    expect(opencodeConfig.agent?.brann).toBeTruthy();
    expect(opencodeConfig.agent?.mekkatorque).toBeTruthy();
    expect(opencodeConfig.agent?.algalon).toBeTruthy();
    expect(opencodeConfig.default_agent).toBe('khadgar');

    const khadgarPerm = opencodeConfig.agent?.khadgar?.permission;
    expect(khadgarPerm).toBeTruthy();
    expect(khadgarPerm!.warcraft_feature_create).toBe('allow');
    expect(khadgarPerm!.warcraft_plan_write).toBe('allow');
  });

  it('registers dedicated agents in dedicated mode', async () => {
    // Mock ConfigService to return dedicated mode
    spyOn(ConfigService.prototype, 'get').mockReturnValue({
      agentMode: 'dedicated',
      agents: {
        mimiron: {},
        saurfang: {},
      },
    } as any);

    const repoRoot = path.resolve(import.meta.dir, '..', '..', '..', '..');

    const ctx: PluginInput = {
      directory: repoRoot,
      worktree: repoRoot,
      serverUrl: new URL('http://localhost:1'),
      project: { id: 'test', worktree: repoRoot, time: { created: Date.now() } },
      client: createStubClient(),
      $: createStubShell(),
    };

    const hooks = await plugin(ctx as any);

    const opencodeConfig: {
      agent?: Record<string, { permission?: Record<string, string> }>;
      default_agent?: string;
    } = {};
    await hooks.config?.(opencodeConfig);

    expect(opencodeConfig.agent?.khadgar).toBeUndefined();
    expect(opencodeConfig.agent?.saurfang).toBeTruthy();
    expect(opencodeConfig.agent?.mimiron).toBeTruthy();
    expect(opencodeConfig.agent?.brann).toBeTruthy();
    expect(opencodeConfig.agent?.mekkatorque).toBeTruthy();
    expect(opencodeConfig.agent?.algalon).toBeTruthy();
    expect(opencodeConfig.default_agent).toBe('mimiron');

    const saurfangPerm = opencodeConfig.agent?.saurfang?.permission;
    const mimironPerm = opencodeConfig.agent?.mimiron?.permission;

    expect(saurfangPerm).toBeTruthy();
    expect(mimironPerm).toBeTruthy();

    expect(mimironPerm!.edit).toBe('deny');
    expect(mimironPerm!.task).toBe('allow');
  });

  it('denies warcraft tools for non-warcraft agents', async () => {
    spyOn(ConfigService.prototype, 'get').mockReturnValue({
      agentMode: 'unified',
      agents: {
        khadgar: {},
      },
    } as any);

    const repoRoot = path.resolve(import.meta.dir, '..', '..', '..', '..');

    const ctx: PluginInput = {
      directory: repoRoot,
      worktree: repoRoot,
      serverUrl: new URL('http://localhost:1'),
      project: { id: 'test', worktree: repoRoot, time: { created: Date.now() } },
      client: createStubClient(),
      $: createStubShell(),
    };

    const hooks = await plugin(ctx as any);
    const opencodeConfig: {
      agent?: Record<string, { permission?: Record<string, string> }>;
      default_agent?: string;
    } = {
      agent: {
        custom_researcher: {
          permission: { edit: 'allow' },
        },
      },
    };
    await hooks.config?.(opencodeConfig);

    const customPerm = opencodeConfig.agent?.custom_researcher?.permission;
    expect(customPerm).toBeTruthy();
    expect(customPerm!.edit).toBe('allow');
    expect(customPerm!.warcraft_feature_create).toBe('deny');
    expect(customPerm!.warcraft_plan_write).toBe('deny');
    expect(customPerm!.warcraft_worktree_create).toBe('deny');
  });
  it('explicitly denies delegation tools for subagents', async () => {
    spyOn(ConfigService.prototype, 'get').mockReturnValue({
      agentMode: 'unified',
      agents: {
        khadgar: {},
      },
    } as any);

    const repoRoot = path.resolve(import.meta.dir, '..', '..', '..', '..');

    const ctx: PluginInput = {
      directory: repoRoot,
      worktree: repoRoot,
      serverUrl: new URL('http://localhost:1'),
      project: { id: 'test', worktree: repoRoot, time: { created: Date.now() } },
      client: createStubClient(),
      $: createStubShell(),
    };

    const hooks = await plugin(ctx as any);
    const opencodeConfig: {
      agent?: Record<string, { permission?: Record<string, string> }>;
      default_agent?: string;
    } = {};
    await hooks.config?.(opencodeConfig);

    const subagentNames = ['brann', 'mekkatorque', 'algalon'] as const;
    for (const name of subagentNames) {
      const perm = opencodeConfig.agent?.[name]?.permission;
      expect(perm).toBeTruthy();
      expect(perm!.task).toBe('deny');
      expect(perm!.delegate).toBe('deny');
    }
  });
});
