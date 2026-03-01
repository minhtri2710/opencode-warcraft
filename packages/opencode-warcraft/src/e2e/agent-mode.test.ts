import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createOpencodeClient } from '@opencode-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import plugin from '../index';

const OPENCODE_CLIENT = createOpencodeClient({ baseUrl: 'http://localhost:1' });

const TEST_ROOT_BASE = '/tmp/warcraft-agent-mode-test';

function createProject(worktree: string) {
  return {
    id: 'test',
    worktree,
    time: { created: Date.now() },
  };
}

describe('agentMode gating', () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    fs.rmSync(TEST_ROOT_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT_BASE, { recursive: true });
    testRoot = fs.mkdtempSync(path.join(TEST_ROOT_BASE, 'project-'));
    process.env.HOME = testRoot;
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT_BASE, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it('registers khadgar, brann, mekkatorque, and algalon in unified mode', async () => {
    const configPath = path.join(testRoot, '.config', 'opencode', 'opencode_warcraft.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: 'unified',
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL('http://localhost:1'),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    expect(opencodeConfig.agent.khadgar).toBeDefined();
    expect(opencodeConfig.agent.mimiron).toBeUndefined();
    expect(opencodeConfig.agent.saurfang).toBeUndefined();
    expect(opencodeConfig.agent.brann).toBeDefined();
    expect(opencodeConfig.agent.mekkatorque).toBeDefined();
    expect(opencodeConfig.agent.algalon).toBeDefined();
    expect(opencodeConfig.default_agent).toBe('khadgar');
  });

  it('registers dedicated agents in dedicated mode', async () => {
    const configPath = path.join(testRoot, '.config', 'opencode', 'opencode_warcraft.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: 'dedicated',
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL('http://localhost:1'),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    expect(opencodeConfig.agent.khadgar).toBeUndefined();
    expect(opencodeConfig.agent.mimiron).toBeDefined();
    expect(opencodeConfig.agent.saurfang).toBeDefined();
    expect(opencodeConfig.agent.brann).toBeDefined();
    expect(opencodeConfig.agent.mekkatorque).toBeDefined();
    expect(opencodeConfig.agent.algalon).toBeDefined();
    expect(opencodeConfig.default_agent).toBe('mimiron');
  });
});
