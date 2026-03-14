import { describe, expect, it } from 'bun:test';
import * as warcraftCore from './index.js';

describe('index barrel exports more', () => {
  it('exports DEFAULT_AGENT_MODELS', () => {
    expect(warcraftCore.DEFAULT_AGENT_MODELS).toBeDefined();
  });

  it('exports DEFAULT_WARCRAFT_CONFIG', () => {
    expect(warcraftCore.DEFAULT_WARCRAFT_CONFIG).toBeDefined();
  });

  it('exports detectContext', () => {
    expect(typeof warcraftCore.detectContext).toBe('function');
  });

  it('exports findProjectRoot', () => {
    expect(typeof warcraftCore.findProjectRoot).toBe('function');
  });

  it('exports ensureDir', () => {
    expect(typeof warcraftCore.ensureDir).toBe('function');
  });

  it('exports fileExists', () => {
    expect(typeof warcraftCore.fileExists).toBe('function');
  });

  it('exports readJson', () => {
    expect(typeof warcraftCore.readJson).toBe('function');
  });

  it('exports writeJson', () => {
    expect(typeof warcraftCore.writeJson).toBe('function');
  });

  it('exports LOG_LEVELS', () => {
    expect(warcraftCore.LOG_LEVELS).toBeDefined();
  });

  it('exports createNoopLogger', () => {
    expect(typeof warcraftCore.createNoopLogger).toBe('function');
  });

  it('exports createConsoleLogger', () => {
    expect(typeof warcraftCore.createConsoleLogger).toBe('function');
  });

  it('exports sanitizeName', () => {
    expect(typeof warcraftCore.sanitizeName).toBe('function');
  });

  it('exports getWarcraftPath', () => {
    expect(typeof warcraftCore.getWarcraftPath).toBe('function');
  });

  it('exports shellQuoteArg', () => {
    expect(typeof warcraftCore.shellQuoteArg).toBe('function');
  });

  it('exports slugifyTaskName', () => {
    expect(typeof warcraftCore.slugifyTaskName).toBe('function');
  });

  it('exports ok', () => {
    expect(typeof warcraftCore.ok).toBe('function');
  });

  it('exports fatal', () => {
    expect(typeof warcraftCore.fatal).toBe('function');
  });

  it('exports isUsable', () => {
    expect(typeof warcraftCore.isUsable).toBe('function');
  });
});
