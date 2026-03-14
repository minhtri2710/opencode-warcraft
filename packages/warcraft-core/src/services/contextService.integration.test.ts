import { describe, expect, it } from 'bun:test';
import { ContextService } from './contextService.js';

describe('contextService combined integration', () => {
  const provider = { getBeadsMode: () => 'off' as const };

  it('read returns null for non-existent feature/file', () => {
    const service = new ContextService('/tmp/nonexistent', provider);
    const result = service.read('ghost', 'decisions');
    expect(result).toBeNull();
  });

  it('constructor accepts beads mode provider', () => {
    const service = new ContextService('/tmp', provider);
    expect(service).toBeDefined();
  });

  it('write then read round-trips in real directory', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-int-'));
    try {
      const service = new ContextService(tempDir, provider);
      service.write('my-feature', 'notes', 'Some notes');
      const result = service.read('my-feature', 'notes');
      expect(result).toContain('Some notes');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('list returns empty for non-existent feature', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-list-'));
    try {
      const service = new ContextService(tempDir, provider);
      const result = service.list('nonexistent');
      expect(result).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
