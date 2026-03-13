import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';
import { warcraftAgents } from '../packages/opencode-warcraft/src/agents/index.js';
import { saurfangAgent } from '../packages/opencode-warcraft/src/agents/saurfang.js';

const PLUGIN_CONFIG_PATH = path.resolve(
  import.meta.dir,
  '..',
  'packages',
  'opencode-warcraft',
  'src',
  'plugin-config.ts',
);
const pluginConfigSource = readFileSync(PLUGIN_CONFIG_PATH, 'utf-8');

describe('Saurfang description audit', () => {
  it('does not describe Saurfang as spawning workers directly in agent metadata or registry', () => {
    expect(saurfangAgent.description.toLowerCase()).not.toContain('spawns workers');
    expect(warcraftAgents.saurfang.description.toLowerCase()).not.toContain('spawns workers');
  });

  it('does not describe Saurfang as spawning workers directly in plugin-config agent registration', () => {
    expect(pluginConfigSource.toLowerCase()).not.toContain('delegates, spawns workers, verifies, merges');
  });
});
