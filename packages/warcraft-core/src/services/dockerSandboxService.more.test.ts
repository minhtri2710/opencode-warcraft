import { describe, expect, it } from 'bun:test';
import { DockerSandboxService } from './dockerSandboxService.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('DockerSandboxService more', () => {
  describe('validateImage', () => {
    it('accepts valid image names', () => {
      expect(() => DockerSandboxService.validateImage('ubuntu:latest')).not.toThrow();
      expect(() => DockerSandboxService.validateImage('node:20')).not.toThrow();
      expect(() => DockerSandboxService.validateImage('alpine')).not.toThrow();
    });

    it('throws for empty image', () => {
      expect(() => DockerSandboxService.validateImage('')).toThrow();
    });

    it('throws for image with special chars', () => {
      expect(() => DockerSandboxService.validateImage('image; rm -rf /')).toThrow();
    });
  });

  describe('detectImage', () => {
    it('returns string or null for empty directory', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-detect-'));
      try {
        const result = DockerSandboxService.detectImage(tempDir);
        expect(result === null || typeof result === 'string').toBe(true);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('detects node project', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-node-'));
      try {
        fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
        const result = DockerSandboxService.detectImage(tempDir);
        expect(result).not.toBeNull();
        expect(result).toContain('node');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('detects python project', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-py-'));
      try {
        fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'flask');
        const result = DockerSandboxService.detectImage(tempDir);
        expect(result).not.toBeNull();
        expect(result).toContain('python');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('buildRunCommand', () => {
    it('returns structured command', () => {
      const result = DockerSandboxService.buildRunCommand('/workspace', 'echo hello', 'ubuntu:latest');
      expect(result).toBeDefined();
      expect(result.command).toBeDefined();
      expect(result.args).toBeDefined();
    });

    it('includes docker in command', () => {
      const result = DockerSandboxService.buildRunCommand('/workspace', 'ls', 'alpine');
      expect(result.command).toBe('docker');
    });

    it('includes image in args', () => {
      const result = DockerSandboxService.buildRunCommand('/workspace', 'ls', 'ubuntu:22.04');
      expect(result.args.join(' ')).toContain('ubuntu:22.04');
    });
  });
});
