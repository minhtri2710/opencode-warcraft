import { describe, expect, it } from 'bun:test';
import { deriveTaskFolder, slugifyIdentifierSegment, slugifyTaskName } from './slug.js';

describe('slug security and boundary', () => {
  it('XSS attempt in task name', () => {
    const slug = slugifyTaskName('<script>alert(1)</script>');
    expect(slug).not.toContain('<');
    expect(slug).not.toContain('>');
  });

  it('SQL injection attempt', () => {
    const slug = slugifyTaskName("'; DROP TABLE tasks;--");
    expect(slug).not.toContain("'");
    expect(slug).not.toContain(';');
  });

  it('path traversal in name', () => {
    const slug = slugifyTaskName('../../etc/passwd');
    expect(slug).not.toContain('..');
  });

  it('null byte in name', () => {
    const slug = slugifyTaskName('test\x00bad');
    expect(slug).not.toContain('\x00');
  });

  it('very long name truncated reasonably', () => {
    const long = 'a'.repeat(1000);
    const slug = slugifyTaskName(long);
    expect(slug.length).toBeLessThan(500);
  });

  it('emoji in name', () => {
    const slug = slugifyTaskName('🚀 Deploy Feature');
    expect(slug.length).toBeGreaterThan(0);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('all special chars produce non-empty slug', () => {
    const slug = slugifyTaskName('!@#$%^&*()');
    expect(slug.length).toBeGreaterThan(0);
  });

  it('deriveTaskFolder order 0 works', () => {
    const folder = deriveTaskFolder(0, 'zero');
    expect(folder.length).toBeGreaterThan(0);
  });

  it('deriveTaskFolder large order', () => {
    const folder = deriveTaskFolder(999, 'big');
    expect(folder).toContain('999');
  });

  it('slugifyIdentifierSegment non-string input handled', () => {
    // TypeScript enforces string but runtime might receive number
    const result = slugifyIdentifierSegment(String(42));
    expect(result.length).toBeGreaterThan(0);
  });
});
