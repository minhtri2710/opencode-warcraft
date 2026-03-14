import { describe, expect, it } from 'bun:test';
import { shellQuoteArg, structuredToCommandString } from './shell.js';

describe('shell more scenarios', () => {
  describe('shellQuoteArg', () => {
    it('quotes empty string', () => {
      const result = shellQuoteArg('');
      expect(result).toContain("''");
    });

    it('does not quote simple strings', () => {
      const result = shellQuoteArg('simple');
      expect(result).toBe('simple');
    });

    it('quotes strings with spaces', () => {
      const result = shellQuoteArg('hello world');
      expect(result.length).toBeGreaterThan('hello world'.length);
    });

    it('quotes strings with special chars', () => {
      const result = shellQuoteArg('hello$world');
      expect(result).not.toBe('hello$world');
    });

    it('handles single quotes in string', () => {
      const result = shellQuoteArg("it's");
      expect(result.length).toBeGreaterThan(4);
    });

    it('handles double quotes', () => {
      const result = shellQuoteArg('say "hi"');
      expect(result.length).toBeGreaterThan(8);
    });

    it('handles newlines', () => {
      const result = shellQuoteArg('line1\nline2');
      expect(result.length).toBeGreaterThan(11);
    });
  });

  describe('structuredToCommandString', () => {
    it('combines command and args', () => {
      const result = structuredToCommandString('git', ['commit', '-m', 'message']);
      expect(result).toContain('git');
      expect(result).toContain('commit');
      expect(result).toContain('message');
    });

    it('handles no args', () => {
      const result = structuredToCommandString('ls', []);
      expect(result).toBe('ls');
    });

    it('quotes args with spaces', () => {
      const result = structuredToCommandString('echo', ['hello world']);
      expect(result).toContain('echo');
      expect(result.length).toBeGreaterThan(15);
    });

    it('handles single arg', () => {
      const result = structuredToCommandString('cat', ['file.txt']);
      expect(result).toContain('cat');
      expect(result).toContain('file.txt');
    });
  });
});
