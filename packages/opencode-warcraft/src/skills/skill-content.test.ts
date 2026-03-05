import { describe, expect, it } from 'bun:test';
import { BUILTIN_SKILLS } from './registry.generated.js';

describe('skill content', () => {
  it('documents task() fan-out paths for parallel-exploration', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'parallel-exploration');

    expect(skill).toBeDefined();
    expect(skill!.template).toContain('task({');
    expect(skill!.template).toContain('Parallelize by issuing multiple task() calls in the same assistant message.');
  });

  it('includes task() parallel guidance for dispatching-parallel-agents', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'dispatching-parallel-agents');

    expect(skill).toBeDefined();
    expect(skill!.template).toContain('task({');
    expect(skill!.template).toContain('Parallelize by issuing multiple task() calls in the same assistant message.');
  });

  it('includes br skill with critical operational guardrails', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'br');

    expect(skill).toBeDefined();
    expect(skill!.template).toContain('**ALWAYS use `--json`**');
    expect(skill!.template).toContain('**NEVER run bare `bv`**');
    expect(skill!.template).toContain('br sync --flush-only');
  });

  it('includes finishing workflow option set and destructive confirmation', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'finishing-a-development-branch');

    expect(skill).toBeDefined();
    expect(skill!.template).toContain('Present exactly these 4 options');
    expect(skill!.template).toContain("Type 'discard' to confirm.");
  });

  it('includes subagent integration with finishing and bundled prompt references', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'subagent-driven-development');

    expect(skill).toBeDefined();
    expect(skill!.template).toContain('Use finishing-a-development-branch');
    expect(skill!.template).toContain('warcraft_status');
    expect(skill!.template).toContain('warcraft_worktree_create');
    expect(skill!.template).toContain('warcraft_worktree_commit');
    expect(skill!.template).toContain('./references/IMPLEMENTER_PROMPT.md');
    expect(skill!.template).toContain('Reference: IMPLEMENTER_PROMPT');
    expect(skill!.template).toContain('Reference: SPEC_REVIEWER_PROMPT');
    expect(skill!.template).toContain('Reference: CODE_QUALITY_REVIEWER_PROMPT');
  });
});
