import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ConfigService } from "./configService";
import { DEFAULT_WARCRAFT_CONFIG, DEFAULT_AGENT_MODELS } from "../types";

let originalHome: string | undefined;
let tempHome: string;

const makeTempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "warcraft-home-"));

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

describe("ConfigService defaults", () => {
  it("returns DEFAULT_WARCRAFT_CONFIG when config is missing", () => {
    const service = new ConfigService();
    const config = service.get();

    expect(config).toEqual(DEFAULT_WARCRAFT_CONFIG);
    expect(Object.keys(config.agents ?? {}).sort()).toEqual([
      "algalon",
      "brann",
      "khadgar",
      "mekkatorque",
      "mimiron",
      "saurfang",
    ]);
    expect(config.agents?.["mimiron"]?.model).toBe(
      DEFAULT_AGENT_MODELS.mimiron,
    );
    expect(config.agents?.["khadgar"]?.model).toBe(
      DEFAULT_AGENT_MODELS.khadgar,
    );
    expect(config.agents?.["saurfang"]?.model).toBe(
      DEFAULT_AGENT_MODELS.saurfang,
    );
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

  it("returns default parallelExecution config", () => {
    const service = new ConfigService();
    const parallel = service.getParallelExecutionConfig();

    expect(parallel).toEqual({
      strategy: 'unbounded',
      maxConcurrency: 4,
    });
  });

  it("returns defaults and warns when config JSON is invalid", () => {
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

  it("deep-merges agent overrides with defaults", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: {
            "khadgar": { temperature: 0.8 },
          },
        },
        null,
        2,
      ),
    );

    const config = service.get();
    expect(config.agents?.["khadgar"]?.temperature).toBe(0.8);
    expect(config.agents?.["khadgar"]?.model).toBe(
      DEFAULT_AGENT_MODELS.khadgar,
    );

    const agentConfig = service.getAgentConfig("khadgar");
    expect(agentConfig.temperature).toBe(0.8);
    expect(agentConfig.model).toBe(DEFAULT_AGENT_MODELS.khadgar);
  });

  it("deep-merges variant field from user config", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: {
            "mekkatorque": { variant: "high" },
            "brann": { variant: "low", temperature: 0.2 },
          },
        },
        null,
        2,
      ),
    );

    const config = service.get();
    // variant should be merged from user config
    expect(config.agents?.["mekkatorque"]?.variant).toBe("high");
    expect(config.agents?.["brann"]?.variant).toBe("low");
    // other defaults should still be present
    expect(config.agents?.["mekkatorque"]?.model).toBe(
      DEFAULT_AGENT_MODELS.mekkatorque,
    );
    expect(config.agents?.["brann"]?.temperature).toBe(0.2);

    // getAgentConfig should also return variant
    const mekkatorqueConfig = service.getAgentConfig("mekkatorque");
    expect(mekkatorqueConfig.variant).toBe("high");
    expect(mekkatorqueConfig.model).toBe(DEFAULT_AGENT_MODELS.mekkatorque);

    const brannConfig = service.getAgentConfig("brann");
    expect(brannConfig.variant).toBe("low");
    expect(brannConfig.temperature).toBe(0.2);
  });

  it("merges autoLoadSkills defaults and overrides", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          agents: {
            "mekkatorque": {
              autoLoadSkills: ["custom-skill", "verification-before-completion"],
            },
          },
        },
        null,
        2,
      ),
    );

    const config = service.getAgentConfig("mekkatorque");
    expect(config.autoLoadSkills).toEqual([
      "test-driven-development",
      "verification-before-completion",
      "custom-skill",
    ]);
  });

  it("removes autoLoadSkills via disableSkills", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          disableSkills: ["parallel-exploration", "custom-skill"],
          agents: {
            "khadgar": {
              autoLoadSkills: ["custom-skill"],
            },
          },
        },
        null,
        2,
      ),
    );

    const config = service.getAgentConfig("khadgar");
    expect(config.autoLoadSkills).toEqual([]);
  });

  it("defaults have no variant set", () => {
    const service = new ConfigService();
    const config = service.get();

    // Default config should not have variant set for any agent
    for (const agentKey of Object.keys(config.agents ?? {})) {
      const agent = config.agents?.[agentKey as keyof typeof config.agents];
      expect(agent?.variant).toBeUndefined();
    }
  });

  it("brann autoLoadSkills does NOT include parallel-exploration", () => {
    // Brann should not auto-load parallel-exploration to prevent recursive delegation.
    // Brann is a leaf agent that should not spawn further Brann agents.
    const service = new ConfigService();
    const brannConfig = service.getAgentConfig("brann");

    expect(brannConfig.autoLoadSkills).not.toContain("parallel-exploration");
  });
});

describe("ConfigService disabled skills/mcps", () => {
  it("returns empty arrays when not configured", () => {
    const service = new ConfigService();
    expect(service.getDisabledSkills()).toEqual([]);
    expect(service.getDisabledMcps()).toEqual([]);
  });

  it("returns configured disabled skills", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        disableSkills: ["brainstorming", "writing-plans"],
      }),
    );

    expect(service.getDisabledSkills()).toEqual(["brainstorming", "writing-plans"]);
  });

  it("returns configured disabled MCPs", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        disableMcps: ["websearch", "grep_app"],
      }),
    );

    expect(service.getDisabledMcps()).toEqual(["websearch", "grep_app"]);
  });
});

describe("ConfigService set() merge behavior", () => {
  it("deep-merges nested agent config updates", () => {
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

  it("persists and returns beadsMode updates", () => {
    const service = new ConfigService();
    service.set({ beadsMode: 'off' });

    expect(service.getBeadsMode()).toBe('off');
    expect(service.get().beadsMode).toBe('off');
  });

  it("deep-merges parallelExecution updates", () => {
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

  it("clamps invalid parallelExecution maxConcurrency values", () => {
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

describe("ConfigService beadsMode validation", () => {
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

    expect(() => service.getBeadsMode()).toThrow("Invalid beadsMode: 'dual-write'. Use \"on\" or \"off\". Legacy values \"dual-write\" and \"beads-primary\" are no longer supported.");
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

    expect(() => service.getBeadsMode()).toThrow("Invalid beadsMode: 'beads-primary'. Use \"on\" or \"off\". Legacy values \"dual-write\" and \"beads-primary\" are no longer supported.");
  });

  it("getBeadsMode() falls back to 'on' when beadsMode is missing", () => {
    const service = new ConfigService();
    const configPath = service.getPath();

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({}),
    );

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

  it("getBeadsMode() with boolean true enables full beads_rust workflow", () => {
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

describe("ConfigService sandbox config", () => {
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
