import { describe, expect, it } from 'bun:test';
import { shellQuoteArg, structuredToCommandString } from './shell.js';

describe('shell stress tests', () => {
  describe('shellQuoteArg stress', () => {
    it('handles backticks', () => {
      const result = shellQuoteArg('`command`');
      expect(result.length).toBeGreaterThan(9);
    });

    it('handles pipe character', () => {
      const result = shellQuoteArg('a | b');
      expect(result).not.toBe('a | b');
    });

    it('handles semicolons', () => {
      const result = shellQuoteArg('cmd; evil');
      expect(result).not.toBe('cmd; evil');
    });

    it('handles ampersands', () => {
      const result = shellQuoteArg('cmd && evil');
      expect(result).not.toBe('cmd && evil');
    });

    it('handles redirections', () => {
      const result = shellQuoteArg('> /etc/passwd');
      expect(result).not.toBe('> /etc/passwd');
    });

    it('handles environment variables', () => {
      const result = shellQuoteArg('$HOME');
      expect(result).not.toBe('$HOME');
    });

    it('handles unicode', () => {
      const result = shellQuoteArg('日本語テスト');
      expect(result).toContain('日本語');
    });

    it('handles very long strings', () => {
      const long = 'x'.repeat(10000);
      const result = shellQuoteArg(long);
      expect(result.length).toBeGreaterThanOrEqual(10000);
    });
  });

  describe('structuredToCommandString stress', () => {
    it('handles many arguments', () => {
      const args = Array.from({ length: 20 }, (_, i) => `arg${i}`);
      const result = structuredToCommandString('cmd', args);
      for (const arg of args) {
        expect(result).toContain(arg);
      }
    });

    it('handles arguments with spaces', () => {
      const result = structuredToCommandString('echo', ['hello world', 'foo bar']);
      expect(result).toContain('echo');
    });

    it('handles command with path', () => {
      const result = structuredToCommandString('/usr/bin/git', ['status']);
      expect(result).toContain('/usr/bin/git');
    });
  });
});
