/**
 * Audit: worktree-response.ts helper functions are dead code — they exist and have
 * tests, but are never imported by worktree-tools.ts which has its own inline logic.
 * Worse, buildTerminalCommitResult always claims "Changes committed" for worktree mode,
 * while the real inline code in worktree-tools.ts correctly branches on commitResult.committed.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const WORKTREE_TOOLS_PATH = path.resolve('packages/opencode-warcraft/src/tools/worktree-tools.ts');
const worktreeToolsContent = fs.readFileSync(WORKTREE_TOOLS_PATH, 'utf-8');

describe('worktree-response.ts dead code audit', () => {
  it('worktree-tools.ts should NOT import buildTerminalCommitResult from worktree-response', () => {
    // buildTerminalCommitResult has a latent bug: it always claims "Changes committed"
    // for worktree mode, missing the commitResult.committed=false case.
    // The real code in worktree-tools.ts handles this correctly inline.
    expect(worktreeToolsContent).not.toContain('buildTerminalCommitResult');
  });

  it('worktree-tools.ts should NOT import formatBlockedResponse from worktree-response', () => {
    // The inline code in worktree-tools.ts is the authoritative implementation
    expect(worktreeToolsContent).not.toContain("from './worktree-response");
  });

  it('worktree-tools.ts inline commit message should branch on commitResult.committed', () => {
    // The critical correctness check: the inline code must check commitResult.committed
    // to avoid claiming "Changes committed" when no commit was created
    const commitSection = worktreeToolsContent.slice(
      worktreeToolsContent.indexOf('commitWorktreeTool'),
      worktreeToolsContent.indexOf('discardWorktreeTool'),
    );
    expect(commitSection).toContain('commitResult.committed');
  });
});
