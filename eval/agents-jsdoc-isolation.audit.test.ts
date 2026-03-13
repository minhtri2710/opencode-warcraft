/**
 * Fresh-eye audit: The top-level agents/index.ts JSDoc character model
 * should not describe Mekkatorque as executing "in isolation" since direct
 * mode does not provide filesystem isolation.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const INDEX_PATH = join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'agents', 'index.ts');

const source = readFileSync(INDEX_PATH, 'utf-8');

describe('agents/index.ts character model JSDoc audit', () => {
  it('should not claim Mekkatorque executes "in isolation" unconditionally', () => {
    // The JSDoc character model says "Executes tasks in isolation" but direct
    // mode does not provide filesystem isolation.
    const jsdocBlock = source.slice(source.indexOf('Mekkatorque (Worker'), source.indexOf('Mekkatorque (Worker') + 100);
    expect(jsdocBlock).not.toMatch(/in isolation/i);
  });
});
