import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNoopLogger } from '../utils/logger.js';
import { AgentsMdService } from './agentsMdService.js';

describe('agentsMdService deep scenarios', () => {
  describe('apply', () => {
    let tempDir: string;

    function setupProject(): string {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-deep-'));
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-proj' }));
      return tempDir;
    }

    function cleanup(): void {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    it('apply returns ApplyResult', () => {
      const dir = setupProject();
      const service = new AgentsMdService(dir, createNoopLogger());
      const result = service.apply('# AGENTS.md\n\n## Commands\n- Build: `npm run build`\n');
      expect(result).toBeDefined();
      cleanup();
    });

    it('apply with empty content throws', () => {
      const dir = setupProject();
      const service = new AgentsMdService(dir, createNoopLogger());
      expect(() => service.apply('')).toThrow();
      cleanup();
    });

    it('apply with complex AGENTS.md', () => {
      const dir = setupProject();
      const service = new AgentsMdService(dir, createNoopLogger());
      const content = `# AGENTS.md

## Commands
- Build: \`npm run build\`
- Test: \`npm test\`
- Lint: \`npm run lint\`

## Architecture
Monorepo with packages: core, web, cli

## Code Style
- TypeScript, ESM, 2-space indent
- PascalCase for types, camelCase for functions
`;
      const result = service.apply(content);
      expect(result).toBeDefined();
      cleanup();
    });
  });

  describe('init', () => {
    it('generates content for a minimal project', async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-init-'));
      try {
        fs.writeFileSync(
          path.join(tempDir, 'package.json'),
          JSON.stringify({
            name: 'test-project',
            scripts: { test: 'jest' },
          }),
        );
        const service = new AgentsMdService(tempDir, createNoopLogger());
        const result = await service.init();
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
