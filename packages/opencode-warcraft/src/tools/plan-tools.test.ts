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
      taskService: {} as unknown as TaskService,
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
