import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DEFAULT_AGENT_MODELS, DEFAULT_WARCRAFT_CONFIG } from '../defaults';
import { ConfigService } from './configService';

let originalHome: string | undefined;
let tempHome: string;

const makeTempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-home-'));

beforeEach(() => {
  originalHome = process.env.HOME;
  tempHome = makeTempHome();
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  fs.rmSync(tempHome, { recursive: true, force: true });
});

describe('ConfigService defaults', () => {
  it('returns DEFAULT_WARCRAFT_CONFIG when config is missing', () => {
    const service = new ConfigService();
    const config = service.get();

    expect(config).toEqual(DEFAULT_WARCRAFT_CONFIG);
    expect(Object.keys(config.agents ?? {}).sort()).toEqual([
      'algalon',
      'brann',
      'khadgar',
      'mekkatorque',
      'mimiron',
      'saurfang',
    ]);
    expect(config.agents?.mimiron?.model).toBe(DEFAULT_AGENT_MODELS.mimiron);
    expect(config.agents?.khadgar?.model).toBe(DEFAULT_AGENT_MODELS.khadgar);
    expect(config.agents?.saurfang?.model).toBe(DEFAULT_AGENT_MODELS.saurfang);
  });

  it("returns 'unified' as default agentMode", () => {
    const service = new ConfigService();
    expect(service.get().agentMode).toBe('unified');
  });

  it("returns 'on' as default beadsMode", () => {
    const service = new ConfigService();
    expect(service.get().beadsMode).toBe('on');
    expect(service.getBeadsMode()).toBe('on');
  });

  it('returns default parallelExecution config', () => {
    const service = new ConfigService();
    const parallel = service.getParallelExecutionConfig();

    expect(parallel).toEqual({
      strategy: 'unbounded',
      maxConcurrency: 4,
    });
  });

  it('returns defaults and warns when config JSON is invalid', () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{"agents":');

    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '));
    };

    try {
      const config = service.get();
      expect(config).toEqual(DEFAULT_WARCRAFT_CONFIG);
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('[warcraft] Failed to read config');
    expect(warnings[0]).toContain(configPath);
  });

  it('deep-merges agent overrides with defaults', () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: {
            khadgar: { temperature: 0.8 },
          },
        },
        null,
        2,
      ),
    );

    const config = service.get();
    expect(config.agents?.khadgar?.temperature).toBe(0.8);
    expect(config.agents?.khadgar?.model).toBe(DEFAULT_AGENT_MODELS.khadgar);

    const agentConfig = service.getAgentConfig('khadgar');
    expect(agentConfig.temperature).toBe(0.8);
    expect(agentConfig.model).toBe(DEFAULT_AGENT_MODELS.khadgar);
  });

  it('deep-merges variant field from user config', () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: {
            mekkatorque: { variant: 'high' },
            brann: { variant: 'low', temperature: 0.2 },
          },
        },
        null,
        2,
      ),
    );

    const config = service.get();
    // variant should be merged from user config
    expect(config.agents?.mekkatorque?.variant).toBe('high');
    expect(config.agents?.brann?.variant).toBe('low');
    // other defaults should still be present
    expect(config.agents?.mekkatorque?.model).toBe(DEFAULT_AGENT_MODELS.mekkatorque);
    expect(config.agents?.brann?.temperature).toBe(0.2);

    // getAgentConfig should also return variant
    const mekkatorqueConfig = service.getAgentConfig('mekkatorque');
    expect(mekkatorqueConfig.variant).toBe('high');
    expect(mekkatorqueConfig.model).toBe(DEFAULT_AGENT_MODELS.mekkatorque);

    const brannConfig = service.getAgentConfig('brann');
    expect(brannConfig.variant).toBe('low');
    expect(brannConfig.temperature).toBe(0.2);
  });

  it('merges autoLoadSkills defaults and overrides', () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: {
            mekkatorque: {
              autoLoadSkills: ['custom-skill', 'verification-before-completion'],
            },
          },
        },
        null,
        2,
      ),
    );

    const config = service.getAgentConfig('mekkatorque');
    expect(config.autoLoadSkills).toEqual([
      'test-driven-development',
      'verification-before-completion',
      'custom-skill',
    ]);
  });

  it('removes autoLoadSkills via disableSkills', () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          disableSkills: ['parallel-exploration', 'custom-skill'],
          agents: {
            khadgar: {
              autoLoadSkills: ['custom-skill'],
            },
          },
        },
        null,
        2,
      ),
    );

    const config = service.getAgentConfig('khadgar');
    expect(config.autoLoadSkills).toEqual([]);
  });

  it('defaults have no variant set', () => {
    const service = new ConfigService();
    const config = service.get();

    // Default config should not have variant set for any agent
    for (const agentKey of Object.keys(config.agents ?? {})) {
      const agent = config.agents?.[agentKey as keyof typeof config.agents];
      expect(agent?.variant).toBeUndefined();
    }
  });

  it('brann autoLoadSkills does NOT include parallel-exploration', () => {
    // Brann should not auto-load parallel-exploration to prevent recursive delegation.
    // Brann is a leaf agent that should not spawn further Brann agents.
    const service = new ConfigService();
    const brannConfig = service.getAgentConfig('brann');

    expect(brannConfig.autoLoadSkills).not.toContain('parallel-exploration');
  });
  it('caches merged config after a successful file read', () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: 'dedicated',
      }),
    );

    const readSpy = spyOn(fs, 'readFileSync');
    try {
      const first = service.get();
      const second = service.get();

      expect(first.agentMode).toBe('dedicated');
      expect(second).toBe(first);
      expect(readSpy).toHaveBeenCalledTimes(1);
    } finally {
      readSpy.mockRestore();
    }
  });
});

