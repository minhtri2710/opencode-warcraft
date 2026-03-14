/**
 * Fresh-eye audit: the system prompt's Workflow quick-reference section says
 * "Merge task branch into main" and "commits changes to task branch" but
 * in direct mode there is no task branch. These should be mode-neutral.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';

const INDEX_PATH = path.resolve(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'index.ts');
const indexSource = readFileSync(INDEX_PATH, 'utf-8');

/** Extract the WARCRAFT_SYSTEM_PROMPT template literal from index.ts. */
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

const systemPrompt = extractSystemPrompt(indexSource);

describe('system prompt workflow section branch claims audit', () => {
  it('should not unconditionally say "Merge task branch into main"', () => {
    // The workflow step for merge should not claim a branch merge unconditionally
    const workflowSection = systemPrompt.slice(
      systemPrompt.indexOf('### Workflow'),
      systemPrompt.indexOf('### Delegated'),
    );
    expect(workflowSection).not.toMatch(/Merge task branch into main/i);
  });

  it('should not unconditionally say "commits changes to task branch"', () => {
    const workflowSection = systemPrompt.slice(
      systemPrompt.indexOf('### Workflow'),
      systemPrompt.indexOf('### Delegated'),
    );
    expect(workflowSection).not.toMatch(/commits changes to task branch/i);
  });
});
