import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('ESM .js extension compliance in MCP module', () => {
  const mcpDir = join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'mcp');
  const files = readdirSync(mcpDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  for (const file of files) {
    it(`${file} should use .js extensions on local imports`, () => {
      const content = readFileSync(join(mcpDir, file), 'utf-8');
      // Match local relative imports that are missing .js extension
      const badImports = content.match(/from\s+['"]\.\/.+(?<!\.js)['"]/g);
      expect(badImports).toBeNull();
    });
  }
});
