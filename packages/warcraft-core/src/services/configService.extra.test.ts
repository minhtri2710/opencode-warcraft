import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_WARCRAFT_CONFIG } from '../defaults.js';
import { ConfigService } from './configService.js';

let tempHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'config-extra-'));
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

function writeConfig(data: Record<string, unknown>): void {
  const service = new ConfigService();
  const configDir = path.dirname(service.getPath());
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(service.getPath(), JSON.stringify(data));
}

describe('ConfigService.getAgentConfig edge cases', () => {
  it('returns agent config with default autoLoadSkills when user has none', () => {
    writeConfig({ agents: { saurfang: { temperature: 0.5 } } });
    const service = new ConfigService();
    const config = service.getAgentConfig('saurfang');
    expect(config.temperature).toBe(0.5);
    // saurfang has empty autoLoadSkills by default
    expect(config.autoLoadSkills).toEqual([]);
  });

  it('deduplicates autoLoadSkills from defaults and user config', () => {
    writeConfig({
      agents: {
        mekkatorque: {
          autoLoadSkills: ['test-driven-development'], // duplicate of default
        },
      },
    });
    const service = new ConfigService();
    const config = service.getAgentConfig('mekkatorque');
    // Should not have duplicate entries
    const tddCount = config.autoLoadSkills!.filter((s) => s === 'test-driven-development').length;
    expect(tddCount).toBe(1);
  });

  it('filters onboarding from non-planner agents autoLoadSkills', () => {
    writeConfig({
      agents: {
        saurfang: { autoLoadSkills: ['onboarding', 'custom-skill'] },
      },
    });
    const service = new ConfigService();
    const config = service.getAgentConfig('saurfang');
    expect(config.autoLoadSkills).not.toContain('onboarding');
    expect(config.autoLoadSkills).toContain('custom-skill');
  });

  it('keeps onboarding for planner agents (khadgar)', () => {
    writeConfig({
      agents: {
        khadgar: { autoLoadSkills: ['onboarding'] },
      },
    });
    const service = new ConfigService();
    const config = service.getAgentConfig('khadgar');
    expect(config.autoLoadSkills).toContain('onboarding');
  });

  it('keeps onboarding for planner agents (mimiron)', () => {
    writeConfig({
      agents: {
        mimiron: { autoLoadSkills: ['onboarding'] },
      },
    });
    const service = new ConfigService();
    const config = service.getAgentConfig('mimiron');
    expect(config.autoLoadSkills).toContain('onboarding');
  });

  it('applies disableSkills to remove default autoLoadSkills', () => {
    writeConfig({
      disableSkills: ['test-driven-development'],
    });
    const service = new ConfigService();
    const config = service.getAgentConfig('mekkatorque');
    expect(config.autoLoadSkills).not.toContain('test-driven-development');
    expect(config.autoLoadSkills).toContain('verification-before-completion');
  });
});

describe('ConfigService.isOmoSlimEnabled', () => {
  it('returns false by default', () => {
    const service = new ConfigService();
    expect(service.isOmoSlimEnabled()).toBe(false);
  });

  it('returns true when configured', () => {
    writeConfig({ omoSlimEnabled: true });
    const service = new ConfigService();
    expect(service.isOmoSlimEnabled()).toBe(true);
  });

  it('returns false for non-boolean values', () => {
    writeConfig({ omoSlimEnabled: 'yes' });
    const service = new ConfigService();
    expect(service.isOmoSlimEnabled()).toBe(false);
  });
});

describe('ConfigService.getStrictTaskTransitions', () => {
  it('is an alias for isStrictTaskTransitionsEnabled', () => {
    const service = new ConfigService();
    expect(service.getStrictTaskTransitions()).toBe(service.isStrictTaskTransitionsEnabled());
  });

  it('returns true when enabled via config', () => {
    writeConfig({ strictTaskTransitionsEnabled: true });
    const service = new ConfigService();
    expect(service.getStrictTaskTransitions()).toBe(true);
  });
});

describe('ConfigService.getSandboxConfig edge cases', () => {
  it('sets persistent=true by default for docker mode', () => {
    writeConfig({ sandbox: 'docker' });
    const service = new ConfigService();
    expect(service.getSandboxConfig().persistent).toBe(true);
  });

  it('allows overriding persistent to false', () => {
    writeConfig({ sandbox: 'docker', persistentContainers: false });
    const service = new ConfigService();
    expect(service.getSandboxConfig().persistent).toBe(false);
  });

  it('omits image key when not configured', () => {
    writeConfig({ sandbox: 'docker' });
    const service = new ConfigService();
    const config = service.getSandboxConfig();
    expect(config.image).toBeUndefined();
  });
});

describe('ConfigService.getParallelExecutionConfig edge cases', () => {
  it('defaults maxConcurrency to 4 when not set', () => {
    writeConfig({ parallelExecution: { strategy: 'bounded' } });
    const service = new ConfigService();
    expect(service.getParallelExecutionConfig().maxConcurrency).toBe(4);
  });

  it('defaults strategy to unbounded for unknown values', () => {
    writeConfig({ parallelExecution: { strategy: 'invalid' } });
    const service = new ConfigService();
    expect(service.getParallelExecutionConfig().strategy).toBe('unbounded');
  });

  it('handles non-integer maxConcurrency by using default', () => {
    writeConfig({ parallelExecution: { strategy: 'bounded', maxConcurrency: 'five' } });
    const service = new ConfigService();
    expect(service.getParallelExecutionConfig().maxConcurrency).toBe(4);
  });
});

describe('ConfigService caching edge cases', () => {
  it('invalidates cache after set()', () => {
    const service = new ConfigService();
    const first = service.get();
    expect(first.agentMode).toBe('unified');

    service.set({ agentMode: 'dedicated' });
    const second = service.get();
    expect(second.agentMode).toBe('dedicated');
  });

  it('exists() returns false when no config file', () => {
    const service = new ConfigService();
    expect(service.exists()).toBe(false);
  });

  it('exists() returns true after init()', () => {
    const service = new ConfigService();
    service.init();
    expect(service.exists()).toBe(true);
  });

  it('init() returns existing config when file already exists', () => {
    writeConfig({ beadsMode: 'off' });
    const service = new ConfigService();
    const result = service.init();
    expect(result.beadsMode).toBe('off');
  });
});

describe('ConfigService.getWorkflowGatesMode edge cases', () => {
  it('is case-insensitive for config value', () => {
    writeConfig({ workflowGatesMode: 'ENFORCE' });
    const service = new ConfigService();
    expect(service.getWorkflowGatesMode()).toBe('enforce');
  });

  it('is case-insensitive for env var', () => {
    const saved = process.env.WARCRAFT_WORKFLOW_GATES_MODE;
    try {
      process.env.WARCRAFT_WORKFLOW_GATES_MODE = 'Enforce';
      const service = new ConfigService();
      expect(service.getWorkflowGatesMode()).toBe('enforce');
    } finally {
      if (saved === undefined) delete process.env.WARCRAFT_WORKFLOW_GATES_MODE;
      else process.env.WARCRAFT_WORKFLOW_GATES_MODE = saved;
    }
  });
});
