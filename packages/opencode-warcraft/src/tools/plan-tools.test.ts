import { describe, expect, it } from 'bun:test';
import type { FeatureService, PlanService, TaskService } from 'warcraft-core';
import { PlanTools } from './plan-tools.js';

class MockPlanService implements Partial<PlanService> {
  written: Array<{ feature: string; content: string }> = [];

  read() {
    return null;
  }

  write(feature: string, content: string) {
    this.written.push({ feature, content });
    return `/tmp/${feature}/plan.md`;
  }

  getLastWrite() {
    return this.written[this.written.length - 1] ?? null;
  }
}

describe('PlanTools', () => {
  it('requires explicit content unless useScaffold is enabled', async () => {
    const planService = new MockPlanService();
    const tool = new PlanTools({
      featureService: { get: () => ({ name: 'test-feature', workflowRecommendation: 'lightweight' }) } as unknown as FeatureService,
      planService: planService as unknown as PlanService,
      taskService: { list: () => [] } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'warn',
    }).writePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature' } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Plan content is required unless useScaffold is true.');
    expect(planService.written).toHaveLength(0);
  });

  it('returns structured scaffold retry metadata when manual tasks already exist but content is omitted', async () => {
    const planService = new MockPlanService();
    const tool = new PlanTools({
      featureService: { get: () => ({ name: 'test-feature', workflowRecommendation: 'lightweight' }) } as unknown as FeatureService,
      planService: planService as unknown as PlanService,
      taskService: {
        list: () => [{ folder: '01-refresh-docs-wording', name: 'refresh-docs-wording', status: 'pending', origin: 'manual' }],
        getRawStatus: () => ({
          planTitle: 'Refresh docs wording',
          brief:
            'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
        }),
      } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'warn',
    }).writePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature' } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Plan content is required unless useScaffold is true.');
    expect(parsed.hints).toEqual([
      'Pending manual tasks already exist. Retry warcraft_plan_write with {"feature":"test-feature","useScaffold":true} to scaffold the reviewed draft from them.',
      'If you do not want scaffolded content, provide explicit plan markdown instead.',
    ]);
    expect(parsed.data).toEqual({
      blockedReason: 'plan_content_required_for_manual_tasks',
      pendingManualTasks: ['01-refresh-docs-wording'],
      retryArgs: { feature: 'test-feature', useScaffold: true },
    });
    expect(parsed.warnings).toEqual([
      {
        type: 'plan_content_required_for_manual_tasks',
        severity: 'info',
        message: 'Pending manual tasks can be promoted directly into a scaffolded reviewed plan.',
        count: 1,
      },
    ]);
    expect(planService.written).toHaveLength(0);
  });

  it('returns structured plan-read recovery metadata when manual tasks exist but no plan has been written yet', async () => {
    const planService = new MockPlanService();
    const tool = new PlanTools({
      featureService: { get: () => ({ name: 'test-feature', workflowRecommendation: 'lightweight' }) } as unknown as FeatureService,
      planService: planService as unknown as PlanService,
      taskService: {
        list: () => [{ folder: '01-refresh-docs-wording', name: 'refresh-docs-wording', status: 'pending', origin: 'manual' }],
      } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'warn',
    }).readPlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature' } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('No plan.md found');
    expect(parsed.hints).toEqual([
      'Create the draft plan with warcraft_plan_write using {"feature":"test-feature","useScaffold":true}.',
      'After the scaffold is written, read the draft again or continue with approval when ready.',
    ]);
    expect(parsed.data).toEqual({
      blockedReason: 'plan_missing_for_read',
      pendingManualTasks: ['01-refresh-docs-wording'],
      retryArgs: { feature: 'test-feature', useScaffold: true },
    });
    expect(parsed.warnings).toEqual([
      {
        type: 'plan_missing_for_read',
        severity: 'info',
        message: 'Pending manual tasks can be scaffolded into a reviewed draft plan before it can be read.',
        count: 1,
      },
    ]);
  });

  it('returns structured discovery recovery metadata when plan content fails validation', async () => {
    const planService = new MockPlanService();
    const tool = new PlanTools({
      featureService: { get: () => ({ name: 'test-feature', workflowRecommendation: 'lightweight' }) } as unknown as FeatureService,
      planService: planService as unknown as PlanService,
      taskService: { list: () => [] } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'warn',
    }).writePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature', content: '# test-feature' } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Discovery');
    expect(parsed.hints).toEqual([
      'Update the `## Discovery` section so impact, safety, verification, and rollback details are explicit.',
      'Revise the plan content and retry warcraft_plan_write.',
    ]);
    expect(parsed.data).toEqual({
      blockedReason: 'discovery_section_invalid',
      discoveryError: expect.any(String),
      generatedFromManualTasks: false,
      sourceTaskCount: 0,
      retryArgs: { feature: 'test-feature' },
    });
    expect(parsed.warnings).toEqual([
      {
        type: 'discovery_section_invalid',
        severity: 'error',
        message: 'The plan draft is missing required discovery details.',
      },
    ]);
    expect(planService.written).toHaveLength(0);
  });

  it('returns structured continuation metadata when useScaffold is requested but a draft already covers the manual work', async () => {
    const planService = new MockPlanService();
    const tool = new PlanTools({
      featureService: {
        get: () => ({ name: 'test-feature', workflowRecommendation: 'lightweight' }),
      } as unknown as FeatureService,
      planService: {
        ...planService,
        read: () => ({ content: '# test-feature\n\nWorkflow Path: lightweight\n\n## Tasks\n\n### 1. Existing Task', status: 'planning' }),
      } as unknown as PlanService,
      taskService: {
        list: () => [],
      } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'warn',
    }).writePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature', useScaffold: true } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('No pending manual tasks are available to build a plan scaffold.');
    expect(parsed.hints).toEqual([
      'The draft plan already covers the pending manual work that can be promoted right now.',
      'Review the draft and continue with warcraft_plan_approve when it is ready.',
    ]);
    expect(parsed.data).toEqual({
      blockedReason: 'no_pending_manual_tasks_for_scaffold',
      planApproveArgs: { feature: 'test-feature' },
      taskSyncArgs: { feature: 'test-feature', mode: 'sync' },
      promotionFlow: [
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
      ],
    });
    expect(parsed.warnings).toEqual([
      {
        type: 'no_pending_manual_tasks_for_scaffold',
        severity: 'info',
        message: 'There are no pending manual tasks left to materialize into a scaffolded draft plan.',
      },
    ]);
  });

  it('builds and writes a lightweight scaffold from pending manual tasks', async () => {
    const planService = new MockPlanService();
    const updateCalls: Array<Record<string, unknown>> = [];
    const tool = new PlanTools({
      featureService: {
        get: () => ({ name: 'test-feature', workflowRecommendation: 'lightweight' }),
      } as unknown as FeatureService,
      planService: planService as unknown as PlanService,
      taskService: {
        list: () => [{ folder: '01-refresh-docs-wording', name: 'refresh-docs-wording', status: 'pending', origin: 'manual' }],
        getRawStatus: () => ({
          planTitle: 'Refresh docs wording',
          brief:
            'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
        }),
      } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: (_feature, patch) => updateCalls.push(patch),
      workflowGatesMode: 'warn',
    }).writePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature', useScaffold: true } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(true);
    expect(parsed.data.generatedFromManualTasks).toBe(true);
    expect(parsed.data.planScaffoldMode).toBe('lightweight');
    expect(parsed.data.content).toContain('Workflow Path: lightweight');
    expect(parsed.data.content).toContain('## Non-Goals');
    expect(parsed.data.content).toContain('## Ghost Diffs');
    expect(parsed.data.content).toContain('### 1. Refresh docs wording');
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
    expect(planService.getLastWrite()).toEqual({ feature: 'test-feature', content: parsed.data.content });
    expect(updateCalls).toContainEqual({ workflowPath: 'lightweight' });
  });

  it('builds a standard scaffold when manual-task buildup exceeds the lightweight limit', async () => {
    const planService = new MockPlanService();
    const tool = new PlanTools({
      featureService: {
        get: () => ({ name: 'test-feature', workflowRecommendation: 'lightweight' }),
      } as unknown as FeatureService,
      planService: planService as unknown as PlanService,
      taskService: {
        list: () => [
          { folder: '01-first', name: 'first', status: 'pending', origin: 'manual' },
          { folder: '02-second', name: 'second', status: 'pending', origin: 'manual' },
          { folder: '03-third', name: 'third', status: 'pending', origin: 'manual' },
        ],
        getRawStatus: (_feature: string, folder: string) => ({
          planTitle:
            folder === '01-first' ? 'First tiny fix' : folder === '02-second' ? 'Second tiny fix' : 'Third tiny fix',
          brief: 'Background: tiny fix. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
        }),
      } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'warn',
    }).writePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature', useScaffold: true } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(true);
    expect(parsed.data.planScaffoldMode).toBe('standard');
    expect(parsed.data.planApproveArgs).toEqual({ feature: 'test-feature' });
    expect(parsed.data.taskSyncArgs).toEqual({ feature: 'test-feature', mode: 'sync' });
    expect(parsed.data.promotionFlow?.[2]).toEqual({
      type: 'tool',
      tool: 'warcraft_tasks_sync',
      args: { feature: 'test-feature', mode: 'sync' },
      purpose: 'Generate or reconcile canonical tasks from the approved plan.',
    });
    expect(parsed.data.content).not.toContain('Workflow Path: lightweight');
    expect(parsed.data.content).toContain('### 3. Third tiny fix');
  });

  it('surfaces remaining manual tasks when a written draft plan does not cover all pending manual work', async () => {
    const planService = new MockPlanService();
    const tool = new PlanTools({
      featureService: {
        get: () => ({ name: 'test-feature', workflowRecommendation: 'lightweight' }),
      } as unknown as FeatureService,
      planService: planService as unknown as PlanService,
      taskService: {
        list: () => [{ folder: '01-follow-up', name: 'follow-up', status: 'pending', origin: 'manual' }],
        previewSync: () => ({ created: [], removed: [], kept: [], reconciled: [], manual: ['01-follow-up'] }),
      } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'warn',
    }).writePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute(
      {
        feature: 'test-feature',
        content: '# test-feature\n\nWorkflow Path: lightweight\n\n## Discovery\n\nImpact: docs\nSafety: low\nVerify: tests\nRollback: revert\n\n## Non-Goals\n\n- Keep scope tight.\n\n## Ghost Diffs\n\n- Skip alternatives for now.\n\n## Tasks\n\n### 1. Existing Task\n\n**Depends on**: none\n\n**What to do**:\n- Keep existing behavior.\n\n**References**:\n- Existing context.\n\n**Verify**:\n- [ ] Run tests\n',
      } as any,
      {} as any,
    );
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(true);
    expect(parsed.data.remainingManualTasks).toEqual(['01-follow-up']);
    expect(parsed.data.planApproveArgs).toBeNull();
    expect(parsed.data.taskSyncArgs).toBeNull();
    expect(parsed.data.taskExpandArgs).toEqual({
      feature: 'test-feature',
      tasks: ['01-follow-up'],
      mode: 'lightweight',
    });
    expect(parsed.data.promotionFlow?.[0]).toEqual({
      type: 'tool',
      tool: 'warcraft_task_expand',
      args: { feature: 'test-feature', tasks: ['01-follow-up'], mode: 'lightweight' },
      purpose: 'Promote the pending manual tasks into a reviewed draft plan.',
    });
  });

  it('returns structured promotion recovery metadata when approval is attempted before any plan exists', async () => {
    const approveCalls: string[] = [];
    const tool = new PlanTools({
      featureService: {} as unknown as FeatureService,
      planService: {
        read: () => null,
        approve: (feature: string) => {
          approveCalls.push(feature);
          return { severity: 'ok', diagnostics: [] };
        },
      } as unknown as PlanService,
      taskService: {
        list: () => [{ folder: '01-tiny-fix', name: 'Tiny Fix', status: 'pending', origin: 'manual' }],
      } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'warn',
    }).approvePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature' } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('No plan.md found');
    expect(parsed.hints).toEqual([
      'Promote the pending manual tasks with warcraft_task_expand using {"feature":"test-feature","tasks":["01-tiny-fix"],"mode":"lightweight"}.',
      'After the draft is written and reviewed, retry warcraft_plan_approve.',
    ]);
    expect(parsed.data).toEqual({
      blockedReason: 'plan_missing_for_approval',
      pendingManualTasks: ['01-tiny-fix'],
      taskExpandArgs: { feature: 'test-feature', tasks: ['01-tiny-fix'], mode: 'lightweight' },
      retryArgs: { feature: 'test-feature' },
      promotionFlow: [
        {
          type: 'tool',
          tool: 'warcraft_task_expand',
          args: { feature: 'test-feature', tasks: ['01-tiny-fix'], mode: 'lightweight' },
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
      ],
    });
    expect(parsed.warnings).toEqual([
      {
        type: 'plan_missing_for_approval',
        severity: 'error',
        message: 'A reviewed plan is required before approval can succeed.',
        count: 1,
      },
    ]);
    expect(approveCalls).toEqual([]);
  });

  it('returns structured checklist recovery metadata when approval is blocked in enforce mode', async () => {
    const approveCalls: string[] = [];
    const tool = new PlanTools({
      featureService: {} as unknown as FeatureService,
      planService: {
        read: () => ({ content: '# test-feature\n\n## Plan Review Checklist\n- [ ] Discovery is complete and current', status: 'planning' }),
        approve: (feature: string) => {
          approveCalls.push(feature);
          return { severity: 'ok', diagnostics: [] };
        },
      } as unknown as PlanService,
      taskService: {
        previewSync: () => ({ created: [], removed: [], kept: [], reconciled: [], manual: [] }),
      } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'enforce',
    }).approvePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature' } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Plan review checklist is incomplete');
    expect(parsed.hints).toEqual([
      'Update the `## Plan Review Checklist` so every required item is explicitly checked.',
      'After revising the checklist, retry warcraft_plan_approve.',
    ]);
    expect(parsed.data).toEqual({
      blockedReason: 'plan_review_checklist_incomplete',
      reviewChecklistIssues: expect.any(Array),
      retryArgs: { feature: 'test-feature' },
      promotionFlow: [
        {
          type: 'review',
          message: 'Finish the required `## Plan Review Checklist` confirmations before attempting approval again.',
        },
        {
          type: 'tool',
          tool: 'warcraft_plan_approve',
          args: { feature: 'test-feature' },
          purpose: 'Retry approval once the reviewed checklist is complete.',
        },
      ],
    });
    expect(parsed.warnings).toEqual([
      {
        type: 'plan_review_checklist_incomplete',
        severity: 'error',
        message: 'The reviewed plan is missing required checklist confirmations.',
        count: expect.any(Number),
      },
    ]);
    expect(approveCalls).toEqual([]);
  });

  it('blocks approval when manual tasks still sit outside the reviewed draft plan', async () => {
    const approveCalls: string[] = [];
    const tool = new PlanTools({
      featureService: {} as unknown as FeatureService,
      planService: {
        read: () => ({ content: '# test-feature\n\nWorkflow Path: lightweight\n\n## Plan Review', status: 'planning' }),
        approve: (feature: string) => {
          approveCalls.push(feature);
          return { severity: 'ok', diagnostics: [] };
        },
      } as unknown as PlanService,
      taskService: {
        previewSync: () => ({ created: [], removed: [], kept: [], reconciled: [], manual: ['01-follow-up'] }),
      } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'warn',
    }).approvePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature' } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Cannot approve plan');
    expect(parsed.error).toContain('01-follow-up');
    expect(parsed.error).toContain('warcraft_task_expand');
    expect(parsed.hints).toEqual([
      'Run warcraft_task_expand with {"feature":"test-feature","tasks":["01-follow-up"],"mode":"lightweight"} to merge the remaining manual tasks into the draft plan.',
      'After expansion succeeds, review the updated draft and retry warcraft_plan_approve.',
    ]);
    expect(parsed.data).toEqual({
      blockedReason: 'manual_tasks_outside_plan',
      remainingManualTasks: ['01-follow-up'],
      taskExpandArgs: { feature: 'test-feature', tasks: ['01-follow-up'], mode: 'lightweight' },
      retryArgs: { feature: 'test-feature' },
      promotionFlow: [
        {
          type: 'tool',
          tool: 'warcraft_task_expand',
          args: { feature: 'test-feature', tasks: ['01-follow-up'], mode: 'lightweight' },
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
      ],
    });
    expect(parsed.warnings).toEqual([
      {
        type: 'manual_tasks_outside_plan',
        severity: 'error',
        message: 'Pending manual tasks still sit outside the reviewed draft plan.',
        affected: '01-follow-up',
        count: 1,
      },
    ]);
    expect(approveCalls).toEqual([]);
  });

  it('returns sync follow-up args after plan approval', async () => {
    const approveCalls: string[] = [];
    const tool = new PlanTools({
      featureService: {} as unknown as FeatureService,
      planService: {
        read: () => ({ content: '# Plan\n\n## Plan Review', status: 'planning' }),
        approve: (feature: string) => {
          approveCalls.push(feature);
          return { severity: 'ok', diagnostics: [] };
        },
      } as unknown as PlanService,
      taskService: {
        previewSync: () => ({ created: [], removed: [], kept: [], reconciled: [], manual: [] }),
      } as unknown as TaskService,
      captureSession: () => {},
      updateFeatureMetadata: () => {},
      workflowGatesMode: 'warn',
    }).approvePlanTool((name) => name ?? 'test-feature');

    const raw = await tool.execute({ feature: 'test-feature' } as any, {} as any);
    const parsed = JSON.parse(raw);

    expect(parsed.success).toBe(true);
    expect(approveCalls).toEqual(['test-feature']);
    expect(parsed.data.taskSyncArgs).toEqual({ feature: 'test-feature', mode: 'sync' });
    expect(parsed.data.promotionFlow).toEqual([
      {
        type: 'tool',
        tool: 'warcraft_tasks_sync',
        args: { feature: 'test-feature', mode: 'sync' },
        purpose: 'Generate or reconcile canonical tasks from the approved plan.',
      },
    ]);
  });
});
