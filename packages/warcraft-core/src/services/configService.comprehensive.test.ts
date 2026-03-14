import { describe, expect, it } from 'bun:test';
import { createNoopLogger } from '../utils/logger.js';
import { ConfigService } from './configService.js';

describe('configService comprehensive', () => {
  it('constructor with noop logger', () => {
    const service = new ConfigService(createNoopLogger());
    expect(service).toBeDefined();
  });

  it('constructor with default logger', () => {
    const service = new ConfigService();
    expect(service).toBeDefined();
  });

  it('getPath returns a string', () => {
    const service = new ConfigService(createNoopLogger());
    const path = service.getPath();
    expect(typeof path).toBe('string');
    expect(path.length).toBeGreaterThan(0);
  });

  it('getPath includes opencode_warcraft.json', () => {
    const service = new ConfigService(createNoopLogger());
    expect(service.getPath()).toContain('opencode_warcraft.json');
  });

  it('get returns a config object', () => {
    const service = new ConfigService(createNoopLogger());
    const config = service.get();
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });

  it('get returns config with beadsMode', () => {
    const service = new ConfigService(createNoopLogger());
    const config = service.get();
    expect(config.beadsMode).toBeDefined();
  });

  it('get returns same instance (cached)', () => {
    const service = new ConfigService(createNoopLogger());
    const c1 = service.get();
    const c2 = service.get();
    expect(c1).toBe(c2);
  });
});
