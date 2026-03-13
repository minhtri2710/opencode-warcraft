import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';

const INDEX_PATH = path.resolve(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'index.ts');
const indexSource = readFileSync(INDEX_PATH, 'utf-8');

function extractSystemPrompt(source: string): string {
  const marker = 'WARCRAFT_SYSTEM_PROMPT';
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) return '';
  const openBacktick = source.indexOf('`', markerIdx);
  if (openBacktick === -1) return '';
  const closeBacktick = source.indexOf('`;', openBacktick + 1);
  if (closeBacktick === -1) return '';
  return source.slice(openBacktick + 1, closeBacktick);
}

describe('Worktree delegation audit', () => {
  it('documents warcraft_worktree_create as returning a task() payload instead of auto-spawning a worker', () => {
    const systemPrompt = extractSystemPrompt(indexSource);

    expect(systemPrompt).toContain('returns the `task()` payload needed to launch the worker');
    expect(systemPrompt).toContain('Issue the returned `task()` call');
    expect(systemPrompt).toContain('After the returned task() call returns');
    expect(systemPrompt).not.toContain('creates worktree and spawns worker automatically');
  });
});
