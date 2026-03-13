import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';
import { warcraftAgents } from '../packages/opencode-warcraft/src/agents/index.js';

const PLUGIN_CONFIG_PATH = path.resolve(
  import.meta.dir,
  '..',
  'packages',
  'opencode-warcraft',
  'src',
  'plugin-config.ts',
);
const pluginConfigSource = readFileSync(PLUGIN_CONFIG_PATH, 'utf-8').toLowerCase();

describe('Mekkatorque description audit', () => {
  it('does not describe Mekkatorque as always running in isolated worktrees', () => {
    expect(warcraftAgents.mekkatorque.description.toLowerCase()).not.toContain('isolated worktrees');
  });

  it('does not describe plugin-config Mekkatorque registration as always running in isolated worktrees', () => {
    expect(pluginConfigSource).not.toContain('executes tasks directly in isolated worktrees');
  });
});
