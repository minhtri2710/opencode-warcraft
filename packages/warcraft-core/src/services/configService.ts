import * as os from 'os';
import * as fs from "fs";
import * as path from "path";
import { WarcraftConfig, DEFAULT_WARCRAFT_CONFIG } from "../types.js";
import type { BeadsMode } from "../types.js";
import type { ParallelExecutionConfig } from "../types.js";
import type { SandboxConfig } from "./dockerSandboxService.js";

/**
 * ConfigService manages user config at ~/.config/opencode/opencode_warcraft.json
 *
 * This is USER config (not project-scoped):
 * - OpenCode plugin reads this to enable features
 * - Agent does NOT have tools to access this
 */
export class ConfigService {
  private configPath: string;
  private cachedConfig: WarcraftConfig | null = null;

  constructor() {
    const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const configDir = path.join(homeDir, ".config", "opencode");
    this.configPath = path.join(configDir, "opencode_warcraft.json");
  }

  /**
   * Get config path
   */
  getPath(): string {
    return this.configPath;
  }

  /**
   * Get the full config, merged with defaults.
   */
  get(): WarcraftConfig {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }
    try {
      if (!fs.existsSync(this.configPath)) {
        const result = { ...DEFAULT_WARCRAFT_CONFIG };
        this.cachedConfig = result;
        return result;
      }
      const raw = fs.readFileSync(this.configPath, "utf-8");
      const stored = JSON.parse(raw) as Partial<WarcraftConfig>;
      const storedAgents = (stored.agents ?? {}) as Record<string, unknown>;
      const storedParallelExecution = (stored.parallelExecution ?? {}) as ParallelExecutionConfig;

      // Deep merge with defaults
      return {
        ...DEFAULT_WARCRAFT_CONFIG,
        ...stored,
        parallelExecution: {
          ...DEFAULT_WARCRAFT_CONFIG.parallelExecution,
          ...storedParallelExecution,
        },
        agents: {
          ...DEFAULT_WARCRAFT_CONFIG.agents,
          ...storedAgents,
          // Deep merge khadgar agent config
          khadgar: {
            ...DEFAULT_WARCRAFT_CONFIG.agents?.["khadgar"],
            ...(storedAgents["khadgar"] as
              | Record<string, unknown>
              | undefined),
          },
          // Deep merge mimiron agent config
          mimiron: {
            ...DEFAULT_WARCRAFT_CONFIG.agents?.["mimiron"],
            ...(storedAgents["mimiron"] as
              | Record<string, unknown>
              | undefined),
          },
          // Deep merge saurfang agent config
          saurfang: {
            ...DEFAULT_WARCRAFT_CONFIG.agents?.["saurfang"],
            ...(storedAgents["saurfang"] as
              | Record<string, unknown>
              | undefined),
          },
          // Deep merge brann agent config
          brann: {
            ...DEFAULT_WARCRAFT_CONFIG.agents?.["brann"],
            ...(storedAgents["brann"] as
              | Record<string, unknown>
              | undefined),
          },
          // Deep merge mekkatorque agent config
          mekkatorque: {
            ...DEFAULT_WARCRAFT_CONFIG.agents?.["mekkatorque"],
            ...(storedAgents["mekkatorque"] as
              | Record<string, unknown>
              | undefined),
          },
          // Deep merge algalon agent config
          algalon: {
            ...DEFAULT_WARCRAFT_CONFIG.agents?.["algalon"],
            ...(storedAgents["algalon"] as
              | Record<string, unknown>
              | undefined),
          },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[warcraft] Failed to read config at ${this.configPath}: ${message}`,
      );
      return { ...DEFAULT_WARCRAFT_CONFIG };
    }
  }

  /**
   * Update config (partial merge).
   */
  set(updates: Partial<WarcraftConfig>): WarcraftConfig {
    const current = this.get();

    const merged: WarcraftConfig = {
      ...current,
      ...updates,
      parallelExecution: {
        ...current.parallelExecution,
        ...updates.parallelExecution,
      },
      agents: this.mergeAgents(current.agents, updates.agents),
    };

    // Ensure config directory exists
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(this.configPath, JSON.stringify(merged, null, 2));
    // Clear cache so next get() reads the updated config
    this.cachedConfig = null;
    return merged;
  }

  /**
   * Check if config file exists.
   */
  exists(): boolean {
    return fs.existsSync(this.configPath);
  }

  /**
   * Initialize config with defaults if it doesn't exist.
   */
  init(): WarcraftConfig {
    if (!this.exists()) {
      return this.set(DEFAULT_WARCRAFT_CONFIG);
    }
    return this.get();
  }

  /**
   * Get agent-specific model config
   */
  getAgentConfig(
    agent:
      | "khadgar"
      | "mimiron"
      | "saurfang"
      | "brann"
      | "mekkatorque"
      | "algalon",
  ): {
    model?: string;
    temperature?: number;
    skills?: string[];
    autoLoadSkills?: string[];
    variant?: string;
  } {
    const config = this.get();
    const agentConfig = config.agents?.[agent] ?? {};
    const defaultAutoLoadSkills =
      DEFAULT_WARCRAFT_CONFIG.agents?.[agent]?.autoLoadSkills ?? [];
    const userAutoLoadSkills = agentConfig.autoLoadSkills ?? [];
    const isPlannerAgent = agent === "khadgar" || agent === "mimiron";
    const effectiveUserAutoLoadSkills = isPlannerAgent
      ? userAutoLoadSkills
      : userAutoLoadSkills.filter((skill) => skill !== "onboarding");
    const effectiveDefaultAutoLoadSkills = isPlannerAgent
      ? defaultAutoLoadSkills
      : defaultAutoLoadSkills.filter((skill) => skill !== "onboarding");
    const combinedAutoLoadSkills = [
      ...effectiveDefaultAutoLoadSkills,
      ...effectiveUserAutoLoadSkills,
    ];
    const uniqueAutoLoadSkills = Array.from(new Set(combinedAutoLoadSkills));
    const disabledSkills = config.disableSkills ?? [];
    const effectiveAutoLoadSkills = uniqueAutoLoadSkills.filter(
      (skill) => !disabledSkills.includes(skill),
    );

    return {
      ...agentConfig,
      autoLoadSkills: effectiveAutoLoadSkills,
    };
  }

  /**
   * Check if OMO-Slim delegation is enabled via user config.
   */
  isOmoSlimEnabled(): boolean {
    const config = this.get();
    return config.omoSlimEnabled === true;
  }

  /**
   * Get list of globally disabled skills.
   */
  getDisabledSkills(): string[] {
    const config = this.get();
    return config.disableSkills ?? [];
  }

  /**
   * Get list of globally disabled MCPs.
   */
  getDisabledMcps(): string[] {
    const config = this.get();
    return config.disableMcps ?? [];
  }

  /**
   * Get sandbox configuration for worker isolation.
   * Returns { mode: 'none' | 'docker', image?: string, persistent?: boolean }
   */
  getSandboxConfig(): SandboxConfig {
    const config = this.get();
    const mode = config.sandbox ?? "none";
    const image = config.dockerImage;
    const persistent = config.persistentContainers ?? mode === "docker";

    return { mode, ...(image && { image }), persistent };
  }

  /**
   * Get normalized parallel execution configuration.
   * - strategy defaults to 'unbounded'
   * - maxConcurrency is only meaningful for bounded strategy and is clamped to [1, 32]
   */
  getParallelExecutionConfig(): { strategy: 'unbounded' | 'bounded'; maxConcurrency: number } {
    const config = this.get();
    const raw = config.parallelExecution ?? {};
    const strategy = raw.strategy === 'bounded' ? 'bounded' : 'unbounded';

    const configuredMax = Number.isInteger(raw.maxConcurrency)
      ? (raw.maxConcurrency as number)
      : (DEFAULT_WARCRAFT_CONFIG.parallelExecution?.maxConcurrency ?? 4);
    const maxConcurrency = Math.min(32, Math.max(1, configuredMax));

    return {
      strategy,
      maxConcurrency,
    };
  }

  /**
   * Get beads rollout mode.
   * Normalizes boolean values to strings and validates against valid modes.
   * Rejects legacy strings (dual-write, beads-primary) with validation error.
   */
  getBeadsMode(): BeadsMode {
    const config = this.get();
    const raw = config.beadsMode;

    // Handle boolean values
    if (raw === true) {
      return "on";
    }
    if (raw === false) {
      return "off";
    }

    // Validate string values
    if (raw === "on" || raw === "off") {
      return raw;
    }

    // Reject legacy strings explicitly
    if (raw === "dual-write" || raw === "beads-primary") {
      throw new Error(
        `Invalid beadsMode: '${raw}'. Use "on" or "off". Legacy values "dual-write" and "beads-primary" are no longer supported.`
      );
    }

    // Default fallback for undefined, null, or invalid values
    return "on";
  }

  private mergeAgents(
    currentAgents: WarcraftConfig["agents"],
    updateAgents: WarcraftConfig["agents"] | undefined,
  ): WarcraftConfig["agents"] {
    if (!updateAgents) {
      return currentAgents;
    }

    return {
      ...currentAgents,
      ...updateAgents,
      khadgar: {
        ...currentAgents?.khadgar,
        ...updateAgents.khadgar,
      },
      mimiron: {
        ...currentAgents?.mimiron,
        ...updateAgents.mimiron,
      },
      saurfang: {
        ...currentAgents?.saurfang,
        ...updateAgents.saurfang,
      },
      brann: {
        ...currentAgents?.brann,
        ...updateAgents.brann,
      },
      mekkatorque: {
        ...currentAgents?.mekkatorque,
        ...updateAgents.mekkatorque,
      },
      algalon: {
        ...currentAgents?.algalon,
        ...updateAgents.algalon,
      },
    };
  }
}
