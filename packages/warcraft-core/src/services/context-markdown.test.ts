import { describe, expect, it } from 'bun:test';
import { appendContextContent, renderContextSection, renderContextSections } from './context-markdown.js';

describe('context-markdown', () => {
  describe('renderContextSection', () => {
    it('renders section with heading and body', () => {
      const result = renderContextSection('notes', 'Some content here');
      expect(result).toBe('## notes\n\nSome content here');
    });

    it('renders section heading only when body is empty', () => {
      const result = renderContextSection('empty', '');
      expect(result).toBe('## empty');
    });

    it('strips duplicate heading matching section name', () => {
      const result = renderContextSection('research-notes', '## Research Notes\n\nFindings');
      expect(result).toBe('## research-notes\n\nFindings');
      expect(result).not.toContain('## Research Notes');
    });

    it('preserves non-matching heading', () => {
      const result = renderContextSection('notes', '## Different Title\n\nContent');
      expect(result).toContain('## notes');
      expect(result).toContain('## Different Title');
    });

    it('strips BOM from content', () => {
      const result = renderContextSection('notes', '\uFEFFContent with BOM');
      expect(result).not.toContain('\uFEFF');
      expect(result).toContain('Content with BOM');
    });

    it('normalizes heading with underscores and hyphens', () => {
      const result = renderContextSection('execution-decisions', '## Execution Decisions\n\nContent');
      expect(result).toBe('## execution-decisions\n\nContent');
    });

    it('normalizes heading with .md suffix', () => {
      const result = renderContextSection('notes', '## Notes.md\n\nContent');
      expect(result).toBe('## notes\n\nContent');
    });
  });

  describe('renderContextSections', () => {
    it('joins multiple sections with separator', () => {
      const result = renderContextSections([
        { name: 'a', content: 'Alpha' },
        { name: 'b', content: 'Beta' },
      ]);
      expect(result).toContain('## a\n\nAlpha');
      expect(result).toContain('---');
      expect(result).toContain('## b\n\nBeta');
    });

    it('returns empty string for empty array', () => {
      const result = renderContextSections([]);
      expect(result).toBe('');
    });
  });

  describe('appendContextContent', () => {
    it('returns incoming content when existing is null', () => {
      expect(appendContextContent(null, 'new')).toBe('new');
    });

    it('returns incoming content when existing is empty', () => {
      expect(appendContextContent('', 'new')).toBe('new');
    });

    it('joins existing and incoming with double newline', () => {
      expect(appendContextContent('existing', 'new')).toBe('existing\n\nnew');
    });

    it('trims blank lines from boundaries', () => {
      expect(appendContextContent('\n\nexisting\n\n', '\n\nnew\n\n')).toBe('existing\n\nnew');
    });

    it('returns existing when incoming is empty after trimming', () => {
      expect(appendContextContent('existing', '\n\n')).toBe('existing');
    });
  });
});
