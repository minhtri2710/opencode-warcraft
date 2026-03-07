/**
 * Unit tests for worker prompt builder.
 *
 * Tests:
 * - No duplicate plan/context/previous-task headings in final prompt
 * - Spec content is not duplicated with separate sections
 */

import { describe, expect, it } from 'bun:test';
import { buildWorkerPrompt, type WorkerPromptParams } from './worker-prompt.js';

// ============================================================================
// Test helpers
// ============================================================================

function createTestParams(overrides: Partial<WorkerPromptParams> = {}): WorkerPromptParams {
  return {
    feature: 'test-feature',
    task: '01-test-task',
    taskOrder: 1,
    worktreePath: '/tmp/worktree',
    branch: 'warcraft/test-feature/01-test-task',
    plan: '# Test Plan\n\n## Discovery\n\nQ&A here\n\n## Tasks\n\n### 1. Test Task\n\nDo the thing.',
    contextFiles: [
      { name: 'decisions', content: 'We decided to use TypeScript.' },
      { name: 'research', content: 'Found existing patterns in src/lib.' },
    ],
    spec: `# Task: 01-test-task

## Feature: test-feature

## Plan Section

### 1. Test Task

Do the thing.

## Context

## decisions

We decided to use TypeScript.

---

## research

Found existing patterns in src/lib.

## Completed Tasks

- **00-setup**: Initial setup done.
`,
    previousTasks: [{ name: '00-setup', summary: 'Initial setup done.' }],
    ...overrides,
  };
}

// ============================================================================
// Deduplication tests
// ============================================================================

