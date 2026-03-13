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
  return source.slice(openBacktick + 1, closeBacktick).replaceAll('\\`', '`');
}

describe('System workflow delegation audit', () => {
  it('documents the top-level workflow with an explicit returned task() call after warcraft_worktree_create', () => {
    const systemPrompt = extractSystemPrompt(indexSource);
    expect(systemPrompt).toContain('warcraft_worktree_create(task)');
    expect(systemPrompt).toMatch(/warcraft_worktree_create\(task\).*task\(\).*warcraft_worktree_commit/s);
    expect(systemPrompt).not.toContain(
      'warcraft_worktree_create(task)` → work in worktree → `warcraft_worktree_commit(task, summary)',
    );
  });
});
