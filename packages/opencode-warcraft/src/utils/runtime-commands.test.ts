import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { RuntimeKind } from './runtime-commands.js';
import { detectRuntime, getVerificationCommands, getVerificationCommandsForCwd } from './runtime-commands.js';

describe('runtime-commands', () => {
  function withTempDir(fn: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-cmd-test-'));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  describe('detectRuntime()', () => {
    it('detects bun from bun.lockb', () => {
      withTempDir((dir) => {
        writeFileSync(join(dir, 'bun.lockb'), '');
        expect(detectRuntime(dir)).toBe('bun');
      });
    });

    it('detects bun from bun.lock', () => {
      withTempDir((dir) => {
        writeFileSync(join(dir, 'bun.lock'), '');
        expect(detectRuntime(dir)).toBe('bun');
      });
    });

    it('detects pnpm', () => {
      withTempDir((dir) => {
        writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
        expect(detectRuntime(dir)).toBe('pnpm');
      });
    });

    it('detects yarn', () => {
      withTempDir((dir) => {
        writeFileSync(join(dir, 'yarn.lock'), '');
        expect(detectRuntime(dir)).toBe('yarn');
      });
    });

    it('detects npm', () => {
      withTempDir((dir) => {
        writeFileSync(join(dir, 'package-lock.json'), '');
        expect(detectRuntime(dir)).toBe('npm');
      });
    });

    it('defaults to bun when no lockfile found', () => {
      withTempDir((dir) => {
        expect(detectRuntime(dir)).toBe('bun');
      });
    });

    it('prefers bun over npm when both lockfiles exist', () => {
      withTempDir((dir) => {
        writeFileSync(join(dir, 'bun.lockb'), '');
        writeFileSync(join(dir, 'package-lock.json'), '');
        expect(detectRuntime(dir)).toBe('bun');
      });
    });
  });

  describe('getVerificationCommands()', () => {
    it('returns bun commands', () => {
      const cmds = getVerificationCommands('bun');
      expect(cmds.build).toBe('bun run build');
      expect(cmds.test).toBe('bun run test');
    });

    it('returns npm commands', () => {
      const cmds = getVerificationCommands('npm');
      expect(cmds.build).toBe('npm run build');
      expect(cmds.test).toBe('npm run test');
    });

    it('returns yarn commands', () => {
      const cmds = getVerificationCommands('yarn');
      expect(cmds.build).toBe('yarn build');
      expect(cmds.test).toBe('yarn test');
    });

    it('returns pnpm commands', () => {
      const cmds = getVerificationCommands('pnpm');
      expect(cmds.build).toBe('pnpm run build');
      expect(cmds.test).toBe('pnpm run test');
    });
  });

  describe('getVerificationCommandsForCwd()', () => {
    it('detects and returns correct commands', () => {
      withTempDir((dir) => {
        writeFileSync(join(dir, 'yarn.lock'), '');
        const cmds = getVerificationCommandsForCwd(dir);
        expect(cmds.build).toBe('yarn build');
        expect(cmds.test).toBe('yarn test');
      });
    });
  });
});
