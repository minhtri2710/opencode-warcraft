import type { WarcraftConfig } from './types.js';

/** Default models for Warcraft agents */
export const DEFAULT_AGENT_MODELS = {
  khadgar: 'openai/gpt-5.3-codex',
  mimiron: 'openai/gpt-5.3-codex',
  saurfang: 'openai/gpt-5.3-codex',
  brann: 'google/gemini-3-flash-preview',
  mekkatorque: 'kimi-for-coding/k2p5',
  algalon: 'zai-coding-plan/glm-4.7',
} as const;

export const DEFAULT_WARCRAFT_CONFIG: WarcraftConfig = {
  $schema:
    'https://raw.githubusercontent.com/minhtri2710/opencode-warcraft/main/packages/opencode-warcraft/schema/opencode_warcraft.schema.json',
  enableToolsFor: [],
  disableSkills: [],
  disableMcps: [],
  agentMode: 'unified',
  sandbox: 'none',
  beadsMode: 'on',
  parallelExecution: {
    strategy: 'unbounded',
    maxConcurrency: 4,
  },
  agents: {
    khadgar: {
      model: DEFAULT_AGENT_MODELS.khadgar,
      temperature: 0.3,
      skills: ['brainstorming', 'writing-plans', 'dispatching-parallel-agents', 'executing-plans'],
      autoLoadSkills: ['parallel-exploration'],
    },
    mimiron: {
      model: DEFAULT_AGENT_MODELS.mimiron,
      temperature: 0.2,
      skills: ['brainstorming', 'writing-plans'],
      autoLoadSkills: ['parallel-exploration'],
    },
    saurfang: {
      model: DEFAULT_AGENT_MODELS.saurfang,
      temperature: 0.2,
      skills: ['dispatching-parallel-agents', 'executing-plans'],
      autoLoadSkills: [],
    },
    brann: {
      model: DEFAULT_AGENT_MODELS.brann,
      temperature: 0.7,
      skills: [],
      autoLoadSkills: [],
    },
    mekkatorque: {
      model: DEFAULT_AGENT_MODELS.mekkatorque,
      temperature: 0.4,
      autoLoadSkills: ['test-driven-development', 'verification-before-completion'],
    },
    algalon: {
      model: DEFAULT_AGENT_MODELS.algalon,
      temperature: 0.5,
      skills: ['systematic-debugging', 'code-reviewer'],
      autoLoadSkills: [],
    },
  },
};