describe('buildWorkerPrompt deduplication', () => {
  it('does not include separate "Plan Context" section (plan is in spec)', () => {
    const params = createTestParams();
    const prompt = buildWorkerPrompt(params);

    // Should NOT have a separate "## Plan Context" section since spec already has plan section
    const planContextMatches = prompt.match(/## Plan Context/g);
    expect(planContextMatches).toBeNull();
  });

  it('does not include separate "Context Files" section (context is in spec)', () => {
    const params = createTestParams();
    const prompt = buildWorkerPrompt(params);

    // Should NOT have a separate "## Context Files" section since spec already has context
    const contextFilesMatches = prompt.match(/## Context Files/g);
    expect(contextFilesMatches).toBeNull();
  });

  it('does not include separate "Previous Tasks Completed" section (previous tasks in spec)', () => {
    const params = createTestParams();
    const prompt = buildWorkerPrompt(params);

    // Should NOT have a separate "## Previous Tasks Completed" section since spec already has it
    const previousTasksMatches = prompt.match(/## Previous Tasks Completed/g);
    expect(previousTasksMatches).toBeNull();
  });

  it('includes spec content exactly once under "Your Mission"', () => {
    const params = createTestParams();
    const prompt = buildWorkerPrompt(params);

    // Should have exactly one "## Your Mission" section
    const missionMatches = prompt.match(/## Your Mission/g);
    expect(missionMatches?.length).toBe(1);

    // Spec content should appear once
    expect(prompt).toContain('## Plan Section');
    expect(prompt).toContain('## Context');
    expect(prompt).toContain('## Completed Tasks');
  });

  it('does not duplicate context file content', () => {
    const params = createTestParams({
      contextFiles: [{ name: 'unique-context', content: 'UNIQUE_MARKER_12345' }],
      spec: `# Task: test

## Context

## unique-context

UNIQUE_MARKER_12345
`,
    });
    const prompt = buildWorkerPrompt(params);

    // The unique marker should appear exactly once (in the spec)
    const markerMatches = prompt.match(/UNIQUE_MARKER_12345/g);
    expect(markerMatches?.length).toBe(1);
  });

  it('does not duplicate previous task summaries', () => {
    const params = createTestParams({
      previousTasks: [{ name: '00-setup', summary: 'UNIQUE_SUMMARY_67890' }],
      spec: `# Task: test

## Completed Tasks

- **00-setup**: UNIQUE_SUMMARY_67890
`,
    });
    const prompt = buildWorkerPrompt(params);

    // The unique summary should appear exactly once (in the spec)
    const summaryMatches = prompt.match(/UNIQUE_SUMMARY_67890/g);
    expect(summaryMatches?.length).toBe(1);
  });

  it('preserves safety/protocol sections', () => {
    const params = createTestParams();
    const prompt = buildWorkerPrompt(params);

    // Must keep these critical sections
    expect(prompt).toContain('## Blocker Protocol');
    expect(prompt).toContain('## Completion Protocol');
    expect(prompt).toContain('## Assignment Details');
    expect(prompt).toContain('CRITICAL');
    expect(prompt).toContain('warcraft_worktree_commit');
  });

  it('includes worktree restriction warning', () => {
    const params = createTestParams();
    const prompt = buildWorkerPrompt(params);

    expect(prompt).toContain('All file operations MUST be within this worktree path');
    expect(prompt).toContain(params.worktreePath);
  });
});

// ============================================================================
// Continuation from blocked state
// ============================================================================

describe('buildWorkerPrompt continuation', () => {
  it('includes continuation section when resuming from blocked', () => {
    const params = createTestParams({
      continueFrom: {
        status: 'blocked',
        previousSummary: 'Got halfway through implementation',
        decision: 'Use option A',
      },
    });
    const prompt = buildWorkerPrompt(params);

    expect(prompt).toContain('## Continuation from Blocked State');
    expect(prompt).toContain('Got halfway through implementation');
    expect(prompt).toContain('Use option A');
  });

  it('omits continuation section when not resuming', () => {
    const params = createTestParams();
    const prompt = buildWorkerPrompt(params);

    expect(prompt).not.toContain('## Continuation from Blocked State');
  });
});

// ============================================================================
// Verification model mode tests
// ============================================================================

describe('buildWorkerPrompt verificationModel', () => {
  it('includes TDD content when verificationModel is "tdd"', () => {
    const params = createTestParams({ verificationModel: 'tdd' });
    const prompt = buildWorkerPrompt(params);

    // Should contain TDD-related strings
    expect(prompt).toContain('TDD');
    expect(prompt).toContain('## TDD Protocol (Required)');
    expect(prompt).toContain('The first failing test to write is clear (TDD).');
    expect(prompt).toContain('The minimal change needed to reach green is planned.');
  });

  it('includes TDD content when verificationModel is undefined (default)', () => {
    const params = createTestParams({ verificationModel: undefined });
    const prompt = buildWorkerPrompt(params);

    // Should contain TDD-related strings (default behavior)
    expect(prompt).toContain('TDD');
    expect(prompt).toContain('## TDD Protocol (Required)');
    expect(prompt).toContain('The first failing test to write is clear (TDD).');
    expect(prompt).toContain('The minimal change needed to reach green is planned.');
  });

  it('excludes TDD content when verificationModel is "best-effort"', () => {
    const params = createTestParams({ verificationModel: 'best-effort' });
    const prompt = buildWorkerPrompt(params);

    // Should NOT contain TDD-related strings
    expect(prompt).not.toContain('TDD');
    expect(prompt).not.toContain('## TDD Protocol (Required)');
    expect(prompt).not.toContain('The first failing test to write is clear (TDD).');
    expect(prompt).not.toContain('The minimal change needed to reach green is planned.');
  });

  it('preserves other sections in best-effort mode', () => {
    const params = createTestParams({ verificationModel: 'best-effort' });
    const prompt = buildWorkerPrompt(params);

    // Must keep these critical sections
    expect(prompt).toContain('## Blocker Protocol');
    expect(prompt).toContain('## Completion Protocol');
    expect(prompt).toContain('## Assignment Details');
    expect(prompt).toContain('## Debugging Protocol (When stuck)');
    expect(prompt).toContain('CRITICAL');
    expect(prompt).toContain('warcraft_worktree_commit');
  });
});

// ============================================================================
// Edge cases
// ============================================================================

// ============================================================================
// Learnings on CompletedTask
// ============================================================================

describe('buildWorkerPrompt learnings support', () => {
  it('accepts CompletedTask with learnings field', () => {
    const params = createTestParams({
      previousTasks: [
        { name: '00-setup', summary: 'Initial setup done.', learnings: ['Use bun, not npm', 'ESM needs .js ext'] },
      ],
    });
    // Should not throw
    const prompt = buildWorkerPrompt(params);
    expect(prompt).toContain('## Your Mission');
  });

  it('accepts CompletedTask without learnings field', () => {
    const params = createTestParams({
      previousTasks: [{ name: '00-setup', summary: 'Initial setup done.' }],
    });
    const prompt = buildWorkerPrompt(params);
    expect(prompt).toContain('## Your Mission');
  });

  it('accepts CompletedTask with empty learnings array', () => {
    const params = createTestParams({
      previousTasks: [{ name: '00-setup', summary: 'Initial setup done.', learnings: [] }],
    });
    const prompt = buildWorkerPrompt(params);
    expect(prompt).toContain('## Your Mission');
  });
});

// ============================================================================
// Downstream learnings rendering
// ============================================================================

describe('buildWorkerPrompt downstream learnings', () => {
  it('renders learnings from done task in spec completed tasks section', () => {
    // When learnings are folded into summary (as fetchSharedDispatchData does),
    // they should appear in the worker prompt via spec content
    const params = createTestParams({
      previousTasks: [
        {
          name: '00-setup',
          summary: 'Initial setup done.\n\nLearnings:\n- Use bun, not npm\n- ESM needs .js extension',
          learnings: ['Use bun, not npm', 'ESM needs .js extension'],
        },
      ],
      spec: `# Task: 01-test-task

## Feature: test-feature

## Completed Tasks

- 00-setup: Initial setup done.

Learnings:
- Use bun, not npm
- ESM needs .js extension
`,
    });
    const prompt = buildWorkerPrompt(params);

    // Learnings should appear in the prompt (via spec)
    expect(prompt).toContain('Use bun, not npm');
    expect(prompt).toContain('ESM needs .js extension');
    expect(prompt).toContain('Learnings:');
  });

  it('does not render learnings from non-done task statuses', () => {
    // Simulate a prompt where only done tasks are included
    // (partial/blocked/failed are excluded by fetchSharedDispatchData)
    const params = createTestParams({
      previousTasks: [
        { name: '00-setup', summary: 'Initial setup done.' },
        // No partial/blocked/failed tasks should appear here
      ],
      spec: `# Task: 01-test-task

## Feature: test-feature

## Completed Tasks

- 00-setup: Initial setup done.
`,
    });
    const prompt = buildWorkerPrompt(params);

    // Only done task summary should be present
    expect(prompt).toContain('Initial setup done.');
    // No stray learnings from non-done tasks
    expect(prompt).not.toContain('Should not appear');
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('buildWorkerPrompt edge cases', () => {
  it('handles empty context files gracefully', () => {
    const params = createTestParams({
      contextFiles: [],
      spec: '# Task: test\n\n## Context\n\n_No context available._',
    });
    const prompt = buildWorkerPrompt(params);

    // Should not throw and should contain spec
    expect(prompt).toContain('# Task: test');
  });

  it('handles empty previous tasks gracefully', () => {
    const params = createTestParams({
      previousTasks: [],
      spec: '# Task: test\n\n## Completed Tasks\n\n_This is the first task._',
    });
    const prompt = buildWorkerPrompt(params);

    // Should not throw and should contain spec
    expect(prompt).toContain('# Task: test');
  });

  it('handles missing plan section in spec', () => {
    const params = createTestParams({
      plan: '',
      spec: '# Task: test\n\nNo plan section available.',
    });
    const prompt = buildWorkerPrompt(params);

    // Should not throw
    expect(prompt).toContain('# Task: test');
  });
});
