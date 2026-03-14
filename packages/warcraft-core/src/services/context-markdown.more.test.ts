import { describe, expect, it } from 'bun:test';
import { renderContextSection, renderContextSections, appendContextContent } from './context-markdown.js';

describe('context-markdown advanced scenarios', () => {
  describe('renderContextSection', () => {
    it('strips BOM from content', () => {
      const result = renderContextSection('notes', '\uFEFFSome text');
      expect(result).not.toContain('\uFEFF');
      expect(result).toContain('Some text');
    });

    it('strips redundant leading heading matching section name', () => {
      const result = renderContextSection('notes', '# Notes\n\nBody');
      expect(result).toContain('## notes');
      expect(result).toContain('Body');
      expect(result).not.toContain('# Notes');
    });

    it('preserves non-matching leading heading', () => {
      const result = renderContextSection('notes', '# Overview\n\nBody');
      expect(result).toContain('## notes');
      expect(result).toContain('# Overview');
    });

    it('handles heading with trailing hashes', () => {
      const result = renderContextSection('notes', '## Notes ##\n\nBody');
      expect(result).toContain('## notes');
      expect(result).toContain('Body');
    });

    it('normalizes heading with special chars for comparison', () => {
      const result = renderContextSection('my-notes', '# my_notes.md\n\nBody');
      // "my-notes" normalizes to "my notes", "my_notes.md" normalizes to "my notes"
      expect(result).toContain('## my-notes');
      expect(result).toContain('Body');
      expect(result).not.toContain('# my_notes.md');
    });

    it('returns just heading for empty content', () => {
      const result = renderContextSection('empty', '');
      expect(result).toBe('## empty');
    });
  });

  describe('renderContextSections', () => {
    it('joins multiple sections with hr separator', () => {
      const result = renderContextSections([
        { name: 'A', content: 'Content A' },
        { name: 'B', content: 'Content B' },
      ]);
      expect(result).toContain('## A');
      expect(result).toContain('Content A');
      expect(result).toContain('---');
      expect(result).toContain('## B');
      expect(result).toContain('Content B');
    });

    it('single section has no separator', () => {
      const result = renderContextSections([{ name: 'Solo', content: 'Only' }]);
      expect(result).not.toContain('---');
    });

    it('empty array returns empty string', () => {
      expect(renderContextSections([])).toBe('');
    });
  });

  describe('appendContextContent', () => {
    it('returns incoming when existing is null', () => {
      expect(appendContextContent(null, 'new')).toBe('new');
    });

    it('returns incoming when existing is undefined', () => {
      expect(appendContextContent(undefined, 'new')).toBe('new');
    });

    it('returns incoming when existing is empty string', () => {
      expect(appendContextContent('', 'new')).toBe('new');
    });

    it('combines existing with whitespace-only incoming', () => {
      // trimBoundaryBlankLines removes leading/trailing \n but not spaces
      const result = appendContextContent('existing', '   \n\n  ');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('joins with double newline', () => {
      const result = appendContextContent('first', 'second');
      expect(result).toBe('first\n\nsecond');
    });

    it('trims boundary blank lines from both', () => {
      const result = appendContextContent('\n\nfirst\n\n', '\n\nsecond\n\n');
      expect(result).toBe('first\n\nsecond');
    });
  });
});
