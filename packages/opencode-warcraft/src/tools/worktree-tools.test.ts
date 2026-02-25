import { describe, expect, it, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { WorktreeTools } from './worktree-tools';
import { formatSpecContent } from 'warcraft-core';

const TEST_DIR = '/tmp/opencode-warcraft-worktree-tools-test-' + process.pid;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

function setupFeature(featureName: string): void {
  const featurePath = path.join(TEST_DIR, '.beads/artifacts', featureName);
  fs.mkdirSync(featurePath, { recursive: true });

  fs.writeFileSync(
    path.join(featurePath, 'feature.json'),
    JSON.stringify({
      name: featureName,
      epicBeadId: 'bd-epic-test',
      status: 'executing',
      createdAt: new Date().toISOString(),
    })
  );

  fs.writeFileSync(
    path.join(featurePath, 'plan.md'),
    `# Plan

### 1. Test Task

Description of the test task.
`
  );
}

function setupTask(featureName: string, taskFolder: string, status: Record<string, unknown> = {}): void {
  const taskPath = path.join(TEST_DIR, '.beads/artifacts', featureName, 'tasks', taskFolder);
  fs.mkdirSync(taskPath, { recursive: true });

  const taskStatus = {
    status: 'pending',
    origin: 'plan',
    planTitle: 'Test Task',
    ...status,
  };

  fs.writeFileSync(path.join(taskPath, 'status.json'), JSON.stringify(taskStatus, null, 2));
}

describe('WorktreeTools', () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>;
  let childCounter = 0;

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    childCounter = 0;
    execFileSyncSpy = spyOn(child_process, 'execFileSync').mockImplementation((...execArgs: unknown[]) => {
      const [command, args] = execArgs;
      if (command !== 'br') {
        throw new Error(`Unexpected command: ${String(command)}`);
      }
      const argList = Array.isArray(args) ? args.map(String) : [];
      if (argList[0] === 'create') {
        childCounter += 1;
        return JSON.stringify({ id: `bd-task-${childCounter}` }) as unknown as Buffer;
      }
      if (argList[0] === 'update' || argList[0] === 'close') {
        return '' as unknown as Buffer;
      }
      if (argList[0] === 'show') {
        return JSON.stringify({ description: '' }) as unknown as Buffer;
      }
      return '' as unknown as Buffer;
    });
  });

  afterEach(() => {
    execFileSyncSpy.mockRestore();
    cleanup();
  });
});

describe('formatSpecContent', () => {
  it('formats SpecData into markdown with all sections', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-test-task', name: 'Test Task', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
      planSection: '### 1. Test Task\n\nDescription of the test task.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('# Task: 01-test-task');
    expect(result).toContain('## Feature: test-feature');
    expect(result).toContain('## Dependencies');
    expect(result).toContain('_None_');
    expect(result).toContain('## Plan Section');
    expect(result).toContain('Description of the test task');
  });

  it('formats dependencies with task names', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '02-dependent-task', name: 'Dependent Task', order: 2 },
      dependsOn: ['01-first-task'],
      allTasks: [
        { folder: '01-first-task', name: 'First Task', order: 1 },
        { folder: '02-dependent-task', name: 'Dependent Task', order: 2 },
      ],
      planSection: '### 2. Dependent Task\n\nDescription.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Dependencies');
    expect(result).toContain('- **1. First Task** (01-first-task)');
    expect(result).not.toContain('_None_');
  });

  it('formats context files section when present', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-test-task', name: 'Test Task', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
      planSection: '### 1. Test Task\n\nDescription.',
      contextFiles: [
        { name: 'notes.md', content: '# Notes\nImportant notes.' },
        { name: 'config.json', content: '{"key": "value"}' },
      ],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Context');
    expect(result).toContain('## notes.md');
    expect(result).toContain('# Notes');
    expect(result).toContain('## config.json');
    expect(result).toContain('{"key": "value"}');
    expect(result).toContain('---'); // Separator between context files
  });

  it('formats completed tasks section when present', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '03-current-task', name: 'Current Task', order: 3 },
      dependsOn: ['01-first-task', '02-second-task'],
      allTasks: [
        { folder: '01-first-task', name: 'First Task', order: 1 },
        { folder: '02-second-task', name: 'Second Task', order: 2 },
        { folder: '03-current-task', name: 'Current Task', order: 3 },
      ],
      planSection: '### 3. Current Task\n\nDescription.',
      contextFiles: [],
      completedTasks: [
        { name: '01-first-task', summary: 'First task completed' },
        { name: '02-second-task', summary: 'Second task done' },
      ],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Completed Tasks');
    expect(result).toContain('- 01-first-task: First task completed');
    expect(result).toContain('- 02-second-task: Second task done');
  });

  it('shows placeholder when plan section is null', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-test-task', name: 'Test Task', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
      planSection: null,
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Plan Section');
    expect(result).toContain('_No plan section available._');
  });

  it('infers greenfield task type from Create: files', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-new-feature', name: 'New Feature', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-new-feature', name: 'New Feature', order: 1 }],
      planSection: '### 1. New Feature\n\n- Create: `src/new.ts`\n\nAdd new feature.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Task Type');
    expect(result).toContain('greenfield');
  });

  it('infers testing task type from Test: files', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-add-tests', name: 'Add Tests', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-add-tests', name: 'Add Tests', order: 1 }],
      planSection: '### 1. Add Tests\n\n- Test: `src/feature.test.ts`\n\nAdd coverage.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Task Type');
    expect(result).toContain('testing');
  });

  it('infers modification task type from Modify: files', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-update-code', name: 'Update Code', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-update-code', name: 'Update Code', order: 1 }],
      planSection: '### 1. Update Code\n\n- Modify: `src/feature.ts`\n\nUpdate logic.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Task Type');
    expect(result).toContain('modification');
  });

  it('infers testing task type from task name when no file types', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-test-validation', name: 'Test Validation', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-test-validation', name: 'Test Validation', order: 1 }],
      planSection: '### 1. Test Validation\n\nValidate inputs.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Task Type');
    expect(result).toContain('testing');
  });

  it('omits task type section when no inference possible', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '01-generic-task', name: 'Generic Task', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-generic-task', name: 'Generic Task', order: 1 }],
      planSection: '### 1. Generic Task\n\nDo something.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).not.toContain('## Task Type');
  });

  it('preserves dependency resolution behavior for unknown dependencies', () => {
    const specData: SpecData = {
      featureName: 'test-feature',
      task: { folder: '02-task', name: 'Task', order: 2 },
      dependsOn: ['01-unknown-task'],
      allTasks: [
        { folder: '02-task', name: 'Task', order: 2 },
        // 01-unknown-task is not in allTasks
      ],
      planSection: '### 2. Task\n\nDescription.',
      contextFiles: [],
      completedTasks: [],
    };

    const result = formatSpecContent(specData);

    expect(result).toContain('## Dependencies');
    expect(result).toContain('- 01-unknown-task'); // Without name resolution
    expect(result).not.toContain('**'); // No bold formatting since task not found
  });
});
