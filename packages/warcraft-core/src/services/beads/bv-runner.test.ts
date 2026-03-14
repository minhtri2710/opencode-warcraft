import { describe, expect, it } from 'bun:test';
import type { BvCommandExecutor } from './bv-runner.js';
import { runBvCommand } from './bv-runner.js';

function createMockExecutor(output: string): BvCommandExecutor {
  return (_command, _args, _options) => output;
}

function createFailingExecutor(errorMessage: string): BvCommandExecutor {
  return () => {
    throw new Error(errorMessage);
  };
}

describe('runBvCommand', () => {
  it('returns null result when disabled', () => {
    const executor = createMockExecutor('{"ok": true}');
    const result = runBvCommand(['--robot-triage'], { directory: '/tmp', enabled: false, executor });
    expect(result.result).toBeNull();
    expect(result.error).toBe('disabled by beadsMode=off');
  });

  it('returns parsed JSON when command succeeds', () => {
    const executor = createMockExecutor('{"summary": "all good"}');
    const result = runBvCommand(['--robot-triage'], { directory: '/tmp', enabled: true, executor });
    expect(result.result).toEqual({ summary: 'all good' });
    expect(result.error).toBeNull();
  });

  it('appends --format json to args', () => {
    let capturedArgs: string[] = [];
    const executor: BvCommandExecutor = (_command, args, _options) => {
      capturedArgs = args;
      return '{}';
    };
    runBvCommand(['--robot-triage'], { directory: '/tmp', enabled: true, executor });
    expect(capturedArgs).toEqual(['--robot-triage', '--format', 'json']);
  });

  it('passes directory as cwd', () => {
    let capturedCwd = '';
    const executor: BvCommandExecutor = (_command, _args, options) => {
      capturedCwd = options.cwd;
      return '{}';
    };
    runBvCommand(['test'], { directory: '/my/project', enabled: true, executor });
    expect(capturedCwd).toBe('/my/project');
  });

  it('returns error string when command throws', () => {
    const executor = createFailingExecutor('bv not found');
    const result = runBvCommand(['--robot-triage'], { directory: '/tmp', enabled: true, executor });
    expect(result.result).toBeNull();
    expect(result.error).toBe('bv not found');
  });

  it('returns error string for non-Error exceptions', () => {
    const executor: BvCommandExecutor = () => {
      throw 'string error';
    };
    const result = runBvCommand(['test'], { directory: '/tmp', enabled: true, executor });
    expect(result.result).toBeNull();
    expect(result.error).toBe('string error');
  });

  it('returns error for malformed JSON output', () => {
    const executor = createMockExecutor('not json');
    const result = runBvCommand(['test'], { directory: '/tmp', enabled: true, executor });
    expect(result.result).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('handles array JSON output', () => {
    const executor = createMockExecutor('[1, 2, 3]');
    const result = runBvCommand(['test'], { directory: '/tmp', enabled: true, executor });
    expect(result.result).toEqual([1, 2, 3]);
    expect(result.error).toBeNull();
  });
});
