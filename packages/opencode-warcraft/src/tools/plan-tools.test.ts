import { describe, expect, it } from 'bun:test';
import type { FeatureService, PlanService, TaskService } from 'warcraft-core';
import { PlanTools } from './plan-tools.js';

class MockPlanService implements Partial<PlanService> {
  written: Array<{ feature: string; content: string }> = [];

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
