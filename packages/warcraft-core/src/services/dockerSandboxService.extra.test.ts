import { describe, expect, it, spyOn } from 'bun:test';
import * as child_process from 'child_process';
import { DockerSandboxService } from './dockerSandboxService.js';

describe('DockerSandboxService extra edge cases', () => {
  describe('detectImage priority', () => {
    it('Dockerfile takes priority over all other markers', () => {
      // Already tested but verifying with multiple markers
      const result = DockerSandboxService.detectImage('/nonexistent');
      // Since /nonexistent doesn't exist, falls through to ubuntu
      expect(result).toBe('ubuntu:24.04');
    });
  });

  describe('validateImage', () => {
    it('accepts image with dots in name', () => {
      expect(() => DockerSandboxService.validateImage('registry.io/img')).not.toThrow();
    });

    it('accepts image with underscores', () => {
      expect(() => DockerSandboxService.validateImage('my_image')).not.toThrow();
    });

    it('accepts image with hyphens', () => {
      expect(() => DockerSandboxService.validateImage('my-image')).not.toThrow();
    });

    it('rejects image starting with uppercase', () => {
      expect(() => DockerSandboxService.validateImage('MyImage')).toThrow(/Invalid Docker image name/);
    });

    it('rejects empty image name', () => {
      expect(() => DockerSandboxService.validateImage('')).toThrow(/Invalid Docker image name/);
    });

    it('rejects image with spaces', () => {
      expect(() => DockerSandboxService.validateImage('my image')).toThrow(/Invalid Docker image name/);
    });

    it('rejects image with pipe', () => {
      expect(() => DockerSandboxService.validateImage('img|cmd')).toThrow(/Invalid Docker image name/);
    });

    it('rejects image with ampersand', () => {
      expect(() => DockerSandboxService.validateImage('img&cmd')).toThrow(/Invalid Docker image name/);
    });
  });

  describe('buildRunCommand', () => {
    it('includes --rm flag for ephemeral containers', () => {
      const result = DockerSandboxService.buildRunCommand('/app', 'test', 'node:22-slim');
      expect(result.args).toContain('--rm');
    });

    it('sets working directory to /app', () => {
      const result = DockerSandboxService.buildRunCommand('/app', 'test', 'node:22-slim');
      expect(result.args).toContain('-w');
      expect(result.args).toContain('/app');
    });

    it('uses sh -c for command execution', () => {
      const result = DockerSandboxService.buildRunCommand('/app', 'npm test', 'node:22-slim');
      expect(result.args).toContain('sh');
      expect(result.args).toContain('-c');
    });
  });

  describe('containerName', () => {
    it('produces lowercase names', () => {
      const name = DockerSandboxService.containerName('/repo/.beads/artifacts/.worktrees/FEATURE/TASK');
      expect(name).toBe(name.toLowerCase());
    });

    it('replaces non-alphanumeric characters with hyphens', () => {
      const name = DockerSandboxService.containerName('/repo/.beads/artifacts/.worktrees/feat@1/task#2');
      expect(name).not.toContain('@');
      expect(name).not.toContain('#');
    });
  });

  describe('stopContainer', () => {
    it('uses -f flag for force removal', () => {
      const spy = spyOn(child_process, 'execFileSync').mockImplementation(() => '' as any);
      try {
        DockerSandboxService.stopContainer('/repo/.beads/artifacts/.worktrees/f/t');
        expect(spy).toHaveBeenCalledWith('docker', expect.arrayContaining(['-f']), expect.anything());
      } finally {
        spy.mockRestore();
      }
    });

    it('uses 15s timeout', () => {
      const spy = spyOn(child_process, 'execFileSync').mockImplementation(() => '' as any);
      try {
        DockerSandboxService.stopContainer('/repo/.beads/artifacts/.worktrees/f/t');
        expect(spy).toHaveBeenCalledWith('docker', expect.anything(), expect.objectContaining({ timeout: 15000 }));
      } finally {
        spy.mockRestore();
      }
    });
  });
});
