import { describe, expect, it } from 'bun:test';
import {
  appendContextContent,
  renderContextSection,
  renderContextSections,
} from './context-markdown.js';

describe('context-markdown deep scenarios', () => {
  describe('appendContextContent edge cases', () => {
    it('handles whitespace-only existing content', () => {
      const result = appendContextContent('   \n  \n  ', 'new content');
      expect(result).toContain('new content');
    });

    it('handles incoming content with leading/trailing whitespace', () => {
      const result = appendContextContent(null, '  content  ');
      expect(result).toContain('content');
    });

    it('appends multiple times correctly', () => {
      let content: string | null = null;
      content = appendContextContent(content, 'first');
      content = appendContextContent(content, 'second');
      content = appendContextContent(content, 'third');
      expect(content).toContain('first');
      expect(content).toContain('second');
      expect(content).toContain('third');
    });

    it('handles multiline incoming content', () => {
      const result = appendContextContent(null, 'line1\nline2\nline3');
      expect(result).toContain('line1');
      expect(result).toContain('line3');
    });

    it('handles existing multiline content', () => {
      const result = appendContextContent('existing\ncontent', 'new stuff');
      expect(result).toContain('existing');
      expect(result).toContain('new stuff');
    });

    it('handles empty string incoming (trims to empty)', () => {
      const result = appendContextContent('existing', '');
      expect(result).toBeDefined();
    });
  });

  describe('renderContextSection deep', () => {
    it('includes section name as heading', () => {
      const result = renderContextSection('Decisions', 'We chose TypeScript');
      expect(result).toContain('Decisions');
      expect(result).toContain('We chose TypeScript');
    });

    it('handles special characters in name', () => {
      const result = renderContextSection('Q&A', 'Question: Why?');
      expect(result).toContain('Q&A');
    });

    it('handles empty content', () => {
      const result = renderContextSection('Empty', '');
      expect(result).toContain('Empty');
    });

    it('returns markdown string', () => {
      const result = renderContextSection('Test', 'content');
      expect(result).toContain('#');
    });
  });

  describe('renderContextSections deep', () => {
    it('renders empty array', () => {
      const result = renderContextSections([]);
      expect(typeof result).toBe('string');
    });

    it('renders single section', () => {
      const result = renderContextSections([{ name: 'Notes', content: 'Some notes' }]);
      expect(result).toContain('Notes');
      expect(result).toContain('Some notes');
    });

    it('renders multiple sections in order', () => {
      const result = renderContextSections([
        { name: 'First', content: 'A' },
        { name: 'Second', content: 'B' },
        { name: 'Third', content: 'C' },
      ]);
      const firstIdx = result.indexOf('First');
      const secondIdx = result.indexOf('Second');
      const thirdIdx = result.indexOf('Third');
      expect(firstIdx).toBeLessThan(secondIdx);
      expect(secondIdx).toBeLessThan(thirdIdx);
    });

    it('all section content is present', () => {
      const result = renderContextSections([
        { name: 'A', content: 'Alpha' },
        { name: 'B', content: 'Beta' },
      ]);
      expect(result).toContain('Alpha');
      expect(result).toContain('Beta');
    });
  });
});
