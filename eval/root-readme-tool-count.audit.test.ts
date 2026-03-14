import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';

describe('Root README.md tool count audit', () => {
  const readmeSrc = readFileSync('README.md', 'utf-8');

  it('should not claim 17 tools', () => {
    expect(readmeSrc).not.toMatch(/17 (custom )?tools/);
  });

  it('should not claim 18 tools', () => {
    expect(readmeSrc).not.toMatch(/18 (custom )?tools/);
  });
});
