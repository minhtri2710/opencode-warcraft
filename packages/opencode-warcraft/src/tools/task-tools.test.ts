import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as child_process from 'child_process';
import * as fs from 'fs';
import type { FeatureService, PlanService, TaskService, TaskStatusType } from 'warcraft-core';
import { createNoopEventLogger, InvalidTransitionError } from 'warcraft-core';
import { TaskTools } from './task-tools.js';

const TEST_DIR = `/tmp/opencode-warcraft-task-tools-test-${process.pid}`;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

class MockTaskService implements Partial<TaskService> {
  private createCalls: Array<{
    feature: string;
    name: string;
    order?: number;
    priority?: number;
    description?: string;
  }> = [];
  previewResult = {
    created: [] as string[],
    removed: [] as string[],
    kept: [] as string[],
    reconciled: [] as Array<Record<string, unknown>>,
    manual: [] as string[],
  };
  syncResult = {
    created: [] as string[],
    removed: [] as string[],
    kept: [] as string[],
    reconciled: [] as Array<Record<string, unknown>>,
    manual: [] as string[],
    diagnostics: [] as Array<Record<string, unknown>>,
  };

  create(featureName: string, name: string, order?: number, priority?: number, description?: string): string {
    this.createCalls.push({ feature: featureName, name, order, priority, description });
    const orderStr = order !== undefined ? String(order).padStart(2, '0') : '01';
    return `${orderStr}-${name.toLowerCase().replace(/\s+/g, '-')}`;
  }

