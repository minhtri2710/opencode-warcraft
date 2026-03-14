import { describe, expect, it } from 'bun:test';
import { ConfigService } from './configService.js';
import { createNoopLogger } from '../utils/logger.js';
import { DEFAULT_WARCRAFT_CONFIG } from '../defaults.js';
import type { WarcraftConfig } from '../types.js';

describe('configService property validation', () => {
  const service = new ConfigService(createNoopLogger());
  const config = service.get();

  it('beadsMode is on or off', () => {
    expect(['on', 'off']).toContain(config.beadsMode);
  });

  it('sandbox is valid value', () => {
    expect(['docker', 'none', 'auto']).toContain(config.sandbox);
  });

  it('agents is an object', () => {
    expect(typeof config.agents).toBe('object');
  });

  it('each agent has model string', () => {
    for (const [name, agentConfig] of Object.entries(config.agents || {})) {
      expect(typeof agentConfig!.model).toBe('string');
      expect(agentConfig!.model.length).toBeGreaterThan(0);
    }
  });

  it('each agent has temperature number', () => {
    for (const [name, agentConfig] of Object.entries(config.agents || {})) {
      expect(typeof agentConfig!.temperature).toBe('number');
    }
  });

  it('parallelExecution has strategy', () => {
    if (config.parallelExecution) {
      expect(typeof config.parallelExecution.strategy).toBe('string');
    }
  });

  it('config is frozen (same reference)', () => {
    expect(service.get()).toBe(config);
  });

  it('DEFAULT_WARCRAFT_CONFIG has same keys as service config', () => {
    const defaultKeys = Object.keys(DEFAULT_WARCRAFT_CONFIG).sort();
    const serviceKeys = Object.keys(config).sort();
    // Service config may have more keys from file, but should have at least defaults
    for (const key of defaultKeys) {
      expect(config).toHaveProperty(key);
    }
  });

  it('config path is absolute', () => {
    expect(service.getPath().startsWith('/')).toBe(true);
  });

  it('config path ends with .json', () => {
    expect(service.getPath().endsWith('.json')).toBe(true);
  });

  it('6 agents configured', () => {
    expect(Object.keys(config.agents || {}).length).toBe(6);
  });

  it('expected agents present', () => {
    const agents = Object.keys(config.agents || {});
    expect(agents).toContain('khadgar');
    expect(agents).toContain('mimiron');
    expect(agents).toContain('saurfang');
    expect(agents).toContain('brann');
    expect(agents).toContain('mekkatorque');
    expect(agents).toContain('algalon');
  });
});
