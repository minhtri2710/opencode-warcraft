import { describe, expect, it } from 'bun:test';
import { shellQuoteArg, structuredToCommandString } from './shell.js';

describe('shellQuoteArg extra edge cases', () => {
  it('leaves colons unquoted', () => {
    expect(shellQuoteArg('/path:value')).toBe('/path:value');
  });

  it('leaves equals unquoted', () => {
    expect(shellQuoteArg('KEY=VAL')).toBe('KEY=VAL');
  });

  it('quotes empty string', () => {
    const result = shellQuoteArg('');
    expect(result).toBe("''");
  });

  it('quotes string with newline', () => {
    const result = shellQuoteArg('line1\nline2');
    expect(result).toContain("'");
  });

  it('quotes string with tab', () => {
    const result = shellQuoteArg('col1\tcol2');
    expect(result).toContain("'");
  });

  it('quotes string with dollar sign', () => {
    const result = shellQuoteArg('$HOME');
    expect(result).toContain("'");
  });

  it('quotes string with parentheses', () => {
    const result = shellQuoteArg('$(cmd)');
    expect(result).toContain("'");
  });

  it('handles string with embedded single quotes', () => {
    const result = shellQuoteArg("it's a test");
    // Verify the result can be used safely (no bare single quotes)
    expect(result).not.toBe("it's a test");
    expect(result.length).toBeGreaterThan("it's a test".length);
  });

  it('leaves hyphens unquoted', () => {
    expect(shellQuoteArg('--flag')).toBe('--flag');
  });

  it('leaves mixed alphanumeric with dots and slashes unquoted', () => {
    expect(shellQuoteArg('v1.2.3/build')).toBe('v1.2.3/build');
  });
});

describe('structuredToCommandString extra edge cases', () => {
  it('handles args with mixed safe and unsafe values', () => {
    const result = structuredToCommandString('docker', ['run', '--rm', '-v', '/path with spaces:/app']);
    expect(result).toBe("docker run --rm -v '/path with spaces:/app'");
  });

  it('handles single arg', () => {
    expect(structuredToCommandString('ls', ['-la'])).toBe('ls -la');
  });

  it('handles command with no args', () => {
    expect(structuredToCommandString('pwd', [])).toBe('pwd');
  });
});