  list(featureName: string) {
    return this.createCalls
      .filter((call) => call.feature === featureName)
      .map((call, index) => ({
        folder: `${String(call.order ?? index + 1).padStart(2, '0')}-${call.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: call.name,
        status: 'pending' as const,
        origin: 'manual' as const,
      }));
  }

  getRawStatus(featureName: string, taskFolder: string) {
    const calls = this.createCalls.filter((call) => call.feature === featureName);
    const matched = calls.find((call, index) => {
      const folder = `${String(call.order ?? index + 1).padStart(2, '0')}-${call.name.toLowerCase().replace(/\s+/g, '-')}`;
      return folder === taskFolder;
    });
    return matched
      ? {
          origin: 'manual' as const,
          planTitle: matched.name,
          brief: matched.description,
        }
      : null;
  }

  previewSync(): unknown {
    return this.previewResult;
  }

  sync(): unknown {
    return this.syncResult;
  }

  getLastPriority(): number | undefined {
    const lastCall = this.createCalls[this.createCalls.length - 1];
    return lastCall?.priority;
  }

  getLastDescription(): string | undefined {
    const lastCall = this.createCalls[this.createCalls.length - 1];
    return lastCall?.description;
  }

  getCreateCallCount(): number {
    return this.createCalls.length;
  }
}

class MockFeatureService implements Partial<FeatureService> {
  feature: {
    name: string;
    epicBeadId: string;
    status: 'planning' | 'approved' | 'executing' | 'completed';
    workflowPath?: 'standard' | 'lightweight' | 'instant';
    workflowRecommendation?: 'standard' | 'lightweight' | 'instant';
    createdAt: string;
  } = {
    name: 'test-feature',
    epicBeadId: 'bd-epic-test',
    status: 'executing',
    createdAt: new Date().toISOString(),
  };
  patchCalls: Array<Record<string, unknown>> = [];
  updateStatusCalls: string[] = [];

  get(name: string) {
    return {
      ...this.feature,
      name,
    };
  }

  patchMetadata(name: string, patch: Record<string, unknown>) {
    this.patchCalls.push(patch);
    this.feature = {
      ...this.feature,
      name,
      ...(patch as Partial<typeof this.feature>),
    };
    return this.feature as unknown as ReturnType<FeatureService['patchMetadata']>;
  }

  updateStatus(name: string, status: 'planning' | 'approved' | 'executing' | 'completed') {
    this.updateStatusCalls.push(status);
    this.feature = {
      ...this.feature,
      name,
      status,
    };
    return this.feature as unknown as ReturnType<FeatureService['updateStatus']>;
  }
}

class MockPlanService implements Partial<PlanService> {
  planResult:
    | {
        content: string;
        status: 'approved' | 'planning';
      }
    | null = {
    content: '# Plan\n\n### 1. Test Task\n\nDescription.',
    status: 'approved',
  };
  writes: Array<{ feature: string; content: string }> = [];

  read() {
    return this.planResult;
  }

  write(feature: string, content: string) {
    this.writes.push({ feature, content });
    this.planResult = { content, status: 'planning' };
    return `/tmp/${feature}/plan.md`;
  }
}

const validateTaskStatus = (status: string): TaskStatusType => {
  const valid: TaskStatusType[] = ['pending', 'in_progress', 'done', 'blocked', 'failed', 'cancelled', 'partial'];
  if (valid.includes(status as TaskStatusType)) {
    return status as TaskStatusType;
  }
  throw new Error(`Invalid status: ${status}`);
};

describe('TaskTools', () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>;
  let mockTaskService: MockTaskService;
  let mockFeatureService: MockFeatureService;
  let mockPlanService: MockPlanService;
  let taskTools: TaskTools;

  const resolveFeature = (name?: string): string | null => {
    return name || 'test-feature';
  };

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    mockTaskService = new MockTaskService();
    mockFeatureService = new MockFeatureService();
    mockPlanService = new MockPlanService();
    taskTools = new TaskTools({
      featureService: mockFeatureService as unknown as FeatureService,
      planService: mockPlanService as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });
    execFileSyncSpy = spyOn(child_process, 'execFileSync').mockReturnValue('' as unknown as Buffer);
  });

  afterEach(() => {
    execFileSyncSpy.mockRestore();
    cleanup();
  });

  describe('createTaskTool', () => {
    it('accepts priority parameter and passes it to service', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 5,
      });

      expect(mockTaskService.getLastPriority()).toBe(5);
      expect(result).toContain('Manual task created');
    });

    it('defaults to priority 3 when not specified', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: undefined,
      });

      expect(mockTaskService.getLastPriority()).toBe(3);
      expect(result).toContain('Manual task created');
    });

    it('validates priority is within range 1-5', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);

      // Test priority 0 (invalid)
      const result0 = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 0,
      });
      const parsed0 = JSON.parse(result0);
      expect(parsed0.success).toBe(false);
      expect(parsed0.error).toContain('Priority must be an integer between 1 and 5');
      expect(result0).toContain('Priority must be an integer between 1 and 5');

      // Test priority 6 (invalid)
      const result6 = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 6,
      });
      const parsed6 = JSON.parse(result6);
      expect(parsed6.success).toBe(false);
      expect(parsed6.error).toContain('Priority must be an integer between 1 and 5');
      expect(result6).toContain('Priority must be an integer between 1 and 5');

      // Test non-integer priority (invalid)
      const resultDecimal = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 2.5,
      });
      const parsedDecimal = JSON.parse(resultDecimal);
      expect(parsedDecimal.success).toBe(false);
      expect(parsedDecimal.error).toContain('Priority must be an integer between 1 and 5');
      expect(resultDecimal).toContain('Priority must be an integer between 1 and 5');
    });

    it('accepts valid priorities 1-5', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);

      for (let p = 1; p <= 5; p++) {
        const result = await tool.execute({
          name: `Test Task ${p}`,
          order: undefined,
          feature: undefined,
          priority: p,
        });
        expect(result).not.toContain('Error');
        expect(result).toContain('Manual task created');
      }
    });

    it('includes priority value in error message', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 0,
      });
      expect(result).toContain('0');
    });

    it('passes order parameter to service', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Test Task',
        order: 5,
        feature: undefined,
        priority: 3,
      });

      expect(result).toContain('05-test-task');
    });

    it('success message refers to assigned workspace, not worktree unconditionally', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 3,
      });

      // Should not promise a worktree — direct mode is also supported
      expect(result).not.toContain('to use its worktree');
      // Should mention the returned task() call
      expect(result).toContain('task()');
    });

    it('passes optional description through to the task service', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Test Task',
        description: 'Background: small fix. Verify: run tests.',
        order: undefined,
        feature: undefined,
        priority: 3,
      });

      expect(mockTaskService.getLastDescription()).toBe('Background: small fix. Verify: run tests.');
      expect(result).toContain('Manual task created');
    });

    it('activates the instant workflow when the feature has no plan yet', async () => {
      mockFeatureService.feature = {
        ...mockFeatureService.feature,
        status: 'planning',
      };
      mockPlanService.planResult = null;

      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Tiny Fix',
        description: 'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: undefined,
        feature: undefined,
        priority: 3,
      });
      const parsed = JSON.parse(result);

      expect(parsed.success).toBe(true);
      expect(parsed.data.workflowPath).toBe('instant');
      expect(parsed.data.message).toContain('Instant workflow activated');
      expect(mockFeatureService.updateStatusCalls).toContain('executing');
      expect(mockFeatureService.patchCalls).toContainEqual({ workflowPath: 'instant' });
    });

    it('records a lightweight recommendation when a direct task description no longer looks tiny', async () => {
      mockFeatureService.feature = {
        ...mockFeatureService.feature,
        status: 'planning',
      };
      mockPlanService.planResult = null;

      const tool = taskTools.createTaskTool(resolveFeature);
      const raw = await tool.execute({
        name: 'Refresh docs wording',
        description:
          'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
        order: undefined,
        feature: undefined,
        priority: 3,
      });
      const parsed = JSON.parse(raw);

      expect(parsed.success).toBe(true);
      expect(parsed.data.workflowRecommendation).toBe('lightweight');
      expect(parsed.data.planScaffold).toContain('Workflow Path: lightweight');
      expect(parsed.data.planScaffold).toContain('## Non-Goals');
      expect(parsed.data.planScaffold).toContain('## Ghost Diffs');
      expect(parsed.data.planScaffold).toContain('### 1. Refresh docs wording');
      expect(parsed.data.planWriteArgs).toEqual({ feature: 'test-feature', content: parsed.data.planScaffold });
      expect(parsed.data.taskExpandArgs).toEqual({
        feature: 'test-feature',
        tasks: ['01-refresh-docs-wording'],
        mode: 'lightweight',
      });
      expect(parsed.data.promotionFlow).toEqual([
        {
          type: 'tool',
          tool: 'warcraft_task_expand',
          args: { feature: 'test-feature', tasks: ['01-refresh-docs-wording'], mode: 'lightweight' },
          purpose: 'Promote the pending manual tasks into a reviewed draft plan.',
        },
        {
          type: 'review',
          message: 'Review or refine the drafted plan before approval so the reviewed path stays intentional.',
        },
        {
          type: 'tool',
          tool: 'warcraft_plan_approve',
          args: { feature: 'test-feature' },
          purpose: 'Approve the reviewed plan once it is ready to execute.',
        },
        {
          type: 'tool',
          tool: 'warcraft_tasks_sync',
          args: { feature: 'test-feature', mode: 'sync' },
          purpose: 'Generate or reconcile canonical tasks from the approved plan.',
        },
      ]);
      expect(parsed.data.message).toContain('Workflow Path: lightweight');
      expect(parsed.data.message).toContain('warcraft_task_expand');
      expect(parsed.data.message).toContain('warcraft_plan_write({ useScaffold: true })');
      expect(mockFeatureService.patchCalls).toContainEqual({ workflowPath: 'instant', workflowRecommendation: 'lightweight' });
    });

    it('warns when instant work grows into multiple pending manual tasks', async () => {
      mockFeatureService.feature = {
        ...mockFeatureService.feature,
        status: 'planning',
      };
      mockPlanService.planResult = null;

      const tool = taskTools.createTaskTool(resolveFeature);
      await tool.execute({
        name: 'Tiny Fix',
        description: 'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 1,
        feature: undefined,
        priority: 3,
      });
      const raw = await tool.execute({
        name: 'Second Tiny Fix',
        description: 'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 2,
        feature: undefined,
        priority: 3,
      });
      const parsed = JSON.parse(raw);

      expect(parsed.success).toBe(true);
      expect(parsed.data.pendingManualTasks).toEqual(['01-tiny-fix', '02-second-tiny-fix']);
      expect(parsed.data.workflowRecommendation).toBe('lightweight');
      expect(parsed.data.planScaffold).toContain('Workflow Path: lightweight');
      expect(parsed.data.planScaffold).toContain('## Non-Goals');
      expect(parsed.data.planScaffold).toContain('## Ghost Diffs');
      expect(parsed.data.planScaffold).toContain('### 1. Tiny Fix');
      expect(parsed.data.planScaffold).toContain('### 2. Second Tiny Fix');
      expect(parsed.data.planWriteArgs).toEqual({ feature: 'test-feature', content: parsed.data.planScaffold });
      expect(parsed.data.taskExpandArgs).toEqual({
        feature: 'test-feature',
        tasks: ['01-tiny-fix', '02-second-tiny-fix'],
        mode: 'lightweight',
      });
      expect(parsed.data.message).toContain('multiple pending manual tasks');
      expect(parsed.data.message).toContain('warcraft_task_expand');
      expect(parsed.data.message).toContain('warcraft_plan_write({ useScaffold: true })');
      expect(parsed.data.message).toContain('Workflow Path: lightweight');
    });

    it('escalates to the standard path when more than two manual instant tasks pile up', async () => {
      mockFeatureService.feature = {
        ...mockFeatureService.feature,
        status: 'planning',
      };
      mockPlanService.planResult = null;

      const tool = taskTools.createTaskTool(resolveFeature);
      await tool.execute({
        name: 'Tiny Fix',
        description: 'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 1,
        feature: undefined,
        priority: 3,
      });
      await tool.execute({
        name: 'Second Tiny Fix',
        description: 'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 2,
        feature: undefined,
        priority: 3,
      });
      const raw = await tool.execute({
        name: 'Third Tiny Fix',
        description: 'Background: third tiny change. Impact: another small prompt tweak. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 3,
        feature: undefined,
        priority: 3,
      });
      const parsed = JSON.parse(raw);

      expect(parsed.success).toBe(true);
      expect(parsed.data.pendingManualTasks).toEqual(['01-tiny-fix', '02-second-tiny-fix', '03-third-tiny-fix']);
      expect(parsed.data.workflowRecommendation).toBe('standard');
      expect(parsed.data.planScaffold).toContain('# test-feature');
      expect(parsed.data.planScaffold).toContain('## Non-Goals');
      expect(parsed.data.planScaffold).toContain('## Ghost Diffs');
      expect(parsed.data.planScaffold).not.toContain('Workflow Path: lightweight');
      expect(parsed.data.planScaffold).toContain('### 3. Third Tiny Fix');
      expect(parsed.data.planWriteArgs).toEqual({ feature: 'test-feature', content: parsed.data.planScaffold });
      expect(parsed.data.taskExpandArgs).toEqual({
        feature: 'test-feature',
        tasks: ['01-tiny-fix', '02-second-tiny-fix', '03-third-tiny-fix'],
        mode: 'standard',
      });
      expect(parsed.data.message).toContain('more than two pending manual tasks');
      expect(parsed.data.message).toContain('warcraft_task_expand');
      expect(parsed.data.message).toContain('warcraft_plan_write({ useScaffold: true })');
      expect(parsed.data.message).toContain('standard reviewed plan path');
    });
  });

  describe('expandTaskTool', () => {
    it('writes a scaffolded plan and previews promotion for pending manual tasks', async () => {
      mockFeatureService.feature = {
        ...mockFeatureService.feature,
        status: 'executing',
        workflowRecommendation: 'lightweight',
      };
      mockPlanService.planResult = null;
      mockTaskService.previewResult = {
        created: [],
        removed: [],
        kept: [],
        reconciled: [{ from: '01-tiny-fix', to: '01-tiny-fix', planTitle: 'Tiny Fix', beadId: 'task-1' }],
        manual: [],
      };

      const createTool = taskTools.createTaskTool(resolveFeature);
      await createTool.execute({
        name: 'Tiny Fix',
        description: 'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 1,
        feature: undefined,
        priority: 3,
      });

      const expandTool = taskTools.expandTaskTool(resolveFeature);
      const raw = await expandTool.execute({ feature: undefined });
      const parsed = JSON.parse(raw);

      expect(parsed.success).toBe(true);
      expect(parsed.data.planScaffoldMode).toBe('lightweight');
      expect(parsed.data.planScaffold).toContain('Workflow Path: lightweight');
      expect(parsed.data.planPath).toBe('/tmp/test-feature/plan.md');
      expect(parsed.data.planApproveArgs).toEqual({ feature: 'test-feature' });
      expect(parsed.data.taskSyncArgs).toEqual({ feature: 'test-feature', mode: 'sync' });
      expect(parsed.data.promotionFlow).toEqual([
        {
          type: 'review',
          message: 'Review or refine the drafted plan before approval so the reviewed path stays intentional.',
        },
        {
          type: 'tool',
          tool: 'warcraft_plan_approve',
          args: { feature: 'test-feature' },
          purpose: 'Approve the reviewed plan once it is ready to execute.',
        },
        {
          type: 'tool',
          tool: 'warcraft_tasks_sync',
          args: { feature: 'test-feature', mode: 'sync' },
          purpose: 'Generate or reconcile canonical tasks from the approved plan.',
        },
      ]);
      expect(parsed.data.syncPreview.wouldReconcile).toEqual([
        { from: '01-tiny-fix', to: '01-tiny-fix', planTitle: 'Tiny Fix', beadId: 'task-1' },
      ]);
      expect(mockPlanService.writes).toEqual([{ feature: 'test-feature', content: parsed.data.planScaffold }]);
      expect(mockFeatureService.patchCalls).toContainEqual({ workflowPath: 'lightweight' });
    });

    it('can target a selected subset of pending manual tasks', async () => {
      mockFeatureService.feature = {
        ...mockFeatureService.feature,
        status: 'executing',
        workflowRecommendation: 'lightweight',
      };
      mockPlanService.planResult = null;

      const createTool = taskTools.createTaskTool(resolveFeature);
      await createTool.execute({
        name: 'Tiny Fix',
        description: 'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 1,
        feature: undefined,
        priority: 3,
      });
      await createTool.execute({
        name: 'Second Tiny Fix',
        description: 'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 2,
        feature: undefined,
        priority: 3,
      });

      const expandTool = taskTools.expandTaskTool(resolveFeature);
      const raw = await expandTool.execute({ feature: undefined, tasks: ['02-second-tiny-fix'] });
      const parsed = JSON.parse(raw);

      expect(parsed.success).toBe(true);
      expect(parsed.data.tasks).toEqual(['02-second-tiny-fix']);
      expect(parsed.data.planScaffold).toContain('### 1. Second Tiny Fix');
      expect(parsed.data.planScaffold).not.toContain('### 1. Tiny Fix');
    });

    it('returns structured recovery metadata when a requested lightweight expansion violates guardrails', async () => {
      mockFeatureService.feature = {
        ...mockFeatureService.feature,
        status: 'executing',
      };
      mockPlanService.planResult = null;

      const createTool = taskTools.createTaskTool(resolveFeature);
      await createTool.execute({
        name: 'Tiny Fix',
        description: 'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 1,
        feature: undefined,
        priority: 3,
      });
      await createTool.execute({
        name: 'Second Tiny Fix',
        description: 'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 2,
        feature: undefined,
        priority: 3,
      });
      await createTool.execute({
        name: 'Third Tiny Fix',
        description: 'Background: third tiny change. Impact: status text only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 3,
        feature: undefined,
        priority: 3,
      });

      const expandTool = taskTools.expandTaskTool(resolveFeature);
      const raw = await expandTool.execute({ feature: undefined, mode: 'lightweight' });
      const parsed = JSON.parse(raw);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Cannot expand to a lightweight plan');
      expect(parsed.hints).toEqual([
        'Retry warcraft_task_expand with {"feature":"test-feature","tasks":["01-tiny-fix","02-second-tiny-fix","03-third-tiny-fix"],"mode":"standard"} to promote this work through the standard reviewed path.',
      ]);
      expect(parsed.data).toEqual({
        blockedReason: 'lightweight_plan_invalid',
        validationIssues: expect.any(Array),
        retryTaskExpandArgs: {
          feature: 'test-feature',
          tasks: ['01-tiny-fix', '02-second-tiny-fix', '03-third-tiny-fix'],
          mode: 'standard',
        },
      });
      expect(parsed.warnings).toEqual([
        {
          type: 'lightweight_plan_invalid',
          severity: 'error',
          message: 'The requested lightweight expansion violates lightweight workflow guardrails.',
          count: expect.any(Number),
        },
      ]);
    });

    it('returns structured recovery metadata when an existing draft plan is missing a tasks section', async () => {
      mockFeatureService.feature = {
        ...mockFeatureService.feature,
        status: 'planning',
      };
      mockPlanService.planResult = {
        content: '# test-feature\n\nWorkflow Path: lightweight\n\n## Discovery\n\nImpact: existing plan\nSafety: low\nVerify: tests\nRollback: revert',
        status: 'planning',
      };

      const createTool = taskTools.createTaskTool(resolveFeature);
      await createTool.execute({
        name: 'Second Tiny Fix',
        description: 'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 2,
        feature: undefined,
        priority: 3,
      });

      const expandTool = taskTools.expandTaskTool(resolveFeature);
      const raw = await expandTool.execute({ feature: undefined, tasks: ['02-second-tiny-fix'] });
      const parsed = JSON.parse(raw);

      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('## Tasks section');
      expect(parsed.hints).toEqual([
        'Repair the draft with warcraft_plan_write using {"feature":"test-feature","content":"# test-feature\n\nWorkflow Path: lightweight\n\n## Discovery\n\nImpact: existing plan\nSafety: low\nVerify: tests\nRollback: revert\n\n## Tasks\n"} so the plan contains a `## Tasks` section.'.replace(/\n/g, '\\n'),
        'Then retry warcraft_task_expand with {"feature":"test-feature","tasks":["02-second-tiny-fix"],"mode":"lightweight"}.',
      ]);
      expect(parsed.data).toEqual({
        blockedReason: 'draft_plan_tasks_section_missing',
        requiredSection: '## Tasks',
        repairPlanWriteArgs: {
          feature: 'test-feature',
          content:
            '# test-feature\n\nWorkflow Path: lightweight\n\n## Discovery\n\nImpact: existing plan\nSafety: low\nVerify: tests\nRollback: revert\n\n## Tasks\n',
        },
        retryTaskExpandArgs: {
          feature: 'test-feature',
          tasks: ['02-second-tiny-fix'],
          mode: 'lightweight',
        },
      });
      expect(parsed.warnings).toEqual([
        {
          type: 'draft_plan_tasks_section_missing',
          severity: 'error',
          message: 'The existing draft plan is missing a `## Tasks` section, so pending manual tasks cannot be merged into it.',
          count: 1,
        },
      ]);
    });