describe('ConfigService disabled skills/mcps', () => {
  it('returns empty arrays when not configured', () => {
    const service = new ConfigService();
    expect(service.getDisabledSkills()).toEqual([]);
    expect(service.getDisabledMcps()).toEqual([]);
  });

  it('returns configured disabled skills', () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        disableSkills: ['brainstorming', 'writing-plans'],
      }),
    );

    expect(service.getDisabledSkills()).toEqual(['brainstorming', 'writing-plans']);
  });

  it('returns configured disabled MCPs', () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        disableMcps: ['websearch', 'grep_app'],
      }),
    );

    expect(service.getDisabledMcps()).toEqual(['websearch', 'grep_app']);
  });
});

describe('ConfigService set() merge behavior', () => {
  it('deep-merges nested agent config updates', () => {
    const service = new ConfigService();

    service.set({
      agents: {
        khadgar: {
          model: 'custom/model-a',
          temperature: 0.4,
        },
      },
    });

    const updated = service.set({
      agents: {
        khadgar: {
          temperature: 0.9,
        },
      },
    });

    expect(updated.agents?.khadgar?.model).toBe('custom/model-a');
    expect(updated.agents?.khadgar?.temperature).toBe(0.9);
  });

  it('persists and returns beadsMode updates', () => {
    const service = new ConfigService();
    service.set({ beadsMode: 'off' });

    expect(service.getBeadsMode()).toBe('off');
    expect(service.get().beadsMode).toBe('off');
  });

  it('deep-merges parallelExecution updates', () => {
    const service = new ConfigService();

    service.set({
      parallelExecution: {
        strategy: 'bounded',
      },
    });

    const updated = service.set({
      parallelExecution: {
        maxConcurrency: 8,
      },
    });

    expect(updated.parallelExecution).toEqual({
      strategy: 'bounded',
      maxConcurrency: 8,
    });
    expect(service.getParallelExecutionConfig()).toEqual({
      strategy: 'bounded',
      maxConcurrency: 8,
    });
  });

  it('clamps invalid parallelExecution maxConcurrency values', () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        parallelExecution: {
          strategy: 'bounded',
          maxConcurrency: 0,
        },
      }),
    );

    expect(service.getParallelExecutionConfig()).toEqual({
      strategy: 'bounded',
      maxConcurrency: 1,
    });

    service.set({
      parallelExecution: {
        strategy: 'bounded',
        maxConcurrency: 999,
      },
    });

    expect(service.getParallelExecutionConfig()).toEqual({
      strategy: 'bounded',
      maxConcurrency: 32,
    });
  });
});

