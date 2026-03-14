/**
 * Fresh-eye audit: tool-permissions.ts WARCRAFT_TOOL_IDS must include every
 * warcraft_* tool registered at runtime in index.ts, so the per-agent
 * permission system covers every tool. A missing entry means the tool
 * bypasses allow/deny enforcement entirely.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';
import { WARCRAFT_TOOL_IDS } from '../packages/opencode-warcraft/src/agents/tool-permissions.js';

const INDEX_PATH = path.resolve(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'index.ts');
const indexSource = readFileSync(INDEX_PATH, 'utf-8');

/** Extract all warcraft_* keys from the `tool: { ... }` registration block. */
function extractRuntimeTools(source: string): string[] {
  const toolBlockMatch = source.match(/\btool:\s*\{([\s\S]*?)\n\s{4}\}/);
  if (!toolBlockMatch) return [];
  const block = toolBlockMatch[1];
  const tools: string[] = [];
  for (const m of block.matchAll(/\b(warcraft_\w+)\s*:/g)) {
    tools.push(m[1]);
  }
  return tools.sort();
}

describe('tool-permissions WARCRAFT_TOOL_IDS completeness audit', () => {
  const runtimeTools = extractRuntimeTools(indexSource);
  const permissionTools = [...WARCRAFT_TOOL_IDS].sort();

  it('WARCRAFT_TOOL_IDS should include every runtime-registered warcraft tool', () => {
    const missing = runtimeTools.filter((t) => !permissionTools.includes(t));
    expect(missing).toEqual([]);
  });

  it('WARCRAFT_TOOL_IDS should not contain stale tools not registered at runtime', () => {
    const stale = permissionTools.filter((t) => !runtimeTools.includes(t));
    expect(stale).toEqual([]);
  });
});
