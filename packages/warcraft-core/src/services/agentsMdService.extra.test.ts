import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { AgentsMdService } from './agentsMdService.js';
import { ContextService } from './contextService.js';

const mockBeadsModeProvider = {
  getBeadsMode: () => 'on' as const,
};

describe('AgentsMdService additional edge cases', () => {
  let testDir: string;
  let service: AgentsMdService;
  let contextService: ContextService;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join('/tmp', 'agents-md-extra-'));
    contextService = new ContextService(testDir, mockBeadsModeProvider);
    service = new AgentsMdService(testDir, contextService);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('scanAndGenerate()', () => {
    test('detects TypeScript language from tsconfig.json', async () => {
      fs.writeFileSync(path.join(testDir, 'tsconfig.json'), '{}');
      const result = await service.init();
      expect(result.content).toContain('TypeScript');
    });

    test('detects pnpm from pnpm-lock.yaml', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(testDir, 'pnpm-lock.yaml'), '');
      const result = await service.init();
      expect(result.content).toContain('pnpm');
    });

    test('detects yarn from yarn.lock', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(testDir, 'yarn.lock'), '');
      const result = await service.init();
      expect(result.content).toContain('yarn');
    });

    test('detects npm from package-lock.json', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), '{}');
      fs.writeFileSync(path.join(testDir, 'package-lock.json'), '{}');
      const result = await service.init();
      expect(result.content).toContain('npm');
    });

    test('detects Python language from requirements.txt', async () => {
      fs.writeFileSync(path.join(testDir, 'requirements.txt'), 'pytest');
      const result = await service.init();
      expect(result.content).toContain('Python');
    });

    test('detects Go language from go.mod', async () => {
      fs.writeFileSync(path.join(testDir, 'go.mod'), 'module example');
      const result = await service.init();
      expect(result.content).toContain('Go');
    });

    test('detects Rust language from Cargo.toml', async () => {
      fs.writeFileSync(path.join(testDir, 'Cargo.toml'), '[package]');
      const result = await service.init();
      expect(result.content).toContain('Rust');
    });

    test('detects vitest framework', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ devDependencies: { vitest: '^1.0.0' } }));
      const result = await service.init();
      expect(result.content).toContain('vitest');
    });

    test('detects jest framework', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ devDependencies: { jest: '^29.0.0' } }));
      const result = await service.init();
      expect(result.content).toContain('jest');
    });

    test('generates template with build/test/dev commands', async () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({
          scripts: { build: 'tsc', test: 'vitest', dev: 'vite' },
          devDependencies: { vitest: '^1.0.0' },
        }),
      );
      const result = await service.init();
      expect(result.content).toContain('Build');
      expect(result.content).toContain('Run tests');
      expect(result.content).toContain('Development mode');
    });

    test('handles missing scripts gracefully', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'no-scripts' }));
      const result = await service.init();
      expect(result.existed).toBe(false);
      expect(result.content.length).toBeGreaterThan(0);
    });

    test('handles invalid package.json gracefully', async () => {
      fs.writeFileSync(path.join(testDir, 'package.json'), 'not json at all');
      const result = await service.init();
      expect(result.existed).toBe(false);
      expect(result.content.length).toBeGreaterThan(0);
    });

    test('detects workspaces with object format', async () => {
      fs.writeFileSync(
        path.join(testDir, 'package.json'),
        JSON.stringify({ workspaces: { packages: ['packages/*'] } }),
      );
      const result = await service.init();
      expect(result.content).toContain('monorepo');
    });

    test('defaults to Unknown language and npm when no indicators found', async () => {
      const result = await service.init();
      expect(result.content).toContain('npm');
    });
  });

  describe('sync() edge cases', () => {
    beforeEach(() => {
      const featurePath = path.join(testDir, '.beads/artifacts', 'sync-feature');
      fs.mkdirSync(featurePath, { recursive: true });
    });

    test('extracts "don\'t use" pattern findings', async () => {
      fs.writeFileSync(path.join(testDir, 'AGENTS.md'), '# Agent Guidelines\n');
      contextService.write('sync-feature', 'conventions', "Don't use eval in any module");
      const result = await service.sync('sync-feature');
      expect(result.proposals.length).toBeGreaterThanOrEqual(1);
      expect(result.proposals.some((p) => p.includes('eval'))).toBe(true);
    });

    test('extracts "do not use" pattern findings', async () => {
      fs.writeFileSync(path.join(testDir, 'AGENTS.md'), '# Agent Guidelines\n');
      contextService.write('sync-feature', 'rules', 'Do not use var declarations anywhere');
      const result = await service.sync('sync-feature');
      expect(result.proposals.length).toBeGreaterThanOrEqual(1);
    });

    test('extracts path location pattern findings', async () => {
      fs.writeFileSync(path.join(testDir, 'AGENTS.md'), '# Agent Guidelines\n');
      contextService.write('sync-feature', 'arch', 'Auth lives in /lib/auth');
      const result = await service.sync('sync-feature');
      expect(result.proposals.some((p) => p.includes('/lib/auth'))).toBe(true);
    });

    test('handles missing AGENTS.md file during sync', async () => {
      contextService.write('sync-feature', 'notes', 'We use React');
      const result = await service.sync('sync-feature');
      // All findings should be proposals since AGENTS.md doesn't exist
      expect(result.proposals.length).toBeGreaterThanOrEqual(1);
    });

    test('formatDiff returns + prefixed lines', async () => {
      fs.writeFileSync(path.join(testDir, 'AGENTS.md'), '# Guidelines\n');
      contextService.write('sync-feature', 'notes', 'We use React\nWe use TypeScript');
      const result = await service.sync('sync-feature');
      if (result.diff) {
        const lines = result.diff.split('\n');
        for (const line of lines) {
          expect(line).toStartWith('+ ');
        }
      }
    });
  });
});
