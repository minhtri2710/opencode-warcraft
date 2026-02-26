import { describe, test, expect } from 'bun:test';
import * as path from 'path';
import { DockerSandboxService } from 'warcraft-core';

/**
 * Tests for tool.execute.before hook bash interception with Docker sandboxing
 * 
 * The hook should:
 * - Only intercept bash tool calls
 * - Only wrap commands with explicit workdir inside .beads/artifacts/.worktrees/
 * - Respect sandbox config mode ('none' = no wrapping, 'docker' = wrap)
 * - Treat commands uniformly (no HOST: escape hatch)
 * - Clear workdir after wrapping (docker runs on host)
 * 
 * Note: These tests simulate the hook logic. The actual hook is in index.ts
 */

describe('tool.execute.before bash interception hook logic', () => {
  const mockDirectory = '/mock/project';
  const warcraftWorktreeBase = path.join(mockDirectory, '.beads/artifacts', '.worktrees');
  const worktreePath = path.join(warcraftWorktreeBase, 'feature-x', 'task-1');

  const isPathInside = (candidatePath: string, parentPath: string): boolean => {
    const absoluteCandidate = path.resolve(candidatePath);
    const absoluteParent = path.resolve(parentPath);
    const relative = path.relative(absoluteParent, absoluteCandidate);

    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };

  const shellQuoteArg = (arg: string): string => {
    if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) {
      return arg;
    }
    return `'${arg.replace(/'/g, "'\"'\"'")}'`;
  };

  const structuredToCommandString = (command: string, args: string[]): string => {
    return [command, ...args.map(shellQuoteArg)].join(' ');
  };

  /**
   * Simulates the hook logic from index.ts
   */
  const executeHook = (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
    sandboxConfig: { mode: 'none' | 'docker'; image?: string },
    directory: string
  ) => {
    if (input.tool !== "bash") return;
    
    if (sandboxConfig.mode === 'none') return;
    
    const command = output.args?.command?.trim();
    if (!command) return;
    
    
    // Only wrap commands with explicit workdir inside warcraft worktrees
    const workdir = output.args?.workdir;
    if (!workdir) return;
    
    const warcraftWorktreeBase = path.join(directory, '.beads/artifacts', '.worktrees');
    if (!isPathInside(workdir, warcraftWorktreeBase)) return;
    
    // Wrap command using static method
    const wrapped = DockerSandboxService.wrapCommand(workdir, command, sandboxConfig);
    output.args.command = typeof wrapped === 'string'
      ? wrapped
      : structuredToCommandString(wrapped.command, wrapped.args);
    output.args.workdir = undefined; // docker command runs on host
  };

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

      executeHook(input, output, sandboxConfig, mockDirectory);

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
      executeHook(input, output, sandboxConfig, mockDirectory);

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
      executeHook(input, output, sandboxConfig, mockDirectory);

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

      executeHook(input, output, sandboxConfig, mockDirectory);

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

      executeHook(input, output, sandboxConfig, mockDirectory);

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
      executeHook(input, output, sandboxConfig, mockDirectory);

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

      executeHook(input, output, sandboxConfig, mockDirectory);

      // Nothing should change (no workdir or command to modify)
      expect(output.args.filePath).toBe('/some/file.ts');
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

      executeHook(input, output, sandboxConfig, mockDirectory);

      // Nothing should change
      expect(output.args.filePath).toBe('/some/file.ts');
      expect(output.args.content).toBe('test');
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
      executeHook(input, output, sandboxConfig, mockDirectory);

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
        args: undefined,
      };

      // Should not throw, just return early
      expect(() => executeHook(input, output, sandboxConfig, mockDirectory)).not.toThrow();
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

      executeHook(input, output, sandboxConfig, mockDirectory);

      // Command should be wrapped with proper escaping
      expect(output.args.command).toContain('docker run');
      expect(output.args.command).toContain('echo "hello world" && ls -la');
      expect(output.args.workdir).toBeUndefined();
    });
  });

  describe('shellQuoteArg', () => {
    test('shellQuoteArg correctly quotes apostrophes', () => {
      const result = shellQuoteArg("hello'world");
      expect(result).toBe("'hello'\"'\"'world'");
    });

    test('shellQuoteArg passes through safe strings unchanged', () => {
      const result = shellQuoteArg('simple-arg_123');
      expect(result).toBe('simple-arg_123');
    });
  });
});