    it('can merge selected manual tasks into an existing draft plan', async () => {
      mockFeatureService.feature = {
        ...mockFeatureService.feature,
        status: 'planning',
      };
      mockPlanService.planResult = {
        content: [
          '# test-feature',
          '',
          'Workflow Path: lightweight',
          '',
          '## Discovery',
          '',
          'Impact: existing plan',
          'Safety: low',
          'Verify: tests',
          'Rollback: revert',
          '',
          '## Non-Goals',
          '',
          '- Keep scope tight.',
          '',
          '## Ghost Diffs',
          '',
          '- Skip alternatives for now.',
          '',
          '## Tasks',
          '',
          '### 1. Existing Task',
          '',
          '**Depends on**: none',
          '',
          '**What to do**:',
          '- Keep existing behavior.',
          '',
          '**References**:',
          '- Existing context.',
          '',
          '**Verify**:',
          '- [ ] Run tests',
          '',
        ].join('\n'),
        status: 'planning',
      };
      mockTaskService.previewResult = {
        created: [],
        removed: [],
        kept: ['01-existing-task'],
        reconciled: [{ from: '02-second-tiny-fix', to: '02-second-tiny-fix', planTitle: 'Second Tiny Fix', beadId: 'task-2' }],
        manual: ['01-tiny-fix'],
      };

      const createTool = taskTools.createTaskTool(resolveFeature);
      await createTool.execute({
        name: 'Tiny Fix',
        description: 'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 1,
        feature: undefined,
        priority: 3,
      });
      await createTool.execute({
        name: 'Second Tiny Fix',
        description: 'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
        order: 2,
        feature: undefined,
        priority: 3,
      });

      const expandTool = taskTools.expandTaskTool(resolveFeature);
      const raw = await expandTool.execute({ feature: undefined, tasks: ['02-second-tiny-fix'] });
      const parsed = JSON.parse(raw);

      expect(parsed.success).toBe(true);
      expect(parsed.data.mergedIntoExistingPlan).toBe(true);
      expect(parsed.data.remainingManualTasks).toEqual(['01-tiny-fix']);
      expect(parsed.data.taskExpandArgs).toEqual({
        feature: 'test-feature',
        tasks: ['01-tiny-fix'],
        mode: 'lightweight',
      });
      expect(parsed.data.planApproveArgs).toBeNull();
      expect(parsed.data.taskSyncArgs).toBeNull();
      expect(parsed.data.promotionFlow?.[0]).toEqual({
        type: 'tool',
        tool: 'warcraft_task_expand',
        args: { feature: 'test-feature', tasks: ['01-tiny-fix'], mode: 'lightweight' },
        purpose: 'Promote the pending manual tasks into a reviewed draft plan.',
      });
      expect(parsed.data.planScaffold).toContain('### 1. Existing Task');
      expect(parsed.data.planScaffold).toContain('### 2. Second Tiny Fix');
      expect(parsed.data.syncPreview.wouldReconcile).toEqual([
        { from: '02-second-tiny-fix', to: '02-second-tiny-fix', planTitle: 'Second Tiny Fix', beadId: 'task-2' },
      ]);
      expect(mockPlanService.writes.at(-1)).toEqual({ feature: 'test-feature', content: parsed.data.planScaffold });
    });
  });

  describe('syncTasksTool', () => {
    it('preview surfaces reconciliations', async () => {
      mockTaskService.previewResult = {
        created: [],
        removed: [],
        kept: ['03-keep-existing'],
        reconciled: [{ from: '02-old-task', to: '01-test-task', planTitle: 'Test Task', beadId: 'task-1' }],
        manual: ['99-manual-task'],
      };

      const tool = taskTools.syncTasksTool(resolveFeature);
      const result = await tool.execute({ feature: undefined, mode: 'preview' });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.data.wouldReconcile).toEqual([
        { from: '02-old-task', to: '01-test-task', planTitle: 'Test Task', beadId: 'task-1' },
      ]);
      expect(parsed.data.message).toContain('reconcile 1');
    });

    it('sync surfaces reconciled tasks and diagnostics', async () => {
      mockTaskService.syncResult = {
        created: ['01-test-task'],
        removed: [],
        kept: [],
        reconciled: [{ from: '02-old-task', to: '01-test-task', planTitle: 'Test Task', beadId: 'task-1' }],
        manual: [],
        diagnostics: [{ code: 'dep_sync_failed', message: 'Dependency sync failed', severity: 'degraded' }],
      };

      const tool = taskTools.syncTasksTool(resolveFeature);
      const result = await tool.execute({ feature: undefined, mode: 'sync' });
      const parsed = JSON.parse(result as string);

      expect(parsed.success).toBe(true);
      expect(parsed.data.reconciled).toEqual([
        { from: '02-old-task', to: '01-test-task', planTitle: 'Test Task', beadId: 'task-1' },
      ]);
      expect(parsed.data.diagnostics).toEqual([
        { code: 'dep_sync_failed', message: 'Dependency sync failed', severity: 'degraded' },
      ]);
      expect(parsed.data.message).toContain('1 reconciled');
    });
  });
});

