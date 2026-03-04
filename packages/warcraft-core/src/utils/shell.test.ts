import { describe, expect, it } from 'bun:test';
import { shellQuoteArg, structuredToCommandString } from './shell.js';

describe('shellQuoteArg', () => {
  it('returns safe args unchanged', () => {
    expect(shellQuoteArg('hello')).toBe('hello');
    expect(shellQuoteArg('/path/to/file')).toBe('/path/to/file');
    expect(shellQuoteArg('key=value')).toBe('key=value');
  });

  it('quotes args with special characters', () => {
    expect(shellQuoteArg('hello world')).toBe("'hello world'");
    expect(shellQuoteArg('arg;rm -rf')).toBe("'arg;rm -rf'");
  });

  it('handles single quotes in args', () => {
    const result = shellQuoteArg("it's");
    expect(result).toContain('it');
    expect(result).toContain('s');
  });
});

describe('structuredToCommandString', () => {
  it('joins command and args', () => {
    expect(structuredToCommandString('echo', ['hello', 'world'])).toBe('echo hello world');
  });

  it('quotes args that need it', () => {
    const result = structuredToCommandString('echo', ['hello world']);
    expect(result).toBe("echo 'hello world'");
  });

  it('handles empty args', () => {
    expect(structuredToCommandString('ls', [])).toBe('ls');
  });
});