describe('ConfigService beadsMode validation', () => {
  it("getBeadsMode() normalizes beadsMode: true to 'on'", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        beadsMode: true,
      }),
    );

    expect(service.getBeadsMode()).toBe('on');
  });

  it("getBeadsMode() normalizes beadsMode: false to 'off'", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        beadsMode: false,
      }),
    );

    expect(service.getBeadsMode()).toBe('off');
  });

  it("getBeadsMode() rejects legacy 'dual-write' with error", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        beadsMode: 'dual-write',
      }),
    );

    expect(() => service.getBeadsMode()).toThrow(
      'Invalid beadsMode: \'dual-write\'. Use "on" or "off". Legacy values "dual-write" and "beads-primary" are no longer supported.',
    );
  });

  it("getBeadsMode() rejects legacy 'beads-primary' with error", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        beadsMode: 'beads-primary',
      }),
    );

    expect(() => service.getBeadsMode()).toThrow(
      'Invalid beadsMode: \'beads-primary\'. Use "on" or "off". Legacy values "dual-write" and "beads-primary" are no longer supported.',
    );
  });

  it("getBeadsMode() falls back to 'on' when beadsMode is missing", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({}));

    expect(service.getBeadsMode()).toBe('on');
  });

  it("getBeadsMode() falls back to 'on' for invalid string values", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        beadsMode: 'invalid',
      }),
    );

    expect(service.getBeadsMode()).toBe('on');
  });

  it("getBeadsMode() returns 'on' for full beads_rust workflow", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        beadsMode: 'on',
      }),
    );

    // When beadsMode is 'on', it enables full beads_rust (br) workflow
    // with explicit import/flush lifecycle and no CLI-driven git actions
    expect(service.getBeadsMode()).toBe('on');
  });

  it('getBeadsMode() with boolean true enables full beads_rust workflow', () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        beadsMode: true,
      }),
    );

    // Boolean true should normalize to 'on' for full beads_rust workflow
    const mode = service.getBeadsMode();
    expect(mode).toBe('on');
  });

  it("getBeadsMode() returns 'off' to disable all bead interactions", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        beadsMode: 'off',
      }),
    );

    // When beadsMode is 'off', all bead interactions are disabled
    expect(service.getBeadsMode()).toBe('off');
  });

  it("getBeadsMode() only accepts 'on' or 'off' strings", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Test various invalid strings that are not valid beadsMode values
    const invalidModes = ['bd', 'beads', 'auto', 'sync', 'dual', 'primary'];

    for (const invalidMode of invalidModes) {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          beadsMode: invalidMode,
        }),
      );

      // Clear cache by creating a new service instance
      const newService = new ConfigService();

      // Invalid strings should fall back to 'on' (not throw)
      expect(newService.getBeadsMode()).toBe('on');
    }
  });
});

describe('ConfigService sandbox config', () => {
  it("getSandboxConfig() returns { mode: 'none' } when not configured", () => {
    const service = new ConfigService();
    const sandboxConfig = service.getSandboxConfig();

    expect(sandboxConfig).toEqual({ mode: 'none', persistent: false });
  });

  it("getSandboxConfig() returns { mode: 'docker' } when sandbox is set to docker", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        sandbox: 'docker',
      }),
    );

    const sandboxConfig = service.getSandboxConfig();
    expect(sandboxConfig).toEqual({ mode: 'docker', persistent: true });
  });

  it("getSandboxConfig() returns { mode: 'docker', image: 'node:22-slim' } when configured with dockerImage", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        sandbox: 'docker',
        dockerImage: 'node:22-slim',
      }),
    );

    const sandboxConfig = service.getSandboxConfig();
    expect(sandboxConfig).toEqual({ mode: 'docker', image: 'node:22-slim', persistent: true });
  });
});

