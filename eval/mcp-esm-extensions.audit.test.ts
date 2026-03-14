import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

describe('ESM .js extension compliance in MCP module', () => {
  const mcpDir = join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src', 'mcp');
  const files = readdirSync(mcpDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  for (const file of files) {
    it(`${file} should use .js extensions on local imports`, () => {
      const content = readFileSync(join(mcpDir, file), 'utf-8');
      const badImports = content.match(/from\s+['"]\.\/.+(?<!\.js)['"]/g);
      expect(badImports).toBeNull();
    });
  }
});

function findTsFiles(dir: string, results: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      findTsFiles(full, results);
    } else if (entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

describe('ESM .js extension compliance across all source files', () => {
  const roots = [
    join(import.meta.dir, '..', 'packages', 'opencode-warcraft', 'src'),
    join(import.meta.dir, '..', 'packages', 'warcraft-core', 'src'),
  ];

  for (const root of roots) {
    const files = findTsFiles(root);
    for (const file of files) {
      const relative = file.replace(`${join(import.meta.dir, '..')}/`, '');
      it(`${relative} should use .js extensions on local imports`, () => {
        const content = readFileSync(file, 'utf-8');
        const localImportPattern = /from\s+['"](\.[^'"]+)['"]/g;
        let match: RegExpExecArray | null;
        const bad: string[] = [];
        while ((match = localImportPattern.exec(content)) !== null) {
          const specifier = match[1];
          if (!specifier.endsWith('.js')) {
            bad.push(specifier);
          }
        }
        expect(bad).toEqual([]);
      });
    }
  }
});
