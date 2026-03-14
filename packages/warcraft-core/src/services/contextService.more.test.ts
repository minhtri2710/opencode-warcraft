import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { ContextService } from './contextService.js';

const mockBeadsModeOn = { getBeadsMode: () => 'on' as const };

const TEST_DIR = `/tmp/warcraft-ctxservice-more-${process.pid}`;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
}

function setupFeature(name: string): void {
  fs.mkdirSync(path.join(TEST_DIR, '.beads/artifacts', name), { recursive: true });
}

describe('ContextService more edge cases', () => {
  let service: ContextService;

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    service = new ContextService(TEST_DIR, mockBeadsModeOn);
  });

  afterEach(cleanup);

  it('write in replace mode overwrites existing content', () => {
    setupFeature('replace-test');
    service.write('replace-test', 'notes', 'First version');
    service.write('replace-test', 'notes', 'Second version');
    expect(service.read('replace-test', 'notes')).toBe('Second version');
  });

  it('compile joins multiple files with section separators', () => {
    setupFeature('compile-multi');
    service.write('compile-multi', 'alpha', 'Content A');
    service.write('compile-multi', 'beta', 'Content B');
    const compiled = service.compile('compile-multi');
    expect(compiled).toContain('## alpha');
    expect(compiled).toContain('## beta');
    expect(compiled).toContain('Content A');
    expect(compiled).toContain('Content B');
    expect(compiled).toContain('---');
  });

  it('list returns all written files', () => {
    setupFeature('list-test');
    service.write('list-test', 'charlie', 'C');
    service.write('list-test', 'alpha', 'A');
    service.write('list-test', 'bravo', 'B');
    const list = service.list('list-test');
    const names = list.map((f) => f.name).sort();
    expect(names).toEqual(['alpha', 'bravo', 'charlie']);
    expect(list).toHaveLength(3);
  });

  it('archive moves all files and leaves context empty', () => {
    setupFeature('archive-test');
    service.write('archive-test', 'notes', 'Notes');
    service.write('archive-test', 'decisions', 'Decisions');

    const result = service.archive('archive-test');
    expect(result.archived).toContain('notes');
    expect(result.archived).toContain('decisions');
    expect(service.list('archive-test')).toEqual([]);
  });

  it('stats returns correct totalChars across multiple files', () => {
    setupFeature('stats-multi');
    service.write('stats-multi', 'a', 'x'.repeat(100));
    service.write('stats-multi', 'b', 'y'.repeat(200));
    const stats = service.stats('stats-multi');
    expect(stats.count).toBe(2);
    expect(stats.totalChars).toBe(300);
  });

  it('write returns path without warning for small content', () => {
    setupFeature('no-warn');
    const result = service.write('no-warn', 'small', 'tiny');
    expect(result).not.toContain('⚠️');
    expect(result).toContain('.md');
  });

  it('delete non-existent file returns false', () => {
    setupFeature('no-delete');
    expect(service.delete('no-delete', 'ghost')).toBe(false);
  });

  it('read non-existent context returns null', () => {
    setupFeature('no-read');
    expect(service.read('no-read', 'ghost')).toBeNull();
  });
});
