import { describe, expect, it } from 'bun:test';
import { appendContextContent, renderContextSection, renderContextSections } from './context-markdown.js';

describe('context-markdown property tests', () => {
  it('appendContextContent is idempotent with same content', () => {
    const result1 = appendContextContent(null, 'content');
    const result2 = appendContextContent(null, 'content');
    expect(result1).toBe(result2);
  });

  it('renderContextSection output contains heading marker', () => {
    const result = renderContextSection('Test', 'body');
    expect(result).toMatch(/#/);
  });

  it('renderContextSections joins all sections', () => {
    const sections = Array.from({ length: 5 }, (_, i) => ({
      name: `Section${i}`,
      content: `Content${i}`,
    }));
    const result = renderContextSections(sections);
    for (let i = 0; i < 5; i++) {
      expect(result).toContain(`Section${i}`);
      expect(result).toContain(`Content${i}`);
    }
  });

  it('appendContextContent preserves markdown formatting', () => {
    const result = appendContextContent(null, '## Heading\n\n- item 1\n- item 2');
    expect(result).toContain('## Heading');
    expect(result).toContain('- item 1');
  });

  it('renderContextSection with unicode', () => {
    const result = renderContextSection('日本語', 'テスト内容');
    expect(result).toContain('日本語');
    expect(result).toContain('テスト内容');
  });

  it('renderContextSections empty produces string', () => {
    const result = renderContextSections([]);
    expect(typeof result).toBe('string');
    expect(result.length).toBeLessThan(10);
  });

  it('appendContextContent with very long content', () => {
    const long = 'x'.repeat(10000);
    const result = appendContextContent(null, long);
    expect(result.length).toBeGreaterThanOrEqual(10000);
  });
});
