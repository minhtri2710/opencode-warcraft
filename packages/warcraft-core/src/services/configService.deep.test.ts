import { describe, expect, it } from 'bun:test';
import { ConfigService } from './configService.js';
import { createNoopLogger, createConsoleLogger } from '../utils/logger.js';

describe('configService deep', () => {
  it('get with default logger returns valid config', () => {
    const service = new ConfigService();
    const config = service.get();
    expect(config).toBeDefined();
    expect(typeof config).toBe('object');
  });

  it('get returns config with agents', () => {
    const config = new ConfigService(createNoopLogger()).get();
    expect(config.agents || config.beadsMode).toBeDefined();
  });

  it('getPath ends with .json', () => {
    expect(new ConfigService(createNoopLogger()).getPath()).toMatch(/\.json$/);
  });

  it('getPath contains config dir', () => {
    expect(new ConfigService(createNoopLogger()).getPath()).toContain('.config');
  });

  it('multiple get calls return same object', () => {
    const service = new ConfigService(createNoopLogger());
    expect(service.get()).toBe(service.get());
  });

  it('different service instances return equal configs', () => {
    const s1 = new ConfigService(createNoopLogger());
    const s2 = new ConfigService(createNoopLogger());
    expect(JSON.stringify(s1.get())).toBe(JSON.stringify(s2.get()));
  });

  it('config beadsMode is string', () => {
    const config = new ConfigService(createNoopLogger()).get();
    expect(typeof config.beadsMode).toBe('string');
  });

  it('config sandbox is string', () => {
    const config = new ConfigService(createNoopLogger()).get();
    expect(typeof config.sandbox).toBe('string');
  });

  it('console logger does not change behavior', () => {
    const service = new ConfigService(createConsoleLogger({ minLevel: 'error' }));
    const config = service.get();
    expect(config).toBeDefined();
  });

  it('getPath is absolute path', () => {
    const p = new ConfigService(createNoopLogger()).getPath();
    expect(p.startsWith('/')).toBe(true);
  });

  it('config has no undefined required fields', () => {
    const config = new ConfigService(createNoopLogger()).get();
    expect(config.beadsMode).not.toBeUndefined();
  });

  it('config parallelExecution has strategy', () => {
    const config = new ConfigService(createNoopLogger()).get();
    if (config.parallelExecution) {
      expect(config.parallelExecution.strategy).toBeDefined();
    }
  });
});
