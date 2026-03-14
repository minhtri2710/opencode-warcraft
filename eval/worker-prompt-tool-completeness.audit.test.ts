/**
 * Audit: worker prompt "have access to" section must list all tools
 * in Mekkatorque's allowlist from tool-permissions.ts.
 * Without this, workers don't know they can use warcraft_skill.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const WORKER_PROMPT_PATH = path.resolve('packages/opencode-warcraft/src/utils/worker-prompt.ts');
const TOOL_PERMISSIONS_PATH = path.resolve('packages/opencode-warcraft/src/agents/tool-permissions.ts');
const workerContent = fs.readFileSync(WORKER_PROMPT_PATH, 'utf-8');
const permissionsContent = fs.readFileSync(TOOL_PERMISSIONS_PATH, 'utf-8');

describe('worker prompt tool access completeness', () => {
  it('should list warcraft_skill in the "have access to" section', () => {
    const accessSection = workerContent.slice(
      workerContent.indexOf('**You have access to:**'),
      workerContent.indexOf('**You do NOT have access to'),
    );
    expect(accessSection).toContain('warcraft_skill');
  });

  it('should list all mekkatorque allowlist tools in "have access to"', () => {
    // Extract mekkatorque allowlist from tool-permissions.ts
    const mekkMatch = permissionsContent.match(/mekkatorque:\s*\[([^\]]+)\]/s);
    expect(mekkMatch).toBeTruthy();
    const allowlistStr = mekkMatch![1];
    const tools = allowlistStr.match(/'warcraft_[a-z_]+'/g)!.map((t) => t.replace(/'/g, ''));

    const accessSection = workerContent.slice(
      workerContent.indexOf('**You have access to:**'),
      workerContent.indexOf('**You do NOT have access to'),
    );

    for (const tool of tools) {
      expect(accessSection).toContain(tool);
    }
  });
});
