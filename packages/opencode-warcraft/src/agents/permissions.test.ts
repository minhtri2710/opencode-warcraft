import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';
import { ConfigService } from 'warcraft-core';
import plugin from '../index';
import { WARCRAFT_TOOL_IDS } from './tool-permissions.js';

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

  it('explicitly denies warcraft tools for built-in OpenCode agents (build, plan)', async () => {
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
        build: {},
        plan: {},
      },
    };
    await hooks.config?.(opencodeConfig);

    const buildPerm = opencodeConfig.agent?.build?.permission;
    expect(buildPerm).toBeTruthy();
    expect(buildPerm!.warcraft_feature_create).toBe('deny');
    expect(buildPerm!.warcraft_plan_write).toBe('deny');
    expect(buildPerm!.warcraft_worktree_create).toBe('deny');

    const planPerm = opencodeConfig.agent?.plan?.permission;
    expect(planPerm).toBeTruthy();
    expect(planPerm!.warcraft_feature_create).toBe('deny');
    expect(planPerm!.warcraft_plan_write).toBe('deny');
    expect(planPerm!.warcraft_worktree_create).toBe('deny');
  });
});

describe('Granular warcraft tool permissions', () => {
  afterEach(() => {
    mock.restore();
  });
  // Helper to get agent permissions from unified mode config
  async function getAgentPermissions() {
    spyOn(ConfigService.prototype, 'get').mockReturnValue({
      agentMode: 'unified',
      agents: { khadgar: {} },
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
    return opencodeConfig.agent!;
  }

  it('khadgar has access to ALL warcraft tools', async () => {
    const agents = await getAgentPermissions();
    const perm = agents.khadgar?.permission;
    expect(perm?.warcraft_feature_create).toBe('allow');
    expect(perm?.warcraft_plan_write).toBe('allow');
    expect(perm?.warcraft_worktree_create).toBe('allow');
    expect(perm?.warcraft_worktree_commit).toBe('allow');
    expect(perm?.warcraft_merge).toBe('allow');
    expect(perm?.warcraft_batch_execute).toBe('allow');
  });

  it('mekkatorque can access worktree_commit and plan_read but not worktree_create or merge', async () => {
    const agents = await getAgentPermissions();
    const perm = agents.mekkatorque?.permission;
    expect(perm?.warcraft_worktree_commit).toBe('allow');
    expect(perm?.warcraft_plan_read).toBe('allow');
    expect(perm?.warcraft_context_write).toBe('allow');
    expect(perm?.warcraft_skill).toBe('allow');
    // Denied
    expect(perm?.warcraft_worktree_create).toBe('deny');
    expect(perm?.warcraft_merge).toBe('deny');
    expect(perm?.warcraft_feature_create).toBe('deny');
    expect(perm?.warcraft_batch_execute).toBe('deny');
  });

  it('brann can access plan_read and status but not worktree_commit or merge', async () => {
    const agents = await getAgentPermissions();
    const perm = agents.brann?.permission;
    expect(perm?.warcraft_plan_read).toBe('allow');
    expect(perm?.warcraft_status).toBe('allow');
    expect(perm?.warcraft_context_write).toBe('allow');
    expect(perm?.warcraft_skill).toBe('allow');
    // Denied
    expect(perm?.warcraft_worktree_commit).toBe('deny');
    expect(perm?.warcraft_merge).toBe('deny');
    expect(perm?.warcraft_plan_write).toBe('deny');
  });

  it('algalon has same permissions as brann', async () => {
    const agents = await getAgentPermissions();
    const algPerm = agents.algalon?.permission;
    // Same allowed tools
    expect(algPerm?.warcraft_plan_read).toBe('allow');
    expect(algPerm?.warcraft_status).toBe('allow');
    // Same denied tools
    expect(algPerm?.warcraft_worktree_commit).toBe('deny');
    expect(algPerm?.warcraft_merge).toBe('deny');
  });
});

describe('Granular warcraft tool permissions (dedicated mode)', () => {
  afterEach(() => {
    mock.restore();
  });
  it('saurfang cannot access worktree_commit or plan_write', async () => {
    spyOn(ConfigService.prototype, 'get').mockReturnValue({
      agentMode: 'dedicated',
      agents: { mimiron: {}, saurfang: {} },
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
    } = {};
    await hooks.config?.(opencodeConfig);

    const perm = opencodeConfig.agent?.saurfang?.permission;
    expect(perm?.warcraft_worktree_commit).toBe('deny');
    expect(perm?.warcraft_plan_write).toBe('deny');
    // Saurfang CAN access these:
    expect(perm?.warcraft_worktree_create).toBe('allow');
    expect(perm?.warcraft_merge).toBe('allow');
    expect(perm?.warcraft_batch_execute).toBe('allow');
  });

  it('mimiron can access feature_create and plan tools but not worktree tools', async () => {
    spyOn(ConfigService.prototype, 'get').mockReturnValue({
      agentMode: 'dedicated',
      agents: { mimiron: {}, saurfang: {} },
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
    } = {};
    await hooks.config?.(opencodeConfig);

    const perm = opencodeConfig.agent?.mimiron?.permission;
    expect(perm?.warcraft_feature_create).toBe('allow');
    expect(perm?.warcraft_plan_write).toBe('allow');
    expect(perm?.warcraft_plan_read).toBe('allow');
    expect(perm?.warcraft_status).toBe('allow');
    // Denied
    expect(perm?.warcraft_worktree_create).toBe('deny');
    expect(perm?.warcraft_worktree_commit).toBe('deny');
    expect(perm?.warcraft_merge).toBe('deny');
  });
});

describe('WARCRAFT_TOOL_IDS covers all runtime-registered tools', () => {
  const INDEX_PATH = path.resolve(import.meta.dir, '..', 'index.ts');
  const indexSource = readFileSync(INDEX_PATH, 'utf-8');

  function extractRuntimeTools(source: string): string[] {
    const toolBlockMatch = source.match(/\btool:\s*\{([\s\S]*?)\n\s{4}\}/);
    if (!toolBlockMatch) return [];
    const block = toolBlockMatch[1];
    const tools: string[] = [];
    for (const m of block.matchAll(/\b(warcraft_\w+)\s*:/g)) {
      tools.push(m[1]);
    }
    return tools.sort();
  }

  it('every runtime tool is in WARCRAFT_TOOL_IDS', () => {
    const runtimeTools = extractRuntimeTools(indexSource);
    const permissionTools = [...WARCRAFT_TOOL_IDS].sort();
    const missing = runtimeTools.filter((t) => !(permissionTools as readonly string[]).includes(t));
    expect(missing).toEqual([]);
  });
});
