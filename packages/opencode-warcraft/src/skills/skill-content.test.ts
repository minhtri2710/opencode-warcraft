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
    expect(skill!.template).toContain('mode: "append"');
    expect(skill!.template).toContain('execution-decisions');
  });

  it('includes append-mode execution decision guidance for executing-plans', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'executing-plans');

    expect(skill).toBeDefined();
    expect(skill!.template).toContain('mode: "append"');
    expect(skill!.template).toContain('execution-decisions');
  });

  it('includes br skill with critical operational guardrails', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'br');

    expect(skill).toBeDefined();
    expect(skill!.template).toContain('**ALWAYS use `--json`**');
    expect(skill!.template).toContain('**NEVER run bare `bv`**');
    expect(skill!.template).toContain('br sync --flush-only');
    expect(skill!.template).toContain('br config --list');
    expect(skill!.template).toContain('br config --get id.prefix');
    expect(skill!.template).toContain('br config --set defaults.priority=1');
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

  it('keeps workspace guidance aligned with direct-mode support in using-git-worktrees', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'using-git-worktrees');

    expect(skill).toBeDefined();
    expect(skill!.template).not.toContain('Create isolated worktree');
    expect(skill!.template).toContain('Prepare the task workspace');
    expect(skill!.template).toContain('Issue the returned `task()` call');
  });

  it('keeps warcraft skill workspace guidance aligned with returned-task orchestration', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'warcraft');

    expect(skill).toBeDefined();
    expect(skill!.template).not.toContain('Executes tasks in worktrees');
    expect(skill!.template).toContain('Executes tasks in assigned workspace');
    expect(skill!.template).toContain('Issue the newly returned `task()` call to relaunch the worker');
  });

  it('keeps dispatching-parallel-agents aligned with returned task() payload semantics', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'dispatching-parallel-agents');

    expect(skill).toBeDefined();
    expect(skill!.template).not.toContain('isolated worktrees');
    expect(skill!.template).toContain('returns a task() payload');
    expect(skill!.template).toContain('Issue all returned task() calls in the same assistant message');
  });

  it('keeps subagent-driven-development aligned with assigned workspace semantics', () => {
    const skill = BUILTIN_SKILLS.find((entry) => entry.name === 'subagent-driven-development');

    expect(skill).toBeDefined();
    expect(skill!.template).not.toContain('Start each task in isolated workspace via `warcraft_worktree_create`');
    expect(skill!.template).toContain('issue the returned `task()` call in the assigned workspace');
  });

  it('keeps remaining workspace wording aligned in warcraft and writing-plans skills', () => {
    const warcraftSkill = BUILTIN_SKILLS.find((entry) => entry.name === 'warcraft');
    const writingPlansSkill = BUILTIN_SKILLS.find((entry) => entry.name === 'writing-plans');
    const subagentDrivenSkill = BUILTIN_SKILLS.find((entry) => entry.name === 'subagent-driven-development');

    expect(warcraftSkill).toBeDefined();
    expect(warcraftSkill!.template).not.toContain('[Mekkatorque implements in worktree]');
    expect(warcraftSkill!.template).toContain('[Mekkatorque implements in the assigned workspace]');
    expect(warcraftSkill!.template).not.toContain('creates the worktree and returns delegation instructions');
    expect(warcraftSkill!.template).toContain('prepares the task workspace and returns delegation instructions');
    expect(warcraftSkill!.template).not.toContain('Create worktree + delegation instructions');
    expect(warcraftSkill!.template).toContain('Prepare task workspace + delegation instructions');

    expect(writingPlansSkill).toBeDefined();
    expect(writingPlansSkill!.template).not.toContain('Guide them to open new session in worktree');
    expect(writingPlansSkill!.template).toContain(
      'Guide them to open a new execution session in the appropriate Warcraft-managed workspace',
    );

    expect(subagentDrivenSkill).toBeDefined();
    expect(subagentDrivenSkill!.template).not.toContain('Set up isolated workspace before starting');
    expect(subagentDrivenSkill!.template).toContain('Set up the Warcraft-managed workspace before starting');
  });
});
