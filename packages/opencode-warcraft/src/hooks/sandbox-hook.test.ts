import { describe, expect, test } from 'bun:test';
import * as path from 'path';
import { applySandboxHook } from './sandbox-hook.js';

/**
 * Tests for the extracted sandbox hook pure function.
 *
 * The function should:
 * - Only intercept bash tool calls
 * - Only wrap commands with explicit workdir inside .beads/artifacts/.worktrees/
 * - Respect sandbox config mode ('none' = no wrapping, 'docker' = wrap)
 * - Treat commands uniformly (no HOST: escape hatch)
 * - Clear workdir after wrapping (docker runs on host)
 */

describe('applySandboxHook', () => {
  const mockDirectory = '/mock/project';
  const warcraftWorktreeBase = path.join(mockDirectory, '.beads/artifacts', '.worktrees');
  const worktreePath = path.join(warcraftWorktreeBase, 'feature-x', 'task-1');

  describe('sandbox mode: docker', () => {
    test('wraps bash command with explicit workdir inside .beads/artifacts/.worktrees/', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: {
          command: 'bun test',
          workdir: worktreePath,
        },
      };

      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      // Command should be wrapped with docker run
      expect(output.args.command).toContain('docker run');
      expect(output.args.command).toContain('node:22-slim');
      expect(output.args.command).toContain('bun test');
      // Workdir should be cleared (docker runs on host)
      expect(output.args.workdir).toBeUndefined();
    });

    test('passes through bash command without workdir', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: {
          command: 'git status',
        },
      };

      const originalCommand = output.args.command;
      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      // Command should be unchanged
      expect(output.args.command).toBe(originalCommand);
      expect(output.args.command).not.toContain('docker run');
    });

    test('passes through bash command with workdir outside .beads/artifacts/.worktrees/', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: {
          command: 'npm install',
          workdir: '/mock/project/packages/warcraft-core',
        },
      };

      const originalCommand = output.args.command;
      const originalWorkdir = output.args.workdir;
      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      // Command and workdir should be unchanged
      expect(output.args.command).toBe(originalCommand);
      expect(output.args.workdir).toBe(originalWorkdir);
      expect(output.args.command).not.toContain('docker run');
    });

    test('does not wrap workdir paths that only share the .worktrees prefix', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: {
          command: 'npm install',
          workdir: '/mock/project/.beads/artifacts/.worktrees-evil/feature-x/task-1',
        },
      };

      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      expect(output.args.command).toBe('npm install');
      expect(output.args.workdir).toBe('/mock/project/.beads/artifacts/.worktrees-evil/feature-x/task-1');
      expect(output.args.command).not.toContain('docker run');
    });

    test('wraps HOST-prefixed commands like any other command in worktree sandbox', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: {
          command: 'HOST: git status',
          workdir: worktreePath,
        },
      };

      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      expect(output.args.command).toContain('docker run');
      expect(output.args.command).toContain('HOST: git status');
      expect(output.args.workdir).toBeUndefined();
    });
  });

  describe('sandbox mode: none', () => {
    test('passes through bash command unchanged', () => {
      const sandboxConfig = { mode: 'none' as const };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: {
          command: 'bun test',
          workdir: worktreePath,
        },
      };

      const originalCommand = output.args.command;
      const originalWorkdir = output.args.workdir;
      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      // Nothing should change
      expect(output.args.command).toBe(originalCommand);
      expect(output.args.workdir).toBe(originalWorkdir);
      expect(output.args.command).not.toContain('docker run');
    });
  });

  describe('non-bash tools', () => {
    test('ignores read tool', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'read',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: {
          filePath: '/some/file.ts',
        },
      };

      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      // Nothing should change (no workdir or command to modify)
      expect((output.args as any).filePath).toBe('/some/file.ts');
    });

    test('ignores write tool', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'write',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: {
          filePath: '/some/file.ts',
          content: 'test',
        },
      };

      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      // Nothing should change
      expect((output.args as any).filePath).toBe('/some/file.ts');
      expect((output.args as any).content).toBe('test');
    });
  });

  describe('edge cases', () => {
    test('handles empty command', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: {
          command: '   ',
          workdir: worktreePath,
        },
      };

      const originalWorkdir = output.args.workdir;
      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      // Empty command should not be wrapped
      expect(output.args.command).toBe('   ');
      expect(output.args.workdir).toBe(originalWorkdir);
      expect(output.args.command).not.toContain('docker run');
    });

    test('handles missing args', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: undefined as any,
      };

      // Should not throw, just return early
      expect(() => applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on')).not.toThrow();
    });

    test('handles command with special characters', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      const output = {
        args: {
          command: 'echo "hello world" && ls -la',
          workdir: worktreePath,
        },
      };

      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      // Command should be wrapped with proper escaping
      expect(output.args.command).toContain('docker run');
      expect(output.args.command).toContain('echo "hello world" && ls -la');
      expect(output.args.workdir).toBeUndefined();
    });
  });

  describe('worktree path detection', () => {
    test('uses beads mode to compute correct worktree base path', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      // With beadsMode 'on', worktree base is <dir>/.beads/artifacts/.worktrees
      const output = {
        args: {
          command: 'bun test',
          workdir: path.join(mockDirectory, '.beads/artifacts', '.worktrees', 'feat', 'task'),
        },
      };

      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'on');

      expect(output.args.command).toContain('docker run');
      expect(output.args.workdir).toBeUndefined();
    });

    test('uses off-mode worktree base path when beadsMode is off', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      // With beadsMode 'off', worktree base is <dir>/docs/.worktrees
      const output = {
        args: {
          command: 'bun test',
          workdir: path.join(mockDirectory, 'docs', '.worktrees', 'feat', 'task'),
        },
      };

      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'off');

      expect(output.args.command).toContain('docker run');
      expect(output.args.workdir).toBeUndefined();
    });

    test('does not wrap when workdir matches on-mode path but beadsMode is off', () => {
      const sandboxConfig = { mode: 'docker' as const, image: 'node:22-slim' };

      const input = {
        tool: 'bash',
        sessionID: 'test-session',
        callID: 'test-call',
      };
      // Workdir is under .beads/artifacts/.worktrees but beadsMode is 'off'
      // so the worktree base is docs/.worktrees — no match
      const output = {
        args: {
          command: 'bun test',
          workdir: path.join(mockDirectory, '.beads/artifacts', '.worktrees', 'feat', 'task'),
        },
      };

      applySandboxHook(input, output, sandboxConfig, mockDirectory, 'off');

      // Should NOT wrap because workdir is not inside the off-mode worktree base
      expect(output.args.command).toBe('bun test');
      expect(output.args.workdir).toBe(path.join(mockDirectory, '.beads/artifacts', '.worktrees', 'feat', 'task'));
    });
  });
});