// ============================================================================
// updateTaskTool transition tests
// ============================================================================

/**
 * Extended mock TaskService for updateTaskTool tests that supports get(), update(), and transition().
 */
class MockUpdateTaskService {
  private _status: TaskStatusType;
  public transitionCalls: Array<{
    feature: string;
    task: string;
    toStatus: TaskStatusType;
    extras?: Record<string, unknown>;
  }> = [];
  public updateCalls: Array<{ feature: string; task: string; patch: Record<string, unknown> }> = [];
  public shouldThrowOnTransition: Error | null = null;

  constructor(initialStatus: TaskStatusType = 'pending') {
    this._status = initialStatus;
  }

  get(_feature: string, task: string) {
    return {
      folder: task,
      name: 'Test Task',
      status: this._status,
      origin: 'plan' as const,
    };
  }

  transition(feature: string, task: string, toStatus: TaskStatusType, extras?: Record<string, unknown>) {
    if (this.shouldThrowOnTransition) {
      throw this.shouldThrowOnTransition;
    }
    this.transitionCalls.push({ feature, task, toStatus, extras });
    this._status = toStatus;
    return { folder: task, name: 'Test Task', status: toStatus, origin: 'plan' as const };
  }

  update(feature: string, task: string, patch: Record<string, unknown>) {
    this.updateCalls.push({ feature, task, patch });
    return { folder: task, name: 'Test Task', status: this._status, origin: 'plan' as const };
  }
}

