import { describe, expect, it } from 'bun:test';
import type { BvCommandExecutor } from './bv-runner.js';
import { runBvCommand } from './bv-runner.js';

describe('runBvCommand extra edge cases', () => {
  it('appends --format json to command args', () => {
    let capturedArgs: string[] = [];
    const executor: BvCommandExecutor = (_cmd, args) => {
      capturedArgs = args;
      return '{}';
    };
    runBvCommand(['--robot-plan'], { directory: '/tmp', enabled: true, executor });
    expect(capturedArgs).toContain('--format');
    expect(capturedArgs).toContain('json');
  });

  it('passes multiple args correctly', () => {
    let capturedArgs: string[] = [];
    const executor: BvCommandExecutor = (_cmd, args) => {
      capturedArgs = args;
      return '{}';
    };
    runBvCommand(['--robot-blocker-chain', 'bd-123'], { directory: '/tmp', enabled: true, executor });
    expect(capturedArgs).toContain('--robot-blocker-chain');
    expect(capturedArgs).toContain('bd-123');
  });

  it('returns error string when executor throws on invalid JSON', () => {
    const executor: BvCommandExecutor = () => { throw new Error('cmd failed'); };
    const { result, error } = runBvCommand(['test'], { directory: '/tmp', enabled: true, executor });
    expect(result).toBeNull();
    expect(error).toBeDefined();
    expect(error).toContain('cmd failed');
  });

  it('handles null JSON output', () => {
    const executor: BvCommandExecutor = () => 'null';
    const { result, error } = runBvCommand(['test'], { directory: '/tmp', enabled: true, executor });
    expect(result).toBeNull();
    expect(error).toBeNull();
  });

  it('handles numeric JSON output', () => {
    const executor: BvCommandExecutor = () => '42';
    const { result, error } = runBvCommand(['test'], { directory: '/tmp', enabled: true, executor });
    expect(result).toBe(42);
    expect(error).toBeNull();
  });

  it('handles string JSON output', () => {
    const executor: BvCommandExecutor = () => '"hello"';
    const { result, error } = runBvCommand(['test'], { directory: '/tmp', enabled: true, executor });
    expect(result).toBe('hello');
    expect(error).toBeNull();
  });

  it('handles deeply nested JSON output', () => {
    const data = { a: { b: { c: { d: [1, 2, 3] } } } };
    const executor: BvCommandExecutor = () => JSON.stringify(data);
    const { result, error } = runBvCommand(['test'], { directory: '/tmp', enabled: true, executor });
    expect(result).toEqual(data);
    expect(error).toBeNull();
  });

  it('passes cwd to executor options', () => {
    let capturedOpts: any = null;
    const executor: BvCommandExecutor = (_cmd, _args, opts) => {
      capturedOpts = opts;
      return '{}';
    };
    runBvCommand(['test'], { directory: '/custom/dir', enabled: true, executor });
    expect(capturedOpts?.cwd).toBe('/custom/dir');
  });
});
