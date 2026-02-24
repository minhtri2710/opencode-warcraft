import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { DockerSandboxService } from '../services/dockerSandboxService.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as child_process from 'child_process';

describe('DockerSandboxService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docker-sandbox-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('detectImage', () => {
    test('returns null when Dockerfile exists', async () => {
      await fs.writeFile(path.join(tempDir, 'Dockerfile'), '# test');
      const result = DockerSandboxService.detectImage(tempDir);
      expect(result).toBe(null);
    });

    test('returns node:22-slim when package.json exists', async () => {
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
      const result = DockerSandboxService.detectImage(tempDir);
      expect(result).toBe('node:22-slim');
    });

    test('returns python:3.12-slim when requirements.txt exists', async () => {
      await fs.writeFile(path.join(tempDir, 'requirements.txt'), 'pytest');
      const result = DockerSandboxService.detectImage(tempDir);
      expect(result).toBe('python:3.12-slim');
    });

    test('returns python:3.12-slim when pyproject.toml exists', async () => {
      await fs.writeFile(path.join(tempDir, 'pyproject.toml'), '[tool.poetry]');
      const result = DockerSandboxService.detectImage(tempDir);
      expect(result).toBe('python:3.12-slim');
    });

    test('returns golang:1.22-slim when go.mod exists', async () => {
      await fs.writeFile(path.join(tempDir, 'go.mod'), 'module test');
      const result = DockerSandboxService.detectImage(tempDir);
      expect(result).toBe('golang:1.22-slim');
    });

    test('returns rust:1.77-slim when Cargo.toml exists', async () => {
      await fs.writeFile(path.join(tempDir, 'Cargo.toml'), '[package]');
      const result = DockerSandboxService.detectImage(tempDir);
      expect(result).toBe('rust:1.77-slim');
    });

    test('returns ubuntu:24.04 as fallback when no project files exist', () => {
      const result = DockerSandboxService.detectImage(tempDir);
      expect(result).toBe('ubuntu:24.04');
    });

    test('prioritizes Dockerfile over other files', async () => {
      await fs.writeFile(path.join(tempDir, 'Dockerfile'), '# test');
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
      const result = DockerSandboxService.detectImage(tempDir);
      expect(result).toBe(null);
    });
  });

  describe('buildRunCommand', () => {
    test('returns structured command with args array', () => {
      const result = DockerSandboxService.buildRunCommand('/path/to/worktree', 'npm test', 'node:22-slim');
      expect(result).toEqual({
        command: 'docker',
        args: ['run', '--rm', '-v', '/path/to/worktree:/app', '-w', '/app', 'node:22-slim', 'sh', '-c', 'npm test'],
      });
    });

    test('preserves commands with single quotes without shell escaping', () => {
      const result = DockerSandboxService.buildRunCommand('/path/to/worktree', "echo 'hello'", 'node:22-slim');
      expect(result).toEqual({
        command: 'docker',
        args: ['run', '--rm', '-v', '/path/to/worktree:/app', '-w', '/app', 'node:22-slim', 'sh', '-c', "echo 'hello'"],
      });
    });

    test('handles complex commands with pipes', () => {
      const result = DockerSandboxService.buildRunCommand('/path/to/worktree', 'bun test && echo done', 'node:22-slim');
      expect(result).toEqual({
        command: 'docker',
        args: ['run', '--rm', '-v', '/path/to/worktree:/app', '-w', '/app', 'node:22-slim', 'sh', '-c', 'bun test && echo done'],
      });
    });

    test('rejects image with shell injection via semicolon', () => {
      expect(() => DockerSandboxService.buildRunCommand('/path', 'ls', 'node:22; rm -rf /')).toThrow(/Invalid Docker image name/);
    });

    test('rejects image with backtick injection', () => {
      expect(() => DockerSandboxService.buildRunCommand('/path', 'ls', '`malicious`')).toThrow(/Invalid Docker image name/);
    });

    test('rejects image with dollar sign injection', () => {
      expect(() => DockerSandboxService.buildRunCommand('/path', 'ls', '$(whoami)')).toThrow(/Invalid Docker image name/);
    });

    test('accepts valid image names with registry and tag', () => {
      const result = DockerSandboxService.buildRunCommand('/path', 'ls', 'ghcr.io/org/image:v1.2.3');
      expect(result.args).toContain('ghcr.io/org/image:v1.2.3');
    });
  });

  describe('isDockerAvailable', () => {
    test('returns boolean based on docker availability', () => {
      const result = DockerSandboxService.isDockerAvailable();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('wrapCommand', () => {
    test('returns command unchanged when mode is none', async () => {
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
      const result = DockerSandboxService.wrapCommand(tempDir, 'npm test', { mode: 'none' });
      expect(result).toBe('npm test');
    });

    test('returns command unchanged when Dockerfile exists and no image override', async () => {
      await fs.writeFile(path.join(tempDir, 'Dockerfile'), '# test');
      const result = DockerSandboxService.wrapCommand(tempDir, 'npm test', { mode: 'docker' });
      expect(result).toBe('npm test');
    });

    test('wraps command and returns structured result when image is detected', async () => {
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
      const result = DockerSandboxService.wrapCommand(tempDir, 'npm test', { mode: 'docker' });
      expect(typeof result).toBe('object');
      expect((result as any).command).toBe('docker');
      expect((result as any).args).toContain('node:22-slim');
    });

    test('uses explicit image override even when Dockerfile exists', async () => {
      await fs.writeFile(path.join(tempDir, 'Dockerfile'), '# test');
      const result = DockerSandboxService.wrapCommand(tempDir, 'npm test', { mode: 'docker', image: 'node:20' });
      expect(typeof result).toBe('object');
      expect((result as any).args).toContain('node:20');
    });

    test('uses docker exec when persistent mode enabled', async () => {
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
      const execFileSyncSpy = spyOn(child_process, 'execFileSync').mockImplementation(() => '' as any);
      
      const worktreePath = '/repo/.beads/artifacts/.worktrees/my-feature/my-task';
      const result = DockerSandboxService.wrapCommand(worktreePath, 'npm test', { mode: 'docker', persistent: true });
      
      // Should return structured command with docker exec
      expect(typeof result).toBe('object');
      expect((result as any).command).toBe('docker');
      expect((result as any).args).toContain('exec');
      
      execFileSyncSpy.mockRestore();
    });

    test('uses docker run when persistent mode disabled', async () => {
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
      const result = DockerSandboxService.wrapCommand(tempDir, 'npm test', { mode: 'docker', persistent: false });
      expect(typeof result).toBe('object');
      expect((result as any).args).toContain('run');
    });
  });

  describe('containerName', () => {
    test('extracts feature and task from worktree path', () => {
      const worktreePath = '/home/user/project/.beads/artifacts/.worktrees/my-feature/my-task';
      const result = DockerSandboxService.containerName(worktreePath);
      expect(result).toBe('warcraft-my-feature-my-task');
    });

    test('handles complex feature and task names', () => {
      const worktreePath = '/repo/.beads/artifacts/.worktrees/v1.2.0-tighten-gates/07-implement-persistent-sandbox';
      const result = DockerSandboxService.containerName(worktreePath);
      expect(result).toBe('warcraft-v1-2-0-tighten-gates-07-implement-persistent-sandbox');
    });

    test('handles non-worktree paths gracefully', () => {
      const worktreePath = '/some/random/path';
      const result = DockerSandboxService.containerName(worktreePath);
      expect(result).toMatch(/^warcraft-sandbox-\d+$/);
    });

    test('truncates names longer than 63 characters', () => {
      const worktreePath = '/repo/.beads/artifacts/.worktrees/very-long-feature-name-that-goes-on-and-on/another-very-long-task-name';
      const result = DockerSandboxService.containerName(worktreePath);
      expect(result.length).toBeLessThanOrEqual(63);
    });
  });

  describe('ensureContainer', () => {
    test('returns existing container name when already running', () => {
      const execFileSyncSpy = spyOn(child_process, 'execFileSync').mockImplementation((...mockArgs: any[]) => {
        const [cmd, args] = mockArgs;
        if (cmd === 'docker' && Array.isArray(args) && args.includes('inspect')) {
          return 'true' as any;
        }
        return '' as any;
      });

      const worktreePath = '/repo/.beads/artifacts/.worktrees/my-feature/my-task';
      const result = DockerSandboxService.ensureContainer(worktreePath, 'node:22-slim');
      
      expect(result).toBe('warcraft-my-feature-my-task');
      expect(execFileSyncSpy).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['inspect']),
        expect.any(Object)
      );
      
      execFileSyncSpy.mockRestore();
    });

    test('creates new container when not found', () => {
      const calls: Array<readonly string[]> = [];
      const execFileSyncSpy = spyOn(child_process, 'execFileSync').mockImplementation((...mockArgs: any[]) => {
        const [cmd, args] = mockArgs;
        if (cmd === 'docker' && Array.isArray(args) && args.includes('inspect')) {
          throw new Error('container not found');
        }
        if (cmd === 'docker' && Array.isArray(args)) {
          calls.push(args);
        }
        return '' as any;
      });

      const worktreePath = '/repo/.beads/artifacts/.worktrees/my-feature/my-task';
      const result = DockerSandboxService.ensureContainer(worktreePath, 'node:22-slim');
      
      expect(result).toBe('warcraft-my-feature-my-task');
      // Should have called docker run -d ...
      expect(calls.some(c => c.includes('run') && c.includes('-d'))).toBe(true);
      expect(calls.some(c => c.includes('tail'))).toBe(true);
      
      execFileSyncSpy.mockRestore();
    });
  });

  describe('buildExecCommand', () => {
    test('returns structured command with args array', () => {
      const result = DockerSandboxService.buildExecCommand('warcraft-my-feature-my-task', 'npm test');
      expect(result).toEqual({
        command: 'docker',
        args: ['exec', 'warcraft-my-feature-my-task', 'sh', '-c', 'npm test'],
      });
    });

    test('preserves single quotes in commands without shell escaping', () => {
      const result = DockerSandboxService.buildExecCommand('my-container', "echo 'hello world'");
      expect(result).toEqual({
        command: 'docker',
        args: ['exec', 'my-container', 'sh', '-c', "echo 'hello world'"],
      });
    });

    test('handles complex commands with pipes and redirects', () => {
      const result = DockerSandboxService.buildExecCommand('my-container', 'cat file.txt | grep test');
      expect(result).toEqual({
        command: 'docker',
        args: ['exec', 'my-container', 'sh', '-c', 'cat file.txt | grep test'],
      });
    });
  });

  describe('command safety', () => {
    test('buildRunCommand returns structured args for paths with spaces', () => {
      const result = DockerSandboxService.buildRunCommand('/path with spaces/worktree', 'npm test', 'node:22-slim');
      // Volume mount is passed as a single arg element — no shell quoting needed
      expect(result.args).toContain('/path with spaces/worktree:/app');
    });

    test('buildRunCommand preserves commands with single quotes in args', () => {
      const result = DockerSandboxService.buildRunCommand('/app', "echo 'hello'", 'node:22-slim');
      expect(result.args[result.args.length - 1]).toBe("echo 'hello'");
    });

    test('buildExecCommand passes container name as direct arg', () => {
      const result = DockerSandboxService.buildExecCommand('my-container', 'ls');
      expect(result.args).toContain('my-container');
    });

    test('wrapCommand does not strip HOST: prefix', async () => {
      await fs.writeFile(path.join(tempDir, 'package.json'), '{}');
      const result = DockerSandboxService.wrapCommand(tempDir, 'HOST: rm -rf /', { mode: 'docker' });
      // Should return structured command wrapping the entire input
      expect(typeof result).toBe('object');
      expect((result as any).args).toContain('HOST: rm -rf /');
    });

    test('validateImage rejects semicolon injection in image', () => {
      expect(() => DockerSandboxService.validateImage('node:22; rm -rf /')).toThrow(/Invalid Docker image name/);
    });

    test('validateImage rejects backtick injection in image', () => {
      expect(() => DockerSandboxService.validateImage('`malicious`')).toThrow(/Invalid Docker image name/);
    });

    test('validateImage accepts standard image names', () => {
      expect(() => DockerSandboxService.validateImage('node:22-slim')).not.toThrow();
      expect(() => DockerSandboxService.validateImage('ubuntu:24.04')).not.toThrow();
      expect(() => DockerSandboxService.validateImage('ghcr.io/org/image:latest')).not.toThrow();
    });
  });

  describe('stopContainer', () => {
    test('calls docker rm -f with correct container name', () => {
      const execFileSyncSpy = spyOn(child_process, 'execFileSync').mockImplementation(() => '' as any);

      const worktreePath = '/repo/.beads/artifacts/.worktrees/my-feature/my-task';
      DockerSandboxService.stopContainer(worktreePath);
      
      expect(execFileSyncSpy).toHaveBeenCalledWith(
        'docker',
        ['rm', '-f', 'warcraft-my-feature-my-task'],
        { stdio: 'ignore', timeout: 15000 }
      );
      
      execFileSyncSpy.mockRestore();
    });

    test('silently ignores errors when container does not exist', () => {
      const execFileSyncSpy = spyOn(child_process, 'execFileSync').mockImplementation(() => {
        throw new Error('container not found');
      });

      const worktreePath = '/repo/.beads/artifacts/.worktrees/my-feature/my-task';
      expect(() => DockerSandboxService.stopContainer(worktreePath)).not.toThrow();
      
      execFileSyncSpy.mockRestore();
    });
  });
});