describe('updateTaskTool transitions', () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>;
  const resolveFeature = (name?: string): string | null => name || 'test-feature';
  const validateTaskStatus = (status: string): TaskStatusType => {
    const valid: TaskStatusType[] = ['pending', 'in_progress', 'done', 'blocked', 'failed', 'cancelled', 'partial'];
    if (valid.includes(status as TaskStatusType)) return status as TaskStatusType;
    throw new Error(`Invalid status: ${status}`);
  };

  beforeEach(() => {
    execFileSyncSpy = spyOn(child_process, 'execFileSync').mockReturnValue('' as unknown as Buffer);
  });

  afterEach(() => {
    execFileSyncSpy.mockRestore();
  });

  it('rejects done → in_progress with explicit error', async () => {
    const mockTaskService = new MockUpdateTaskService('done');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    const result = await tool.execute(
      { task: '01-task', status: 'in_progress', summary: undefined, feature: undefined },
      {} as never,
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Cannot reopen completed task');
    expect(parsed.error).toContain('done → in_progress is not allowed');
    // Should NOT have called transition
    expect(mockTaskService.transitionCalls).toHaveLength(0);
  });

  it('reopen-rejection message mentions the returned task() call', async () => {
    const mockTaskService = new MockUpdateTaskService('done');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    const result = await tool.execute(
      { task: '01-task', status: 'in_progress', summary: undefined, feature: undefined },
      {} as never,
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('task()');
  });

  it('catches InvalidTransitionError and returns tool error', async () => {
    const mockTaskService = new MockUpdateTaskService('done');
    mockTaskService.shouldThrowOnTransition = new InvalidTransitionError('done', 'pending');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    // done → cancelled IS allowed in the state machine, but let's simulate the service throwing
    // by forcing the mock to throw on any transition
    const result = await tool.execute(
      { task: '01-task', status: 'cancelled', summary: undefined, feature: undefined },
      {} as never,
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Cannot update task');
    expect(parsed.error).toContain('Invalid task status transition');
  });

  it('uses transition() for status changes', async () => {
    const mockTaskService = new MockUpdateTaskService('pending');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    const result = await tool.execute(
      { task: '01-task', status: 'in_progress', summary: 'Starting work', feature: undefined },
      {} as never,
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(true);
    // Should have called transition, not update
    expect(mockTaskService.transitionCalls).toHaveLength(1);
    expect(mockTaskService.transitionCalls[0].toStatus).toBe('in_progress');
    expect(mockTaskService.transitionCalls[0].extras).toEqual({ summary: 'Starting work' });
    expect(mockTaskService.updateCalls).toHaveLength(0);
  });

  it('uses update() for summary-only changes (no status)', async () => {
    const mockTaskService = new MockUpdateTaskService('in_progress');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    const result = await tool.execute(
      { task: '01-task', status: undefined, summary: 'Updated summary', feature: undefined },
      {} as never,
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(true);
    // Should have called update, not transition
    expect(mockTaskService.updateCalls).toHaveLength(1);
    expect(mockTaskService.updateCalls[0].patch).toEqual({ summary: 'Updated summary' });
    expect(mockTaskService.transitionCalls).toHaveLength(0);
  });

  it('rethrows non-InvalidTransitionError exceptions', async () => {
    const mockTaskService = new MockUpdateTaskService('pending');
    mockTaskService.shouldThrowOnTransition = new Error('Unexpected DB error');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    expect(
      tool.execute({ task: '01-task', status: 'in_progress', summary: undefined, feature: undefined }, {} as never),
    ).rejects.toThrow('Unexpected DB error');
  });
});
