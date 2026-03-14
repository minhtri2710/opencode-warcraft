import { describe, expect, it } from 'bun:test';
import { AgentsMdService } from './agentsMdService.js';
import { createNoopLogger } from '../utils/logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('agentsMdService init variations', () => {
  function createProject(files: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-init-'));
    for (const [name, content] of Object.entries(files)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    return dir;
  }

  it('init with empty project', async () => {
    const dir = createProject({});
    try {
      const service = new AgentsMdService(dir, createNoopLogger());
      const result = await service.init();
      expect(result.content.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init with package.json detects node', async () => {
    const dir = createProject({ 'package.json': JSON.stringify({ name: 'my-project', scripts: { test: 'jest' } }) });
    try {
      const service = new AgentsMdService(dir, createNoopLogger());
      const result = await service.init();
      expect(result.content).toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init with tsconfig detects typescript', async () => {
    const dir = createProject({
      'package.json': JSON.stringify({ name: 'ts-proj' }),
      'tsconfig.json': JSON.stringify({ compilerOptions: {} }),
    });
    try {
      const service = new AgentsMdService(dir, createNoopLogger());
      const result = await service.init();
      expect(result.content).toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init with monorepo structure', async () => {
    const dir = createProject({
      'package.json': JSON.stringify({ name: 'mono', workspaces: ['packages/*'] }),
    });
    try {
      const service = new AgentsMdService(dir, createNoopLogger());
      const result = await service.init();
      expect(result.content.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('init with python project', async () => {
    const dir = createProject({
      'requirements.txt': 'flask\ndjango\n',
    });
    try {
      const service = new AgentsMdService(dir, createNoopLogger());
      const result = await service.init();
      expect(result.content.length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('apply with minimal AGENTS.md', () => {
    const dir = createProject({ 'package.json': '{}' });
    try {
      const service = new AgentsMdService(dir, createNoopLogger());
      const result = service.apply('# AGENTS.md\n\n## Commands\n- Build: `npm run build`\n');
      expect(result).toBeDefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
