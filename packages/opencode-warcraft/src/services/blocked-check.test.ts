import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { createCheckBlocked } from './blocked-check.js';

// ============================================================================
// Test helpers
// ============================================================================

const TEST_DIR = `/tmp/opencode-warcraft-blocked-check-test-${process.pid}`;

function cleanup(): void {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function ensureFeatureDir(feature: string): string {
  const featureDir = path.join(TEST_DIR, 'docs', feature);
  fs.mkdirSync(featureDir, { recursive: true });
  return featureDir;
}

describe('createCheckBlocked', () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(cleanup);

  it('returns blocked: false when BLOCKED file does not exist', () => {
    ensureFeatureDir('my-feature');
    const getPath = (feature: string) => path.join(TEST_DIR, 'docs', feature);
    const checkBlocked = createCheckBlocked(getPath);
    const result = checkBlocked('my-feature');
    expect(result.blocked).toBe(false);
  });

  it('returns blocked: true with reason when BLOCKED file exists', () => {
    const featureDir = ensureFeatureDir('blocked-feature');
    fs.writeFileSync(path.join(featureDir, 'BLOCKED'), 'Waiting for API approval');
    const getPath = (feature: string) => path.join(TEST_DIR, 'docs', feature);
    const checkBlocked = createCheckBlocked(getPath);
    const result = checkBlocked('blocked-feature');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('Waiting for API approval');
    expect(result.message).toContain('BLOCKED by Commander');
    expect(result.message).toContain('Waiting for API approval');
    expect(result.blockedPath).toContain('BLOCKED');
  });

  it('returns reason "(No reason provided)" for empty BLOCKED file', () => {
    const featureDir = ensureFeatureDir('empty-blocked');
    fs.writeFileSync(path.join(featureDir, 'BLOCKED'), '');
    const getPath = (feature: string) => path.join(TEST_DIR, 'docs', feature);
    const checkBlocked = createCheckBlocked(getPath);
    const result = checkBlocked('empty-blocked');

    expect(result.blocked).toBe(true);
    expect(result.message).toContain('(No reason provided)');
  });

  it('trims whitespace from BLOCKED file content', () => {
    const featureDir = ensureFeatureDir('trimmed-feature');
    fs.writeFileSync(path.join(featureDir, 'BLOCKED'), '  needs review  \n');
    const getPath = (feature: string) => path.join(TEST_DIR, 'docs', feature);
    const checkBlocked = createCheckBlocked(getPath);
    const result = checkBlocked('trimmed-feature');

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('needs review');
  });

  it('includes blockedPath in result', () => {
    const featureDir = ensureFeatureDir('path-feature');
    fs.writeFileSync(path.join(featureDir, 'BLOCKED'), 'reason');
    const getPath = (feature: string) => path.join(TEST_DIR, 'docs', feature);
    const checkBlocked = createCheckBlocked(getPath);
    const result = checkBlocked('path-feature');

    expect(result.blockedPath).toBe(path.join(TEST_DIR, 'docs', 'path-feature', 'BLOCKED'));
  });
});
