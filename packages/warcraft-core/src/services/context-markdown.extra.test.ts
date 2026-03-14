import { describe, expect, it } from 'bun:test';
import { appendContextContent, renderContextSection, renderContextSections } from './context-markdown.js';

describe('context-markdown extra edge cases', () => {
  describe('renderContextSection', () => {
    it('strips heading with trailing hash marks (ATX closing)', () => {
      const result = renderContextSection('notes', '## Notes ##\n\nContent');
      expect(result).toBe('## notes\n\nContent');
      expect(result).not.toContain('## Notes ##');
    });

    it('handles heading with special characters in name', () => {
      const result = renderContextSection('execution_decisions', '## Execution_Decisions\n\nContent');
      expect(result).toBe('## execution_decisions\n\nContent');
    });

    it('handles content that is only blank lines after heading strip', () => {
      const result = renderContextSection('empty-body', '## Empty Body\n\n\n\n');
      // After stripping heading, remaining content is only blank lines → empty
      expect(result).toBe('## empty-body');
    });

    it('handles h1 heading that matches section name', () => {
      const result = renderContextSection('notes', '# Notes\n\nContent');
      expect(result).toBe('## notes\n\nContent');
    });

    it('preserves content with no leading heading', () => {
      const result = renderContextSection('notes', 'Just plain content\nwith multiple lines');
      expect(result).toBe('## notes\n\nJust plain content\nwith multiple lines');
    });

    it('strips BOM and leading blank lines together', () => {
      const result = renderContextSection('notes', '\uFEFF\n\n## Notes\n\nContent');
      expect(result).not.toContain('\uFEFF');
      expect(result).toBe('## notes\n\nContent');
    });
  });

  describe('renderContextSections', () => {
    it('renders single section without separator', () => {
      const result = renderContextSections([{ name: 'only', content: 'Content' }]);
      expect(result).toBe('## only\n\nContent');
      expect(result).not.toContain('---');
    });

    it('renders three sections with separators', () => {
      const result = renderContextSections([
        { name: 'a', content: 'Alpha' },
        { name: 'b', content: 'Beta' },
        { name: 'c', content: 'Gamma' },
      ]);
      const parts = result.split('---');
      expect(parts).toHaveLength(3);
    });
  });

  describe('appendContextContent', () => {
    it('returns incoming when existing is undefined', () => {
      expect(appendContextContent(undefined, 'new')).toBe('new');
    });

    it('returns existing when incoming is empty string', () => {
      expect(appendContextContent('existing', '')).toBe('existing');
    });

    it('handles both empty', () => {
      expect(appendContextContent('', '')).toBe('');
    });

    it('handles both null-ish', () => {
      expect(appendContextContent(null, '')).toBe('');
    });

    it('trims leading and trailing blank lines at boundaries', () => {
      const result = appendContextContent('\n\nexisting\n\n', '\n\nnew\n\n');
      expect(result).toBe('existing\n\nnew');
    });
  });
});
