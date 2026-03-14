import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigService } from './configService.js';

let tempHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'config-more-'));
  process.env.HOME = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(tempHome, { recursive: true, force: true });
});

function writeConfig(data: Record<string, unknown>): void {
  const service = new ConfigService();
  const configDir = path.dirname(service.getPath());
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(service.getPath(), JSON.stringify(data));
}

describe('ConfigService more edge cases', () => {
  it('getPath returns a path ending with .json', () => {
    const service = new ConfigService();
    expect(service.getPath()).toMatch(/\.json$/);
  });

  it('getPath contains opencode in path', () => {
    const service = new ConfigService();
    expect(service.getPath()).toContain('opencode');
  });

  it('set creates config directory if it does not exist', () => {
    const service = new ConfigService();
    service.set({ agentMode: 'dedicated' });
    expect(fs.existsSync(service.getPath())).toBe(true);
  });

  it('set returns merged config', () => {
    const service = new ConfigService();
    const result = service.set({ agentMode: 'dedicated' });
    expect(result.agentMode).toBe('dedicated');
    expect(result.beadsMode).toBe('on'); // default preserved
  });

  it('multiple set calls merge correctly', () => {
    const service = new ConfigService();
    service.set({ agentMode: 'dedicated' });
    const result = service.set({ beadsMode: 'off' });
    expect(result.agentMode).toBe('dedicated');
    expect(result.beadsMode).toBe('off');
  });

  it('set with empty object preserves defaults', () => {
    const service = new ConfigService();
    const result = service.set({});
    expect(result.agentMode).toBe('unified');
    expect(result.beadsMode).toBe('on');
  });

  it('getAgentConfig returns model for all agents', () => {
    const service = new ConfigService();
    const agents = ['khadgar', 'mimiron', 'saurfang', 'brann', 'mekkatorque', 'algalon'] as const;
    for (const agent of agents) {
      const config = service.getAgentConfig(agent);
      expect(config.model).toBeDefined();
      expect(typeof config.model).toBe('string');
    }
  });

  it('getHookCadence returns 1 for null cadence value', () => {
    writeConfig({ hook_cadence: { 'my.hook': null } });
    const service = new ConfigService();
    expect(service.getHookCadence('my.hook')).toBe(1);
  });

  it('getBeadsMode returns on for null config value', () => {
    writeConfig({ beadsMode: null });
    const service = new ConfigService();
    expect(service.getBeadsMode()).toBe('on');
  });

  it('isOmoSlimEnabled returns false for null', () => {
    writeConfig({ omoSlimEnabled: null });
    const service = new ConfigService();
    expect(service.isOmoSlimEnabled()).toBe(false);
  });

  it('getDisabledSkills returns configured list', () => {
    writeConfig({ disableSkills: ['skill-a', 'skill-b'] });
    const service = new ConfigService();
    expect(service.getDisabledSkills()).toEqual(['skill-a', 'skill-b']);
  });

  it('getDisabledMcps returns configured list', () => {
    writeConfig({ disableMcps: ['mcp-a'] });
    const service = new ConfigService();
    expect(service.getDisabledMcps()).toEqual(['mcp-a']);
  });
});
