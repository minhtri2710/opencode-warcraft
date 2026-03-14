import { describe, expect, it } from 'bun:test';
import { DEFAULT_WARCRAFT_CONFIG, DEFAULT_AGENT_MODELS } from './defaults.js';

describe('defaults agent integrity', () => {
  it('all agent models have provider/model format', () => {
    for (const [name, model] of Object.entries(DEFAULT_AGENT_MODELS)) {
      expect(model).toContain('/');
      const [provider, modelName] = model.split('/');
      expect(provider.length).toBeGreaterThan(0);
      expect(modelName.length).toBeGreaterThan(0);
    }
  });

  it('config agents match DEFAULT_AGENT_MODELS keys', () => {
    const configAgents = Object.keys(DEFAULT_WARCRAFT_CONFIG.agents || {});
    const modelAgents = Object.keys(DEFAULT_AGENT_MODELS);
    expect(new Set(configAgents)).toEqual(new Set(modelAgents));
  });

  it('config has sandbox setting', () => {
    expect(DEFAULT_WARCRAFT_CONFIG.sandbox).toBeDefined();
  });
});
