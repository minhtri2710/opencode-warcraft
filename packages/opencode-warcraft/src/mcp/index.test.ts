import { describe, expect, it } from 'bun:test';
import { createBuiltinMcps } from './index.js';

describe('createBuiltinMcps', () => {
  it('returns only websearch and grep_app providers', () => {
    const mcps = createBuiltinMcps();
    const keys = Object.keys(mcps).sort();
    expect(keys).toEqual(['grep_app', 'websearch']);
  });

  it('does not include context7', () => {
    const mcps = createBuiltinMcps();
    expect(mcps).not.toHaveProperty('context7');
  });

  it('filters disabled providers', () => {
    const mcps = createBuiltinMcps(['websearch']);
    expect(mcps).not.toHaveProperty('websearch');
    expect(mcps).toHaveProperty('grep_app');
  });
});