describe('ConfigService HOME fallback', () => {
  it('falls back to os.homedir() when HOME and USERPROFILE are both unset', () => {
    const savedHome = process.env.HOME;
    const savedUserProfile = process.env.USERPROFILE;

    try {
      delete process.env.HOME;
      delete process.env.USERPROFILE;

      const service = new ConfigService();
      const configPath = service.getPath();

      // Should not be empty or point to root
      expect(configPath).toBeTruthy();
      expect(configPath).not.toStartWith('/.config');
      // Should contain os.homedir()
      expect(configPath).toContain(os.homedir());
    } finally {
      if (savedHome !== undefined) process.env.HOME = savedHome;
      else delete process.env.HOME;
      if (savedUserProfile !== undefined) process.env.USERPROFILE = savedUserProfile;
      else delete process.env.USERPROFILE;
    }
  });
});

describe('ConfigService hook cadence', () => {
  it('returns 1 when no hook_cadence configured', () => {
    const service = new ConfigService();
    expect(service.getHookCadence('experimental.chat.system.transform')).toBe(1);
  });

  it('returns configured cadence value', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        hook_cadence: { 'experimental.chat.system.transform': 3 },
      }),
    );
    expect(service.getHookCadence('experimental.chat.system.transform')).toBe(3);
  });

  it('returns 1 for invalid values (0, -1, 1.5)', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    for (const invalid of [0, -1, 1.5]) {
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          hook_cadence: { 'test.hook': invalid },
        }),
      );
      const svc = new ConfigService();
      expect(svc.getHookCadence('test.hook')).toBe(1);
    }
  });

  it('returns 1 for safety-critical hooks regardless of config', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        hook_cadence: { 'tool.execute.before': 5 },
      }),
    );
    expect(service.getHookCadence('tool.execute.before', { safetyCritical: true })).toBe(1);
  });
});

describe('ConfigService.getVerificationModel', () => {
  it('returns tdd when not configured', () => {
    const service = new ConfigService();
    expect(service.getVerificationModel()).toBe('tdd');
  });

  it('returns best-effort when configured', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ verificationModel: 'best-effort' }));
    const svc = new ConfigService();
    expect(svc.getVerificationModel()).toBe('best-effort');
  });

  it('returns tdd for invalid values', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    for (const invalid of ['', 'invalid', 'TDD', 'BEST-EFFORT', null, 123]) {
      fs.writeFileSync(configPath, JSON.stringify({ verificationModel: invalid }));
      const svc = new ConfigService();
      expect(svc.getVerificationModel()).toBe('tdd');
    }
  });
});

