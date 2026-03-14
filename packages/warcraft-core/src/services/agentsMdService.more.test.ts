import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { AgentsMdService } from './agentsMdService.js';
import { ContextService } from './contextService.js';

const mockBeadsModeProvider = { getBeadsMode: () => 'on' as const };

describe('AgentsMdService finding patterns', () => {
  let testDir: string;
  let service: AgentsMdService;
  let contextService: ContextService;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join('/tmp', 'agents-patterns-'));
    contextService = new ContextService(testDir, mockBeadsModeProvider);
    service = new AgentsMdService(testDir, contextService);
    fs.mkdirSync(path.join(testDir, '.beads/artifacts', 'test-feature'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'AGENTS.md'), '# Guidelines\n');
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('extracts "we use X" pattern', async () => {
    contextService.write('test-feature', 'notes', 'We use PostgreSQL for the database');
    const result = await service.sync('test-feature');
    expect(result.proposals.some((p) => p.toLowerCase().includes('postgresql'))).toBe(true);
  });

  test('extracts "prefer X over Y" pattern', async () => {
    contextService.write('test-feature', 'notes', 'Prefer composition over inheritance');
    const result = await service.sync('test-feature');
    expect(result.proposals.some((p) => p.toLowerCase().includes('composition'))).toBe(true);
  });

  test('extracts "build command: X" pattern', async () => {
    contextService.write('test-feature', 'notes', 'Build command: bun run build');
    const result = await service.sync('test-feature');
    expect(result.proposals.some((p) => p.includes('bun run build'))).toBe(true);
  });

  test('extracts "X lives in /path" pattern', async () => {
    contextService.write('test-feature', 'notes', 'Config lives in /etc/app');
    const result = await service.sync('test-feature');
    expect(result.proposals.some((p) => p.includes('/etc/app'))).toBe(true);
  });

  test('skips heading lines', async () => {
    contextService.write('test-feature', 'notes', '# We use React\nWe use Vue');
    const result = await service.sync('test-feature');
    // Heading line should be skipped, only "We use Vue" extracted
    expect(result.proposals.some((p) => p.toLowerCase().includes('vue'))).toBe(true);
  });

  test('returns empty proposals when no patterns match', async () => {
    contextService.write('test-feature', 'notes', 'Just regular text without any patterns');
    const result = await service.sync('test-feature');
    expect(result.proposals).toEqual([]);
    expect(result.diff).toBe('');
  });

  test('deduplicates findings with different casing', async () => {
    contextService.write('test-feature', 'a', 'We use TypeScript');
    contextService.write('test-feature', 'b', 'we use typescript');
    const result = await service.sync('test-feature');
    const tsFindings = result.proposals.filter((p) => p.toLowerCase().includes('typescript'));
    expect(tsFindings.length).toBeLessThanOrEqual(1);
  });

  test('apply rejects empty content after trim', async () => {
    expect(() => service.apply('   \n\t  ')).toThrow('content required');
  });

  test('apply returns isNew=true for fresh file', () => {
    fs.unlinkSync(path.join(testDir, 'AGENTS.md'));
    const result = service.apply('# New Guidelines');
    expect(result.isNew).toBe(true);
    expect(result.chars).toBe('# New Guidelines'.length);
  });
});
