import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { ContextService } from './contextService.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWarcraftPath } from '../utils/paths.js';

describe('ContextService integration', () => {
  let tempDir: string;
  let service: ContextService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-int-'));
    const provider = { getBeadsMode: () => 'off' as const };
    service = new ContextService(tempDir, provider);
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('write then read round-trip', () => {
    service.write('feat', 'decisions', '# Decisions\n\n- Use TypeScript');
    const content = service.read('feat', 'decisions');
    expect(content).toContain('Decisions');
    expect(content).toContain('TypeScript');
  });

  it('multiple context files for same feature', () => {
    service.write('feat', 'decisions', 'Decision content');
    service.write('feat', 'learnings', 'Learning content');
    service.write('feat', 'architecture', 'Arch content');

    const files = service.list('feat');
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it('read non-existent returns null', () => {
    expect(service.read('feat', 'ghost')).toBeNull();
  });

  it('list empty feature returns empty', () => {
    const files = service.list('empty-feat');
    expect(files).toEqual([]);
  });

  it('overwrite replaces content', () => {
    service.write('feat', 'notes', 'Version 1');
    service.write('feat', 'notes', 'Version 2');
    const content = service.read('feat', 'notes');
    expect(content).toContain('Version 2');
    expect(content).not.toContain('Version 1');
  });

  it('context is feature-scoped', () => {
    service.write('feat-a', 'notes', 'A notes');
    service.write('feat-b', 'notes', 'B notes');
    expect(service.read('feat-a', 'notes')).toContain('A');
    expect(service.read('feat-b', 'notes')).toContain('B');
  });

  it('list returns ContextFile objects', () => {
    service.write('feat', 'a', 'Content A');
    service.write('feat', 'b', 'Content B');
    const files = service.list('feat');
    const names = files.map((f) => f.name);
    expect(names).toContain('a');
    expect(names).toContain('b');
  });

  it('list for empty feature returns empty array', () => {
    expect(service.list('empty')).toEqual([]);
  });

  it('large content preserved', () => {
    const big = 'x'.repeat(100000);
    service.write('feat', 'big', big);
    const read = service.read('feat', 'big');
    expect(read).toBe(big);
  });

  it('special characters in content', () => {
    const special = '# Title\n\n```ts\nconst x = 42;\n```\n\n| Col | Val |\n|-----|-----|\n| A   | 1   |\n';
    service.write('feat', 'code', special);
    expect(service.read('feat', 'code')).toBe(special);
  });
});
