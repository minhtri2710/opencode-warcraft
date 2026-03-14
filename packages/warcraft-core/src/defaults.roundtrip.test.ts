import { describe, expect, it } from 'bun:test';
import { DEFAULT_AGENT_MODELS, DEFAULT_WARCRAFT_CONFIG } from './defaults.js';
import type { AgentModelConfig, WarcraftConfig } from './types.js';

describe('defaults and types round-trip', () => {
  it('DEFAULT_WARCRAFT_CONFIG is valid WarcraftConfig', () => {
    const config: WarcraftConfig = DEFAULT_WARCRAFT_CONFIG;
    expect(config).toBeDefined();
  });

  it('each default agent model is a non-empty string', () => {
    const models = DEFAULT_AGENT_MODELS;
    for (const [_agent, model] of Object.entries(models)) {
      expect(model.length).toBeGreaterThan(0);
      expect(model).toContain('/');
    }
  });

  it('config agents map to AgentModelConfig', () => {
    const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
    for (const [_name, config] of Object.entries(agents)) {
      const agentConfig: AgentModelConfig = config!;
      expect(agentConfig.model).toBeDefined();
    }
  });

  it('all 6 agent names present', () => {
    const names = Object.keys(DEFAULT_AGENT_MODELS);
    expect(names).toContain('khadgar');
    expect(names).toContain('mimiron');
    expect(names).toContain('saurfang');
    expect(names).toContain('brann');
    expect(names).toContain('mekkatorque');
    expect(names).toContain('algalon');
  });

  it('agent configs have temperature', () => {
    const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
    for (const config of Object.values(agents)) {
      expect(typeof config!.temperature).toBe('number');
      expect(config!.temperature).toBeGreaterThanOrEqual(0);
      expect(config!.temperature).toBeLessThanOrEqual(2);
    }
  });
});