describe('ConfigService rollout flags', () => {
  it("getStructuredVerificationMode() returns 'compat' by default", () => {
    const service = new ConfigService();
    expect(service.getStructuredVerificationMode()).toBe('compat');
  });

  it("getStructuredVerificationMode() returns 'enforce' when configured", () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ structuredVerificationMode: 'enforce' }));
    const svc = new ConfigService();
    expect(svc.getStructuredVerificationMode()).toBe('enforce');
  });

  it("getStructuredVerificationMode() returns 'compat' for invalid values", () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    for (const invalid of ['', 'invalid', 'ENFORCE', null, 123]) {
      fs.writeFileSync(configPath, JSON.stringify({ structuredVerificationMode: invalid }));
      const svc = new ConfigService();
      expect(svc.getStructuredVerificationMode()).toBe('compat');
    }
  });

  it('isUnifiedDispatchEnabled() always returns true', () => {
    const service = new ConfigService();
    expect(service.isUnifiedDispatchEnabled()).toBe(true);
  });

  it('isUnifiedDispatchEnabled() returns true when configured', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ unifiedDispatchEnabled: true }));
    const svc = new ConfigService();
    expect(svc.isUnifiedDispatchEnabled()).toBe(true);
  });

  it('isUnifiedDispatchEnabled() always returns true regardless of config value', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    for (const value of [true, false, 'true', 1, 'yes', null]) {
      fs.writeFileSync(configPath, JSON.stringify({ unifiedDispatchEnabled: value }));
      const svc = new ConfigService();
      expect(svc.isUnifiedDispatchEnabled()).toBe(true);
    }
  });

  it('isStrictTaskTransitionsEnabled() returns false by default', () => {
    const service = new ConfigService();
    expect(service.isStrictTaskTransitionsEnabled()).toBe(false);
  });

  it('isStrictTaskTransitionsEnabled() returns true when configured', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ strictTaskTransitionsEnabled: true }));
    const svc = new ConfigService();
    expect(svc.isStrictTaskTransitionsEnabled()).toBe(true);
  });

  it('isStrictTaskTransitionsEnabled() returns false for non-boolean values', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    for (const invalid of ['true', 1, 'yes', null]) {
      fs.writeFileSync(configPath, JSON.stringify({ strictTaskTransitionsEnabled: invalid }));
      const svc = new ConfigService();
      expect(svc.isStrictTaskTransitionsEnabled()).toBe(false);
    }
  });

  it('rollout flags default values do not change existing behavior', () => {
    const service = new ConfigService();
    const config = service.get();

    // All rollout flags should be at their safe defaults
    expect(config.structuredVerificationMode).toBeUndefined();
    expect(config.unifiedDispatchEnabled).toBeUndefined();
    expect(config.strictTaskTransitionsEnabled).toBeUndefined();

    // Accessors should return safe backward-compatible defaults
    expect(service.getStructuredVerificationMode()).toBe('compat');
    expect(service.isUnifiedDispatchEnabled()).toBe(true);
    expect(service.isStrictTaskTransitionsEnabled()).toBe(false);
  });

  it('set() persists and returns rollout flag updates', () => {
    const service = new ConfigService();
    service.set({
      structuredVerificationMode: 'enforce',
      unifiedDispatchEnabled: true,
      strictTaskTransitionsEnabled: true,
    });

    expect(service.getStructuredVerificationMode()).toBe('enforce');
    expect(service.isUnifiedDispatchEnabled()).toBe(true);
    expect(service.isStrictTaskTransitionsEnabled()).toBe(true);
  });
});

describe('ConfigService.getWorkflowGatesMode', () => {
  it("returns 'warn' when not configured", () => {
    const service = new ConfigService();
    expect(service.getWorkflowGatesMode()).toBe('warn');
  });

  it("returns 'enforce' when config sets enforce", () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ workflowGatesMode: 'enforce' }));
    const svc = new ConfigService();
    expect(svc.getWorkflowGatesMode()).toBe('enforce');
  });

  it("returns 'warn' for invalid values", () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ workflowGatesMode: 'invalid' }));
    const svc = new ConfigService();
    expect(svc.getWorkflowGatesMode()).toBe('warn');
  });

  it('falls back to env var when config not set', () => {
    const saved = process.env.WARCRAFT_WORKFLOW_GATES_MODE;
    try {
      process.env.WARCRAFT_WORKFLOW_GATES_MODE = 'enforce';
      const service = new ConfigService();
      expect(service.getWorkflowGatesMode()).toBe('enforce');
    } finally {
      if (saved === undefined) {
        delete process.env.WARCRAFT_WORKFLOW_GATES_MODE;
      } else {
        process.env.WARCRAFT_WORKFLOW_GATES_MODE = saved;
      }
    }
  });
});

describe('ConfigService.isUnifiedDispatchEnabled', () => {
  it('always returns true when config is missing', () => {
    const service = new ConfigService();
    expect(service.isUnifiedDispatchEnabled()).toBe(true);
  });

  it('returns true when explicitly set in config', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ unifiedDispatchEnabled: true }));
    const svc = new ConfigService();
    expect(svc.isUnifiedDispatchEnabled()).toBe(true);
  });

  it('returns true regardless of config value', () => {
    const service = new ConfigService();
    const configPath = service.getPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    for (const value of [false, 'yes', null]) {
      fs.writeFileSync(configPath, JSON.stringify({ unifiedDispatchEnabled: value }));
      const svc = new ConfigService();
      expect(svc.isUnifiedDispatchEnabled()).toBe(true);
    }
  });
});
