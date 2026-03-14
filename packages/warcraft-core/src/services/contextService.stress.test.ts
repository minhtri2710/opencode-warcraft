import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ContextService } from './contextService.js';

describe('contextService stress', () => {
  const provider = { getBeadsMode: () => 'off' as const };

  it('write and read multiple files', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-stress-'));
    try {
      const service = new ContextService(tempDir, provider);
      service.write('feat', 'decisions', 'Decision A');
      service.write('feat', 'learnings', 'Learning B');
      expect(service.read('feat', 'decisions')).toContain('Decision A');
      expect(service.read('feat', 'learnings')).toContain('Learning B');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('overwrite existing file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-ow-'));
    try {
      const service = new ContextService(tempDir, provider);
      service.write('feat', 'notes', 'First version');
      service.write('feat', 'notes', 'Second version');
      expect(service.read('feat', 'notes')).toContain('Second version');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('list files for feature', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-list-'));
    try {
      const service = new ContextService(tempDir, provider);
      service.write('feat', 'a', 'content a');
      service.write('feat', 'b', 'content b');
      const files = service.list('feat');
      expect(files.length).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('read returns null for non-existent file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-null-'));
    try {
      const service = new ContextService(tempDir, provider);
      expect(service.read('feat', 'ghost')).toBeNull();
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
