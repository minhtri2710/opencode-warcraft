import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { ContextService } from './contextService.js';

const mockBeadsModeOff = {
  getBeadsMode: () => 'off' as const,
};

const TEST_DIR = `/tmp/warcraft-contextservice-extra-${process.pid}`;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
}

function setupFeature(name: string): void {
  fs.mkdirSync(path.join(TEST_DIR, 'docs', name), { recursive: true });
  fs.writeFileSync(
    path.join(TEST_DIR, 'docs', name, 'feature.json'),
    JSON.stringify({ name, status: 'planning' }),
  );
}

describe('ContextService beadsMode off', () => {
  let service: ContextService;

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    service = new ContextService(TEST_DIR, mockBeadsModeOff);
  });

  afterEach(cleanup);

  it('writes and reads context in docs/<feature>/context/', () => {
    setupFeature('off-feature');
    service.write('off-feature', 'notes', 'Some notes');
    const content = service.read('off-feature', 'notes');
    expect(content).toBe('Some notes');
  });

  it('normalizes filenames by stripping .md extension', () => {
    setupFeature('norm-feature');
    service.write('norm-feature', 'notes.md', 'Content');
    // The .md extension should be stripped and re-added internally
    const content = service.read('norm-feature', 'notes');
    expect(content).toBe('Content');
  });

  it('read returns null for non-existent context file', () => {
    setupFeature('empty-feature');
    expect(service.read('empty-feature', 'nonexistent')).toBeNull();
  });

  it('list returns empty for feature with no context directory', () => {
    setupFeature('no-context');
    expect(service.list('no-context')).toEqual([]);
  });

  it('compile returns empty string for feature with no context files', () => {
    setupFeature('no-compile');
    expect(service.compile('no-compile')).toBe('');
  });

  it('delete returns false for non-existent file', () => {
    setupFeature('delete-test');
    expect(service.delete('delete-test', 'ghost')).toBe(false);
  });

  it('delete returns true and removes the file', () => {
    setupFeature('delete-real');
    service.write('delete-real', 'temp', 'Temporary');
    expect(service.delete('delete-real', 'temp')).toBe(true);
    expect(service.read('delete-real', 'temp')).toBeNull();
  });

  it('stats handles single file', () => {
    setupFeature('single-stats');
    service.write('single-stats', 'only', 'Content here');
    const stats = service.stats('single-stats');
    expect(stats.count).toBe(1);
    expect(stats.totalChars).toBe('Content here'.length);
    expect(stats.oldest).toBe('only');
    expect(stats.newest).toBe('only');
  });
});
