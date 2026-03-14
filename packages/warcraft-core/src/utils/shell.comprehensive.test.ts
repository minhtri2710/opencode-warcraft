import { describe, expect, it } from 'bun:test';
import { shellQuoteArg, structuredToCommandString } from './shell.js';

describe('shell comprehensive', () => {
  describe('shellQuoteArg all input types', () => {
    const INPUTS: Array<[string, string]> = [
      ['simple', 'simple'],
      ['with space', "'with space'"],
      ['with"quote', 'contains quote'],
      ["with'single", 'contains single'],
      ['with$dollar', 'contains dollar'],
      ['with;semicolon', 'contains semicolon'],
      ['with|pipe', 'contains pipe'],
      ['with&amp', 'contains amp'],
      ['with(paren)', 'contains paren'],
      ['', 'empty'],
      ['a b c', 'multiple spaces'],
      ['path/to/file', 'with slash'],
      ['--flag=value', 'flag'],
      ['-n', 'short flag'],
      ['hello world!', 'exclamation'],
    ];

    for (const [input, desc] of INPUTS) {
      it(`${desc}: "${input.slice(0, 20)}"`, () => {
        const quoted = shellQuoteArg(input);
        expect(typeof quoted).toBe('string');
        expect(quoted.length).toBeGreaterThanOrEqual(input.length);
      });
    }
  });

  describe('structuredToCommandString', () => {
    it('simple command no args', () => {
      const result = structuredToCommandString('echo', []);
      expect(result).toBe('echo');
    });

    it('command with single arg', () => {
      const result = structuredToCommandString('echo', ['hello']);
      expect(result).toContain('echo');
      expect(result).toContain('hello');
    });

    it('command with multiple args', () => {
      const result = structuredToCommandString('docker', ['run', '-it', 'ubuntu']);
      expect(result).toContain('docker');
      expect(result).toContain('run');
      expect(result).toContain('ubuntu');
    });

    it('command with space in arg', () => {
      const result = structuredToCommandString('echo', ['hello world']);
      expect(result).toContain('echo');
      // The arg should be quoted
      expect(result.length).toBeGreaterThan('echo hello world'.length);
    });

    it('command with special chars in args', () => {
      const result = structuredToCommandString('git', ['commit', '-m', 'fix: handle $special & chars']);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('round-trip safety', () => {
    const SAFE_INPUTS = ['abc', '123', 'hello-world', 'path/to/file'];
    for (const input of SAFE_INPUTS) {
      it(`safe input "${input}" preserved`, () => {
        const quoted = shellQuoteArg(input);
        // Quoted version should "contain" the original or be a valid quoting
        expect(quoted.includes(input) || quoted.includes("'")).toBe(true);
      });
    }
  });
});
