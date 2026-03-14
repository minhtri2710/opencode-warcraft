/**
 * Fresh-eye audit: index.test.ts registration test must check for the correct
 * number of warcraft tools (19, not 18) and must include warcraft_doctor.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';

const TEST_PATH = path.resolve(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'index.test.ts');
const testSource = readFileSync(TEST_PATH, 'utf-8');

describe('index.test.ts tool count accuracy audit', () => {
  it('should claim 19 warcraft tools, not 18', () => {
    // The registration test title should match the actual tool count
    expect(testSource).toMatch(/should have all 19 warcraft tools registered/);
  });

  it('should check warcraft_doctor is defined', () => {
    expect(testSource).toContain('warcraft_doctor');
  });
});
