import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('quickstart.md merge description accuracy', () => {
  const content = readFileSync(join(import.meta.dir, '..', 'docs', 'quickstart.md'), 'utf-8');

  it('should not unconditionally say "Merges the task branch"', () => {
    expect(content).not.toMatch(/Merges the task branch into the main branch/);
  });

  it('should describe merge as integrating completed work', () => {
    expect(content).toContain('Integrates completed task work');
  });
});
