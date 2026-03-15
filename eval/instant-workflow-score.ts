#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createNoopEventLogger,
  FeatureService,
  FilesystemFeatureStore,
  FilesystemPlanStore,
  FilesystemTaskStore,
  formatSpecContent,
  PlanService,
  TaskService,
} from '../packages/warcraft-core/src/index.ts';
import {
  decodeTaskState,
  encodeTaskState,
} from '../packages/warcraft-core/src/services/beads/artifactSchemas.ts';
import { BeadsTaskStore } from '../packages/warcraft-core/src/services/state/beads-task-store.ts';
import { buildKhadgarPrompt } from '../packages/opencode-warcraft/src/agents/khadgar.js';
import { MIMIRON_PROMPT } from '../packages/opencode-warcraft/src/agents/mimiron.js';
import { buildSaurfangPrompt } from '../packages/opencode-warcraft/src/agents/saurfang.js';
import { ContextTools } from '../packages/opencode-warcraft/src/tools/context-tools.js';
import { FeatureTools } from '../packages/opencode-warcraft/src/tools/feature-tools.js';
import { PlanTools } from '../packages/opencode-warcraft/src/tools/plan-tools.js';
import { TaskTools } from '../packages/opencode-warcraft/src/tools/task-tools.js';

type CheckResult = { id: string; pass: boolean; detail: string };

const VALID_STATUSES = new Set(['pending', 'in_progress', 'done', 'blocked', 'failed', 'cancelled', 'partial']);
const validateTaskStatus = (status: string) => {
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  return status as
    | 'pending'
    | 'in_progress'
    | 'done'
    | 'blocked'
    | 'failed'
    | 'cancelled'
    | 'partial';
};

function parseToolResponse(raw: string): { success: boolean; data?: any; error?: string } {
  return JSON.parse(raw) as { success: boolean; data?: any; error?: string };
}

function matchesPendingManualPromotionFlow(flow: unknown, feature: string, tasks: string[], mode: 'lightweight' | 'standard'): boolean {
  return (
    Array.isArray(flow) &&
    flow.length === 4 &&
    flow[0]?.type === 'tool' &&
    flow[0]?.tool === 'warcraft_task_expand' &&
    flow[0]?.args?.feature === feature &&
    flow[0]?.args?.mode === mode &&
    JSON.stringify(flow[0]?.args?.tasks) === JSON.stringify(tasks) &&
    flow[1]?.type === 'review' &&
    /review or refine/i.test(String(flow[1]?.message || '')) &&
    flow[2]?.type === 'tool' &&
    flow[2]?.tool === 'warcraft_plan_approve' &&
    flow[2]?.args?.feature === feature &&
    flow[3]?.type === 'tool' &&
    flow[3]?.tool === 'warcraft_tasks_sync' &&
    flow[3]?.args?.feature === feature &&
    flow[3]?.args?.mode === 'sync'
  );
}

function matchesDraftPlanPromotionFlow(flow: unknown, feature: string): boolean {
  return (
    Array.isArray(flow) &&
    flow.length === 3 &&
    flow[0]?.type === 'review' &&
    /review or refine/i.test(String(flow[0]?.message || '')) &&
    flow[1]?.type === 'tool' &&
    flow[1]?.tool === 'warcraft_plan_approve' &&
    flow[1]?.args?.feature === feature &&
    flow[2]?.type === 'tool' &&
    flow[2]?.tool === 'warcraft_tasks_sync' &&
    flow[2]?.args?.feature === feature &&
    flow[2]?.args?.mode === 'sync'
  );
}

function matchesApprovedPlanSyncFlow(flow: unknown, feature: string): boolean {
  return (
    Array.isArray(flow) &&
    flow.length === 1 &&
    flow[0]?.type === 'tool' &&
    flow[0]?.tool === 'warcraft_tasks_sync' &&
    flow[0]?.args?.feature === feature &&
    flow[0]?.args?.mode === 'sync'
  );
}

function matchesApprovedSyncFlow(flow: unknown, feature: string): boolean {
  return (
    Array.isArray(flow) &&
    flow.length === 1 &&
    flow[0]?.type === 'tool' &&
    flow[0]?.tool === 'warcraft_tasks_sync' &&
    flow[0]?.args?.feature === feature &&
    flow[0]?.args?.mode === 'sync'
  );
}

function matchesChecklistRecoveryFlow(flow: unknown, feature: string): boolean {
  return (
    Array.isArray(flow) &&
    flow.length === 2 &&
    flow[0]?.type === 'review' &&
    /Plan Review Checklist/.test(String(flow[0]?.message || '')) &&
    flow[1]?.type === 'tool' &&
    flow[1]?.tool === 'warcraft_plan_approve' &&
    flow[1]?.args?.feature === feature
  );
}

function createWorkspace() {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'instant-workflow-score-'));
  const featureStore = new FilesystemFeatureStore(projectRoot);
  const planStore = new FilesystemPlanStore(projectRoot);
  const taskStore = new FilesystemTaskStore(projectRoot);
  const featureService = new FeatureService(projectRoot, featureStore, 'off', taskStore);
  const planService = new PlanService(projectRoot, planStore, 'off');
  const taskService = new TaskService(projectRoot, taskStore, 'off');

  const featureTools = new FeatureTools({ featureService });
  const planTools = new PlanTools({
    featureService,
    planService,
    taskService,
    captureSession: () => {},
    updateFeatureMetadata: (feature, patch) => {
      featureService.patchMetadata(feature, patch as any);
    },
    workflowGatesMode: 'warn',
  });
  const taskTools = new TaskTools({
    featureService,
    planService,
    taskService,
    workflowGatesMode: 'warn',
    validateTaskStatus,
    eventLogger: createNoopEventLogger(),
  });

  const contextTools = new ContextTools({
    featureService,
    planService,
    taskService,
    contextService: {
      list: () => [],
      write: () => '',
      getPath: () => '',
    } as any,
    agentsMdService: {} as any,
    worktreeService: {
      listAll: async () => [],
      get: async () => null,
      hasUncommittedChanges: async () => false,
    } as any,
    checkBlocked: () => ({ blocked: false }),
    bvTriageService: {
      getBlockerTriageDetails: () => null,
      getGlobalTriageDetails: () => null,
      getHealth: () => ({ enabled: false, available: false }),
    } as any,
    projectRoot,
  });

  return { projectRoot, featureService, planService, taskService, featureTools, planTools, taskTools, contextTools };
}

async function checkFeatureCreateMentionsInstantPath(): Promise<CheckResult> {
  const { featureTools } = createWorkspace();
  const raw = (await featureTools.createFeatureTool().execute({ name: 'quick-fix' })) as string;
  const parsed = parseToolResponse(raw);
  const message = String(parsed.data?.message || '');
  const pass = /skip.*plan|direct task|warcraft_task_create/i.test(message);
  return {
    id: 'feature-create-guidance',
    pass,
    detail: pass ? 'feature creation message mentions direct/instant path' : 'feature creation message is still plan-only',
  };
}

async function checkFeatureCreateAnalyzesTinyRequest(): Promise<CheckResult> {
  const { featureTools } = createWorkspace();
  const raw = (await featureTools.createFeatureTool().execute({
    name: 'quick-fix',
    request: 'Fix the wording in the feature-create prompt message.',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const pass = parsed.data?.recommendedWorkflowPath === 'instant';
  return {
    id: 'feature-create-analyzes-tiny-request',
    pass,
    detail: pass
      ? 'feature creation recommends the instant path for tiny wording fixes'
      : `recommendedWorkflowPath=${String(parsed.data?.recommendedWorkflowPath || 'missing')}`,
  };
}

async function checkFeatureCreateAnalyzesBroadRequest(): Promise<CheckResult> {
  const { featureTools } = createWorkspace();
  const raw = (await featureTools.createFeatureTool().execute({
    name: 'big-change',
    request: 'Design a new workflow across packages, add a new tool, update beads integration, and refactor orchestration prompts.',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const pass = parsed.data?.recommendedWorkflowPath === 'standard';
  return {
    id: 'feature-create-analyzes-broad-request',
    pass,
    detail: pass
      ? 'feature creation recommends the standard path for cross-cutting work'
      : `recommendedWorkflowPath=${String(parsed.data?.recommendedWorkflowPath || 'missing')}`,
  };
}

async function checkManualTaskCanPromoteInstantWorkflow(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const raw = (await ctx.taskTools.createTaskTool((name?: string) => name || 'quick-fix').execute({
    feature: 'quick-fix',
    name: 'Tighten prompt wording',
    priority: 3,
    description:
      'Background: this is a tiny wording fix. Impact: prompt text only. Safety: no runtime logic. Verify: prompt tests pass. Rollback: revert commit.',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const feature = ctx.featureService.get('quick-fix');
  const pass =
    parsed.success === true &&
    feature?.status === 'executing' &&
    (feature as { workflowPath?: string } | null)?.workflowPath === 'instant';
  return {
    id: 'manual-task-promotes-instant-workflow',
    pass,
    detail: pass
      ? 'manual task creation automatically moved the feature into instant execution mode'
      : `feature status=${feature?.status ?? 'missing'}, workflowPath=${(feature as { workflowPath?: string } | null)?.workflowPath ?? 'missing'}`,
  };
}

async function checkManualTaskWarnsWhenInstantWorkflowOutgrowsTinyPath(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'quick-fix');
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Tighten prompt wording',
    priority: 3,
    description:
      'Background: tiny wording fix. Impact: prompt text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  const raw = (await createTask.execute({
    feature: 'quick-fix',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: second tiny wording fix. Impact: help text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const message = String(parsed.data?.message || '');
  const pass = /multiple pending manual tasks/i.test(message) && /Workflow Path: lightweight/i.test(message);
  return {
    id: 'manual-task-expansion-warning',
    pass,
    detail: pass ? 'manual task creation warns when instant workflow has outgrown the tiny-task path' : `message=${message}`,
  };
}

async function checkManualTaskCreatesLightweightRecommendationForNonTinyBrief(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const raw = (await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const pass =
    parsed.data?.workflowRecommendation === 'lightweight' && /Workflow Path: lightweight/i.test(String(parsed.data?.message || ''));
  return {
    id: 'manual-task-lightweight-recommendation',
    pass,
    detail: pass
      ? 'manual task creation steers non-tiny direct work back to a lightweight plan'
      : `workflowRecommendation=${String(parsed.data?.workflowRecommendation || 'missing')}, message=${String(parsed.data?.message || '')}`,
  };
}

async function checkManualTaskReturnsPlanScaffoldWhenItNeedsReview(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const raw = (await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const scaffold = String(parsed.data?.planScaffold || '');
  const pass =
    /Workflow Path: lightweight/i.test(scaffold) &&
    /## Non-Goals/.test(scaffold) &&
    /## Ghost Diffs/.test(scaffold) &&
    /### 1\. Refresh docs wording/.test(scaffold);
  return {
    id: 'manual-task-plan-scaffold',
    pass,
    detail: pass ? 'manual task creation returns a reviewed-plan scaffold when direct work needs review' : `planScaffold=${scaffold}`,
  };
}

async function checkManualTaskReturnsPlanWriteArgsWhenItNeedsReview(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const raw = (await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const pass =
    parsed.data?.planWriteArgs?.feature === 'doc-tune' && parsed.data?.planWriteArgs?.content === parsed.data?.planScaffold;
  return {
    id: 'manual-task-plan-write-args',
    pass,
    detail: pass
      ? 'manual task creation returns ready-to-use warcraft_plan_write args alongside the scaffold'
      : `planWriteArgs=${JSON.stringify(parsed.data?.planWriteArgs ?? null)}`,
  };
}

async function checkManualTaskReturnsTaskExpandArgsWhenItNeedsReview(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const raw = (await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const pass =
    parsed.data?.taskExpandArgs?.feature === 'doc-tune' &&
    Array.isArray(parsed.data?.taskExpandArgs?.tasks) &&
    parsed.data.taskExpandArgs.tasks.length === 1 &&
    parsed.data.taskExpandArgs.mode === 'lightweight';
  return {
    id: 'manual-task-task-expand-args',
    pass,
    detail: pass
      ? 'manual task creation returns ready-to-use warcraft_task_expand args alongside the scaffold'
      : `taskExpandArgs=${JSON.stringify(parsed.data?.taskExpandArgs ?? null)}`,
  };
}

async function checkManualTaskReturnsPromotionFlowWhenItNeedsReview(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const raw = (await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const pass = matchesPendingManualPromotionFlow(
    parsed.data?.promotionFlow,
    'doc-tune',
    ['01-refresh-docs-wording'],
    'lightweight',
  );
  return {
    id: 'manual-task-promotion-flow',
    pass,
    detail: pass
      ? 'manual task creation returns an ordered promotion flow for reviewed fallback'
      : `promotionFlow=${JSON.stringify(parsed.data?.promotionFlow ?? null)}`,
  };
}

async function checkManualTaskSpecIsSelfContained(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const folder = (
    ctx.taskService.create as unknown as (
      feature: string,
      name: string,
      order?: number,
      priority?: number,
      description?: string,
    ) => string
  ).call(
    ctx.taskService,
    'quick-fix',
    'Tighten prompt wording',
    1,
    3,
    'Background: tiny wording fix. Reasoning: preserve behavior while improving clarity. Verify: prompt tests. Rollback: revert.',
  );
  const spec = formatSpecContent(
    ctx.taskService.buildSpecData({
      featureName: 'quick-fix',
      task: { folder, name: 'Tighten prompt wording', order: 1 },
      dependsOn: [],
      allTasks: [{ folder, name: 'Tighten prompt wording', order: 1 }],
      planContent: null,
      contextFiles: [],
      completedTasks: [],
    }),
  );
  const pass = !spec.includes('_No plan section available._') && /Background:|Impact:|Verify:|Rollback:/i.test(spec);
  return {
    id: 'manual-task-spec-self-contained',
    pass,
    detail: pass ? 'manual task spec captures direct-workflow context' : 'manual task spec still falls back to “No plan section available.”',
  };
}

async function checkStatusNextActionSupportsInstantPath(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  (
    ctx.taskService.create as unknown as (
      feature: string,
      name: string,
      order?: number,
      priority?: number,
      description?: string,
    ) => string
  ).call(
    ctx.taskService,
    'quick-fix',
    'Tighten prompt wording',
    1,
    3,
    'Impact: prompt text only. Safety: low risk. Verify: prompt tests. Rollback: revert commit.',
  );
  ctx.featureService.updateStatus('quick-fix', 'executing');
  ctx.featureService.patchMetadata('quick-fix', { workflowPath: 'instant' as any });
  const raw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'quick-fix').execute({
    feature: 'quick-fix',
  })) as string;
  const parsed = parseToolResponse(raw);
  const nextAction = String(parsed.data?.nextAction || '');
  const pass = /warcraft_worktree_create|warcraft_task_create|instant/i.test(nextAction);
  return {
    id: 'status-next-action-instant',
    pass,
    detail: pass ? `nextAction=${nextAction}` : `nextAction remains plan-first: ${nextAction}`,
  };
}

async function checkStatusNextActionSupportsLightweightRecommendation(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  ctx.featureService.patchMetadata('doc-tune', { workflowRecommendation: 'lightweight' as any });
  const raw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  })) as string;
  const parsed = parseToolResponse(raw);
  const nextAction = String(parsed.data?.nextAction || '');
  const pass = /lightweight/i.test(nextAction) && /warcraft_plan_write/i.test(nextAction);
  return {
    id: 'status-next-action-lightweight-recommendation',
    pass,
    detail: pass ? `nextAction=${nextAction}` : `nextAction missing lightweight guidance: ${nextAction}`,
  };
}

async function checkStatusReturnsPlanApproveArgsForDraftPlan(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute(
    {
      feature: 'doc-tune',
      content: [
        '# doc-tune',
        '',
        'Workflow Path: lightweight',
        '',
        '## Discovery',
        '',
        'Impact: docs text only',
        'Safety: low',
        'Verify: docs tests',
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
        '### 1. Refresh docs wording',
        '',
        '**Depends on**: none',
        '',
        '**What to do**:',
        '- Update docs wording.',
        '',
        '**References**:',
        '- Existing context.',
        '',
        '**Verify**:',
        '- [ ] docs tests',
        '',
      ].join('\n'),
    } as any,
    {} as any,
  );
  const raw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  })) as string;
  const parsed = parseToolResponse(raw);
  const pass = parsed.data?.planApproveArgs?.feature === 'doc-tune';
  return {
    id: 'status-plan-approve-args',
    pass,
    detail: pass ? 'status returns ready-to-use warcraft_plan_approve args for draft plans' : `planApproveArgs=${JSON.stringify(parsed.data?.planApproveArgs ?? null)}`,
  };
}

async function checkStatusReturnsDraftPlanPromotionFlow(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute(
    {
      feature: 'doc-tune',
      content: [
        '# doc-tune',
        '',
        'Workflow Path: lightweight',
        '',
        '## Discovery',
        '',
        'Impact: docs text only',
        'Safety: low',
        'Verify: docs tests',
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
        '### 1. Refresh docs wording',
        '',
        '**Depends on**: none',
        '',
        '**What to do**:',
        '- Update docs wording.',
        '',
        '**References**:',
        '- Existing context.',
        '',
        '**Verify**:',
        '- [ ] docs tests',
        '',
      ].join('\n'),
    } as any,
    {} as any,
  );
  const raw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  })) as string;
  const parsed = parseToolResponse(raw);
  const pass = matchesDraftPlanPromotionFlow(parsed.data?.promotionFlow, 'doc-tune');
  return {
    id: 'status-draft-plan-promotion-flow',
    pass,
    detail: pass
      ? 'status returns the remaining review/approve/sync flow for draft plans'
      : `promotionFlow=${JSON.stringify(parsed.data?.promotionFlow ?? null)}`,
  };
}

async function checkInstantWorkflowExpansionGuidance(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'quick-fix');
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Tighten prompt wording',
    priority: 3,
    description:
      'Background: tiny wording fix. Impact: prompt text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: second tiny wording fix. Impact: prompt/help text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);

  const raw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'quick-fix').execute({
    feature: 'quick-fix',
  })) as string;
  const parsed = parseToolResponse(raw);
  const nextAction = String(parsed.data?.nextAction || '');
  const pass = /outgrown/i.test(nextAction) && /lightweight/i.test(nextAction) && /warcraft_task_expand/i.test(nextAction);
  return {
    id: 'instant-workflow-expansion-guidance',
    pass,
    detail: pass ? `nextAction=${nextAction}` : `nextAction did not steer expansion: ${nextAction}`,
  };
}

async function checkInstantWorkflowEscalatesPastLightweightTaskLimit(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'quick-fix');
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Tighten prompt wording',
    priority: 3,
    description:
      'Background: tiny wording fix. Impact: prompt text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: second tiny wording fix. Impact: prompt/help text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  const thirdRaw = (await createTask.execute({
    feature: 'quick-fix',
    name: 'Polish status wording',
    priority: 3,
    description:
      'Background: third tiny wording fix. Impact: another prompt/status text tweak. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any)) as string;
  const thirdParsed = parseToolResponse(thirdRaw);
  const taskMessage = String(thirdParsed.data?.message || '');

  const statusRaw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'quick-fix').execute({
    feature: 'quick-fix',
  })) as string;
  const statusParsed = parseToolResponse(statusRaw);
  const nextAction = String(statusParsed.data?.nextAction || '');
  const pass =
    /more than two pending manual tasks/i.test(taskMessage) &&
    /standard reviewed plan path/i.test(taskMessage) &&
    /warcraft_task_expand/i.test(taskMessage) &&
    /more than two pending tasks/i.test(nextAction) &&
    /warcraft_task_expand/i.test(nextAction) &&
    !/Workflow Path: lightweight/i.test(nextAction);
  return {
    id: 'instant-workflow-standard-escalation',
    pass,
    detail: pass ? `taskMessage=${taskMessage} | nextAction=${nextAction}` : `taskMessage=${taskMessage} | nextAction=${nextAction}`,
  };
}

async function checkStatusReturnsPlanScaffoldForEscalatedInstantWork(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'quick-fix');
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Tighten prompt wording',
    priority: 3,
    description:
      'Background: tiny wording fix. Impact: prompt text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: second tiny wording fix. Impact: prompt/help text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Polish status wording',
    priority: 3,
    description:
      'Background: third tiny wording fix. Impact: another prompt/status text tweak. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);

  const statusRaw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'quick-fix').execute({
    feature: 'quick-fix',
  })) as string;
  const statusParsed = parseToolResponse(statusRaw);
  const scaffold = String(statusParsed.data?.planScaffold || '');
  const pass =
    /# quick-fix/.test(scaffold) &&
    /## Non-Goals/.test(scaffold) &&
    /## Ghost Diffs/.test(scaffold) &&
    /### 3\. Polish status wording/.test(scaffold) &&
    !/Workflow Path: lightweight/i.test(scaffold);
  return {
    id: 'status-plan-scaffold',
    pass,
    detail: pass ? 'status returns a reviewed-plan scaffold for escalated instant work' : `planScaffold=${scaffold}`,
  };
}

async function checkStatusReturnsPlanWriteArgsForEscalatedInstantWork(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'quick-fix');
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Tighten prompt wording',
    priority: 3,
    description:
      'Background: tiny wording fix. Impact: prompt text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: second tiny wording fix. Impact: prompt/help text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Polish status wording',
    priority: 3,
    description:
      'Background: third tiny wording fix. Impact: another prompt/status text tweak. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);

  const statusRaw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'quick-fix').execute({
    feature: 'quick-fix',
  })) as string;
  const statusParsed = parseToolResponse(statusRaw);
  const pass =
    statusParsed.data?.planWriteArgs?.feature === 'quick-fix' &&
    statusParsed.data?.planWriteArgs?.content === statusParsed.data?.planScaffold;
  return {
    id: 'status-plan-write-args',
    pass,
    detail: pass
      ? 'status returns ready-to-use warcraft_plan_write args alongside the scaffold'
      : `planWriteArgs=${JSON.stringify(statusParsed.data?.planWriteArgs ?? null)}`,
  };
}

async function checkStatusReturnsTaskExpandArgsForEscalatedInstantWork(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'quick-fix');
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Tighten prompt wording',
    priority: 3,
    description:
      'Background: tiny wording fix. Impact: prompt text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: second tiny wording fix. Impact: prompt/help text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Polish status wording',
    priority: 3,
    description:
      'Background: third tiny wording fix. Impact: another prompt/status text tweak. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);

  const statusRaw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'quick-fix').execute({
    feature: 'quick-fix',
  })) as string;
  const statusParsed = parseToolResponse(statusRaw);
  const pass =
    statusParsed.data?.taskExpandArgs?.feature === 'quick-fix' &&
    Array.isArray(statusParsed.data?.taskExpandArgs?.tasks) &&
    statusParsed.data.taskExpandArgs.tasks.length === 3 &&
    statusParsed.data.taskExpandArgs.mode === 'standard';
  return {
    id: 'status-task-expand-args',
    pass,
    detail: pass
      ? 'status returns ready-to-use warcraft_task_expand args alongside the scaffold'
      : `taskExpandArgs=${JSON.stringify(statusParsed.data?.taskExpandArgs ?? null)}`,
  };
}

async function checkStatusReturnsPromotionFlowForEscalatedInstantWork(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'quick-fix');
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Tighten prompt wording',
    priority: 3,
    description:
      'Background: tiny wording fix. Impact: prompt text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: second tiny wording fix. Impact: prompt/help text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Polish status wording',
    priority: 3,
    description:
      'Background: third tiny wording fix. Impact: another prompt/status text tweak. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);

  const raw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'quick-fix').execute({
    feature: 'quick-fix',
  })) as string;
  const parsed = parseToolResponse(raw);
  const pass = matchesPendingManualPromotionFlow(
    parsed.data?.promotionFlow,
    'quick-fix',
    ['01-tighten-prompt-wording', '02-refresh-help-text', '03-polish-status-wording'],
    'standard',
  );
  return {
    id: 'status-promotion-flow',
    pass,
    detail: pass
      ? 'status returns an ordered promotion flow for outgrown instant work'
      : `promotionFlow=${JSON.stringify(parsed.data?.promotionFlow ?? null)}`,
  };
}

async function checkStatusDraftPlanSurfacesRemainingManualPromotion(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  ctx.planService.write(
    'doc-tune',
    [
      '# doc-tune',
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
  );
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune');
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Tiny Fix',
    priority: 3,
    description:
      'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Second Tiny Fix',
    priority: 3,
    description:
      'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);
  await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    tasks: ['02-second-tiny-fix'],
  } as any);

  const raw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  })) as string;
  const parsed = parseToolResponse(raw);
  const pass =
    parsed.data?.planApproveArgs == null &&
    parsed.data?.taskExpandArgs?.feature === 'doc-tune' &&
    JSON.stringify(parsed.data?.taskExpandArgs?.tasks) === JSON.stringify(['01-tiny-fix']) &&
    parsed.data?.taskExpandArgs?.mode === 'lightweight' &&
    matchesPendingManualPromotionFlow(parsed.data?.promotionFlow, 'doc-tune', ['01-tiny-fix'], 'lightweight') &&
    /outside the reviewed plan/i.test(String(parsed.data?.nextAction || ''));
  return {
    id: 'status-draft-plan-remaining-manual-promotion',
    pass,
    detail: pass
      ? 'status keeps steering draft plans toward expanding remaining manual tasks before approval'
      : `status=${JSON.stringify(parsed.data ?? null)}`,
  };
}

async function checkStatusReturnsTaskSyncArgsAfterApproval(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute(
    {
      feature: 'doc-tune',
      content: [
        '# doc-tune',
        '',
        'Workflow Path: lightweight',
        '',
        '## Discovery',
        '',
        'Impact: docs text only',
        'Safety: low',
        'Verify: docs tests',
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
        '### 1. Refresh docs wording',
        '',
        '**Depends on**: none',
        '',
        '**What to do**:',
        '- Update docs wording.',
        '',
        '**References**:',
        '- Existing context.',
        '',
        '**Verify**:',
        '- [ ] docs tests',
        '',
      ].join('\n'),
    } as any,
    {} as any,
  );
  await ctx.planTools.approvePlanTool((name?: string) => name || 'doc-tune').execute({ feature: 'doc-tune' } as any, {} as any);
  const raw = (await ctx.contextTools.getStatusTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  })) as string;
  const parsed = parseToolResponse(raw);
  const pass = parsed.data?.taskSyncArgs?.feature === 'doc-tune' && parsed.data?.taskSyncArgs?.mode === 'sync';
  return {
    id: 'status-task-sync-args',
    pass,
    detail: pass ? 'status returns ready-to-use warcraft_tasks_sync args after plan approval' : `taskSyncArgs=${JSON.stringify(parsed.data?.taskSyncArgs ?? null)}`,
  };
}

async function checkSyncTasksReturnsStructuredMissingPlanRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Tiny Fix',
    priority: 3,
    description:
      'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);
  const raw = (await ctx.taskTools.syncTasksTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    mode: 'sync',
  } as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'plan_missing_for_sync' &&
    JSON.stringify(parsed.data?.pendingManualTasks) === JSON.stringify(['01-tiny-fix']) &&
    parsed.data?.taskExpandArgs?.feature === 'doc-tune' &&
    JSON.stringify(parsed.data?.taskExpandArgs?.tasks) === JSON.stringify(['01-tiny-fix']) &&
    parsed.data?.taskExpandArgs?.mode === 'lightweight' &&
    parsed.data?.planApproveArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.mode === 'sync' &&
    matchesPendingManualPromotionFlow(parsed.data?.promotionFlow, 'doc-tune', ['01-tiny-fix'], 'lightweight') &&
    Array.isArray(parsed.hints) &&
    /warcraft_task_expand/.test(String(parsed.hints?.[0] || '')) &&
    /warcraft_plan_approve/.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'plan_missing_for_sync';
  return {
    id: 'task-sync-missing-plan-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_tasks_sync returns structured promotion recovery metadata when pending manual work exists but no plan has been written yet'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkSyncTasksReturnsStructuredApprovalRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute(
    {
      feature: 'doc-tune',
      content: [
        '# doc-tune',
        '',
        'Workflow Path: lightweight',
        '',
        '## Discovery',
        '',
        'Impact: docs text only',
        'Safety: low',
        'Verify: docs tests',
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
        '### 1. Refresh docs wording',
        '',
        '**Depends on**: none',
        '',
        '**What to do**:',
        '- Update docs wording.',
        '',
        '**References**:',
        '- Existing context.',
        '',
        '**Verify**:',
        '- [ ] docs tests',
        '',
      ].join('\n'),
    } as any,
    {} as any,
  );
  const raw = (await ctx.taskTools.syncTasksTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    mode: 'sync',
  } as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'plan_not_approved' &&
    parsed.data?.planStatus === 'planning' &&
    parsed.data?.planApproveArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.mode === 'sync' &&
    matchesDraftPlanPromotionFlow(parsed.data?.promotionFlow, 'doc-tune') &&
    Array.isArray(parsed.hints) &&
    /required checklist/i.test(String(parsed.hints?.[0] || '')) &&
    /warcraft_plan_approve/.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'plan_not_approved';
  return {
    id: 'task-sync-approval-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_tasks_sync returns structured approval recovery metadata when the plan is still draft'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkSyncTasksReturnsStructuredLightweightRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  const enforceTaskTools = new TaskTools({
    featureService: ctx.featureService,
    planService: ctx.planService,
    taskService: ctx.taskService,
    workflowGatesMode: 'enforce',
    validateTaskStatus,
    eventLogger: createNoopEventLogger(),
  });
  ctx.featureService.create('doc-tune');
  const lightweightPlan = '# doc-tune\n\nWorkflow Path: lightweight\n\n### 1. Existing Task';
  ctx.planService.write('doc-tune', lightweightPlan);
  const approvedPlan = ctx.planService.approve('doc-tune', undefined, lightweightPlan);
  if (approvedPlan.severity === 'fatal') {
    return {
      id: 'task-sync-lightweight-structured-recovery',
      pass: false,
      detail: `approval failed unexpectedly: ${JSON.stringify(approvedPlan)}`,
    };
  }
  const raw = (await enforceTaskTools.syncTasksTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    mode: 'sync',
  } as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'lightweight_plan_invalid_for_sync' &&
    Array.isArray(parsed.data?.validationIssues) &&
    parsed.data.validationIssues.length > 0 &&
    parsed.data?.planWriteArgs?.feature === 'doc-tune' &&
    parsed.data?.planWriteArgs?.content === lightweightPlan &&
    parsed.data?.planApproveArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.mode === 'sync' &&
    matchesDraftPlanPromotionFlow(parsed.data?.promotionFlow, 'doc-tune') &&
    Array.isArray(parsed.hints) &&
    /warcraft_plan_write/.test(String(parsed.hints?.[0] || '')) &&
    /warcraft_tasks_sync/.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'lightweight_plan_invalid_for_sync';
  return {
    id: 'task-sync-lightweight-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_tasks_sync returns structured lightweight-plan recovery metadata when enforce-mode guardrails block sync'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkPlanApproveReturnsStructuredMissingPlanRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Tiny Fix',
    priority: 3,
    description:
      'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);
  const raw = (await ctx.planTools.approvePlanTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  } as any, {} as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'plan_missing_for_approval' &&
    JSON.stringify(parsed.data?.pendingManualTasks) === JSON.stringify(['01-tiny-fix']) &&
    parsed.data?.taskExpandArgs?.feature === 'doc-tune' &&
    JSON.stringify(parsed.data?.taskExpandArgs?.tasks) === JSON.stringify(['01-tiny-fix']) &&
    parsed.data?.taskExpandArgs?.mode === 'lightweight' &&
    parsed.data?.retryArgs?.feature === 'doc-tune' &&
    matchesPendingManualPromotionFlow(parsed.data?.promotionFlow, 'doc-tune', ['01-tiny-fix'], 'lightweight') &&
    Array.isArray(parsed.hints) &&
    /warcraft_task_expand/.test(String(parsed.hints?.[0] || '')) &&
    /warcraft_plan_approve/.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'plan_missing_for_approval';
  return {
    id: 'plan-approve-missing-plan-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_plan_approve returns structured promotion recovery metadata when pending manual work exists but no plan has been written yet'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkPlanApproveReturnsSyncFlow(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute(
    {
      feature: 'doc-tune',
      content: [
        '# doc-tune',
        '',
        'Workflow Path: lightweight',
        '',
        '## Discovery',
        '',
        'Impact: docs text only',
        'Safety: low',
        'Verify: docs tests',
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
        '### 1. Refresh docs wording',
        '',
        '**Depends on**: none',
        '',
        '**What to do**:',
        '- Update docs wording.',
        '',
        '**References**:',
        '- Existing context.',
        '',
        '**Verify**:',
        '- [ ] docs tests',
        '',
      ].join('\n'),
    } as any,
    {} as any,
  );
  const raw = (await ctx.planTools.approvePlanTool((name?: string) => name || 'doc-tune').execute(
    { feature: 'doc-tune' } as any,
    {} as any,
  )) as string;
  const parsed = parseToolResponse(raw);
  const pass =
    parsed.data?.taskSyncArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.mode === 'sync' &&
    matchesApprovedSyncFlow(parsed.data?.promotionFlow, 'doc-tune');
  return {
    id: 'plan-approve-sync-flow',
    pass,
    detail: pass
      ? 'warcraft_plan_approve returns the remaining sync flow once review is complete'
      : `response=${JSON.stringify(parsed.data ?? null)}`,
  };
}

async function checkPlanApproveReturnsStructuredChecklistRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  const planTools = new PlanTools({
    featureService: ctx.featureService,
    planService: ctx.planService,
    taskService: ctx.taskService,
    captureSession: () => {},
    updateFeatureMetadata: (feature, patch) => {
      ctx.featureService.patchMetadata(feature, patch as any);
    },
    workflowGatesMode: 'enforce',
  });
  ctx.featureService.create('doc-tune');
  ctx.planService.write(
    'doc-tune',
    '# doc-tune\n\n## Plan Review Checklist\n- [ ] Discovery is complete and current\n',
  );

  const raw = (await planTools.approvePlanTool((name?: string) => name || 'doc-tune').execute(
    { feature: 'doc-tune' } as any,
    {} as any,
  )) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    /plan review checklist is incomplete/i.test(String(parsed.error || '')) &&
    Array.isArray(parsed.hints) &&
    /Plan Review Checklist/.test(String(parsed.hints?.[0] || '')) &&
    /retry warcraft_plan_approve/i.test(String(parsed.hints?.[1] || '')) &&
    parsed.data?.blockedReason === 'plan_review_checklist_incomplete' &&
    Array.isArray(parsed.data?.reviewChecklistIssues) &&
    parsed.data.reviewChecklistIssues.length > 0 &&
    parsed.data?.retryArgs?.feature === 'doc-tune' &&
    matchesChecklistRecoveryFlow(parsed.data?.promotionFlow, 'doc-tune') &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'plan_review_checklist_incomplete';
  return {
    id: 'plan-approve-checklist-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_plan_approve returns structured recovery metadata when the review checklist is incomplete'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkPlanApproveRejectsRemainingManualTasks(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  ctx.planService.write(
    'doc-tune',
    [
      '# doc-tune',
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
  );
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune');
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Tiny Fix',
    priority: 3,
    description:
      'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);

  const raw = (await ctx.planTools.approvePlanTool((name?: string) => name || 'doc-tune').execute(
    { feature: 'doc-tune' } as any,
    {} as any,
  )) as string;
  const parsed = parseToolResponse(raw);
  const pass =
    parsed.success === false &&
    /cannot approve plan/i.test(String(parsed.error || '')) &&
    /01-tiny-fix/.test(String(parsed.error || '')) &&
    /warcraft_task_expand/.test(String(parsed.error || '')) &&
    Array.isArray((parsed as any).hints) &&
    /warcraft_task_expand/.test(String((parsed as any).hints?.[0] || '')) &&
    /retry warcraft_plan_approve/i.test(String((parsed as any).hints?.[1] || '')) &&
    (parsed as any).data?.blockedReason === 'manual_tasks_outside_plan' &&
    JSON.stringify((parsed as any).data?.remainingManualTasks) === JSON.stringify(['01-tiny-fix']) &&
    (parsed as any).data?.taskExpandArgs?.feature === 'doc-tune' &&
    JSON.stringify((parsed as any).data?.taskExpandArgs?.tasks) === JSON.stringify(['01-tiny-fix']) &&
    (parsed as any).data?.retryArgs?.feature === 'doc-tune' &&
    matchesPendingManualPromotionFlow((parsed as any).data?.promotionFlow, 'doc-tune', ['01-tiny-fix'], 'lightweight') &&
    Array.isArray((parsed as any).warnings) &&
    (parsed as any).warnings?.[0]?.type === 'manual_tasks_outside_plan';
  return {
    id: 'plan-approve-blocked-by-remaining-manual-tasks',
    pass,
    detail: pass
      ? 'warcraft_plan_approve blocks incomplete drafts that still leave manual tasks outside the reviewed plan'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkPlanReadReturnsStructuredMissingPlanRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
  } as any);
  const raw = (await ctx.planTools.readPlanTool((name?: string) => name || 'doc-tune').execute(
    { feature: 'doc-tune' } as any,
    {} as any,
  )) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'plan_missing_for_read' &&
    JSON.stringify(parsed.data?.pendingManualTasks) === JSON.stringify(['01-refresh-docs-wording']) &&
    parsed.data?.retryArgs?.feature === 'doc-tune' &&
    parsed.data?.retryArgs?.useScaffold === true &&
    Array.isArray(parsed.hints) &&
    /warcraft_plan_write/.test(String(parsed.hints?.[0] || '')) &&
    /read the draft again|approval/i.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'plan_missing_for_read';
  return {
    id: 'plan-read-missing-plan-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_plan_read returns structured scaffold recovery metadata when pending manual tasks exist but no plan has been written yet'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkPlanWriteReturnsStructuredScaffoldRetryRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
  } as any);
  const raw = (await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute(
    { feature: 'doc-tune' } as any,
    {} as any,
  )) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'plan_content_required_for_manual_tasks' &&
    JSON.stringify(parsed.data?.pendingManualTasks) === JSON.stringify(['01-refresh-docs-wording']) &&
    parsed.data?.retryArgs?.feature === 'doc-tune' &&
    parsed.data?.retryArgs?.useScaffold === true &&
    Array.isArray(parsed.hints) &&
    /useScaffold/.test(String(parsed.hints?.[0] || '')) &&
    /explicit plan markdown/i.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'plan_content_required_for_manual_tasks';
  return {
    id: 'plan-write-scaffold-retry-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_plan_write returns structured scaffold retry metadata when pending manual tasks already exist and explicit content is omitted'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkPlanWriteReturnsStructuredNoPendingScaffoldRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  ctx.planService.write(
    'doc-tune',
    '# doc-tune\n\nWorkflow Path: lightweight\n\n## Tasks\n\n### 1. Existing Task',
  );

  const raw = (await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute(
    { feature: 'doc-tune', useScaffold: true } as any,
    {} as any,
  )) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'no_pending_manual_tasks_for_scaffold' &&
    parsed.data?.planApproveArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.mode === 'sync' &&
    matchesDraftPlanPromotionFlow(parsed.data?.promotionFlow, 'doc-tune') &&
    Array.isArray(parsed.hints) &&
    /draft plan already covers/i.test(String(parsed.hints?.[0] || '')) &&
    /warcraft_plan_approve/i.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'no_pending_manual_tasks_for_scaffold';
  return {
    id: 'plan-write-no-pending-scaffold-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_plan_write returns structured continuation metadata when useScaffold has nothing left to materialize'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkPlanWriteReturnsStructuredDiscoveryRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');

  const raw = (await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute(
    { feature: 'doc-tune', content: '# doc-tune' } as any,
    {} as any,
  )) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    /discovery/i.test(String(parsed.error || '')) &&
    Array.isArray(parsed.hints) &&
    /Discovery/.test(String(parsed.hints?.[0] || '')) &&
    /retry warcraft_plan_write/i.test(String(parsed.hints?.[1] || '')) &&
    parsed.data?.blockedReason === 'discovery_section_invalid' &&
    typeof parsed.data?.discoveryError === 'string' &&
    parsed.data?.generatedFromManualTasks === false &&
    parsed.data?.sourceTaskCount === 0 &&
    parsed.data?.retryArgs?.feature === 'doc-tune' &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'discovery_section_invalid';
  return {
    id: 'plan-write-discovery-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_plan_write returns structured recovery metadata when discovery validation fails'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkPlanApproveReturnsStructuredBlockedRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  ctx.planService.write(
    'doc-tune',
    [
      '# doc-tune',
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
  );
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune');
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Tiny Fix',
    priority: 3,
    description:
      'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);

  const raw = (await ctx.planTools.approvePlanTool((name?: string) => name || 'doc-tune').execute(
    { feature: 'doc-tune' } as any,
    {} as any,
  )) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'manual_tasks_outside_plan' &&
    JSON.stringify(parsed.data?.remainingManualTasks) === JSON.stringify(['01-tiny-fix']) &&
    parsed.data?.taskExpandArgs?.feature === 'doc-tune' &&
    JSON.stringify(parsed.data?.taskExpandArgs?.tasks) === JSON.stringify(['01-tiny-fix']) &&
    parsed.data?.taskExpandArgs?.mode === 'lightweight' &&
    parsed.data?.retryArgs?.feature === 'doc-tune' &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'manual_tasks_outside_plan' &&
    parsed.warnings[0]?.count === 1;
  return {
    id: 'plan-approve-blocked-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_plan_approve returns structured recovery metadata when approval is blocked'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkPlanWriteCanMaterializeLightweightScaffold(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
  } as any);

  const raw = (await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    useScaffold: true,
  } as any, {} as any)) as string;
  const parsed = parseToolResponse(raw);
  const writtenPlan = ctx.planService.read('doc-tune');
  const pass =
    parsed.success === true &&
    parsed.data?.generatedFromManualTasks === true &&
    parsed.data?.planScaffoldMode === 'lightweight' &&
    parsed.data?.planApproveArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.mode === 'sync' &&
    /Workflow Path: lightweight/i.test(String(writtenPlan?.content || '')) &&
    /## Ghost Diffs/.test(String(writtenPlan?.content || ''));
  return {
    id: 'plan-write-use-scaffold-lightweight',
    pass,
    detail: pass ? 'warcraft_plan_write can materialize a lightweight scaffold from pending manual tasks' : `writtenPlan=${String(writtenPlan?.content || '')}`,
  };
}

async function checkPlanWriteReturnsPromotionFlow(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README and docs wording for the instant workflow path. Impact: README plus docs text. Safety: keep behavior unchanged. Verify: docs tests or snapshots still pass. Rollback: revert.',
  } as any);

  const raw = (await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    useScaffold: true,
  } as any, {} as any)) as string;
  const parsed = parseToolResponse(raw);
  const pass = matchesDraftPlanPromotionFlow(parsed.data?.promotionFlow, 'doc-tune');
  return {
    id: 'plan-write-promotion-flow',
    pass,
    detail: pass
      ? 'warcraft_plan_write(useScaffold) returns the remaining review/approve/sync flow'
      : `promotionFlow=${JSON.stringify(parsed.data?.promotionFlow ?? null)}`,
  };
}

async function checkPlanWriteCanMaterializeStandardScaffold(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'quick-fix');
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Tighten prompt wording',
    priority: 3,
    description:
      'Background: tiny wording fix. Impact: prompt text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: second tiny wording fix. Impact: prompt/help text only. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Polish status wording',
    priority: 3,
    description:
      'Background: third tiny wording fix. Impact: another prompt/status text tweak. Safety: low risk. Verify: prompt tests. Rollback: revert.',
  } as any);

  const raw = (await ctx.planTools.writePlanTool((name?: string) => name || 'quick-fix').execute({
    feature: 'quick-fix',
    useScaffold: true,
  } as any, {} as any)) as string;
  const parsed = parseToolResponse(raw);
  const writtenPlan = ctx.planService.read('quick-fix');
  const pass =
    parsed.success === true &&
    parsed.data?.generatedFromManualTasks === true &&
    parsed.data?.planScaffoldMode === 'standard' &&
    parsed.data?.planApproveArgs?.feature === 'quick-fix' &&
    parsed.data?.taskSyncArgs?.feature === 'quick-fix' &&
    parsed.data?.taskSyncArgs?.mode === 'sync' &&
    !/Workflow Path: lightweight/i.test(String(writtenPlan?.content || '')) &&
    /### 3\. Polish status wording/.test(String(writtenPlan?.content || ''));
  return {
    id: 'plan-write-use-scaffold-standard',
    pass,
    detail: pass ? 'warcraft_plan_write can materialize a standard scaffold when instant work exceeds lightweight limits' : `writtenPlan=${String(writtenPlan?.content || '')}`,
  };
}

async function checkScaffoldPromotionSyncsManualTasksIntoPlan(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune');
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README wording for the instant workflow path. Impact: README text only. Safety: keep behavior unchanged. Verify: docs tests still pass. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: update inline help text for the instant workflow path. Impact: help text only. Safety: keep behavior unchanged. Verify: docs tests still pass. Rollback: revert.',
  } as any);

  await ctx.planTools.writePlanTool((name?: string) => name || 'doc-tune').execute(
    { feature: 'doc-tune', useScaffold: true } as any,
    {} as any,
  );
  await ctx.planTools.approvePlanTool((name?: string) => name || 'doc-tune').execute({ feature: 'doc-tune' } as any, {} as any);
  const syncRaw = (await ctx.taskTools.syncTasksTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    mode: 'sync',
  } as any)) as string;
  const parsed = parseToolResponse(syncRaw);
  const first = ctx.taskService.getRawStatus('doc-tune', '01-refresh-docs-wording');
  const second = ctx.taskService.getRawStatus('doc-tune', '02-refresh-help-text');
  const pass =
    parsed.success === true &&
    Array.isArray(parsed.data?.created) &&
    parsed.data.created.length === 0 &&
    Array.isArray(parsed.data?.manualTasks) &&
    parsed.data.manualTasks.length === 0 &&
    Array.isArray(parsed.data?.reconciled) &&
    parsed.data.reconciled.length === 2 &&
    first?.origin === 'plan' &&
    second?.origin === 'plan';
  return {
    id: 'scaffold-promotion-sync',
    pass,
    detail: pass
      ? 'manual instant tasks can be promoted through scaffolded planning and sync without duplicate tasks'
      : `sync=${JSON.stringify(parsed.data ?? null)} first=${JSON.stringify(first ?? null)} second=${JSON.stringify(second ?? null)}`,
  };
}

async function checkTaskExpandWritesPlanAndPreviewsPromotion(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune');
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README wording for the instant workflow path. Impact: README text only. Safety: keep behavior unchanged. Verify: docs tests still pass. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: update inline help text for the instant workflow path. Impact: help text only. Safety: keep behavior unchanged. Verify: docs tests still pass. Rollback: revert.',
  } as any);

  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const writtenPlan = ctx.planService.read('doc-tune');
  const pass =
    parsed.success === true &&
    parsed.data?.planScaffoldMode === 'lightweight' &&
    parsed.data?.planApproveArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.mode === 'sync' &&
    /Workflow Path: lightweight/i.test(String(writtenPlan?.content || '')) &&
    Array.isArray(parsed.data?.syncPreview?.wouldReconcile) &&
    parsed.data.syncPreview.wouldReconcile.length === 2 &&
    /warcraft_plan_approve/i.test(String(parsed.data?.message || ''));
  return {
    id: 'task-expand-plan-promotion',
    pass,
    detail: pass
      ? 'warcraft_task_expand writes the scaffolded plan and previews the sync reconciliation'
      : `response=${JSON.stringify(parsed.data ?? null)} writtenPlan=${String(writtenPlan?.content || '')}`,
  };
}

async function checkTaskExpandReturnsPromotionFlow(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune');
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Refresh docs wording',
    priority: 3,
    description:
      'Background: update the README wording for the instant workflow path. Impact: README text only. Safety: keep behavior unchanged. Verify: docs tests still pass. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: update inline help text for the instant workflow path. Impact: help text only. Safety: keep behavior unchanged. Verify: docs tests still pass. Rollback: revert.',
  } as any);

  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const pass = matchesDraftPlanPromotionFlow(parsed.data?.promotionFlow, 'doc-tune');
  return {
    id: 'task-expand-promotion-flow',
    pass,
    detail: pass
      ? 'warcraft_task_expand returns the remaining review/approve/sync flow after writing the draft plan'
      : `promotionFlow=${JSON.stringify(parsed.data?.promotionFlow ?? null)}`,
  };
}

async function checkTaskExpandReturnsFollowUpExpansionForRemainingManualTasks(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  ctx.planService.write(
    'doc-tune',
    [
      '# doc-tune',
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
  );
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune');
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Tiny Fix',
    priority: 3,
    description:
      'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Second Tiny Fix',
    priority: 3,
    description:
      'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);

  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    tasks: ['02-second-tiny-fix'],
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const pass =
    JSON.stringify(parsed.data?.remainingManualTasks) === JSON.stringify(['01-tiny-fix']) &&
    parsed.data?.planApproveArgs == null &&
    parsed.data?.taskSyncArgs == null &&
    parsed.data?.taskExpandArgs?.feature === 'doc-tune' &&
    JSON.stringify(parsed.data?.taskExpandArgs?.tasks) === JSON.stringify(['01-tiny-fix']) &&
    parsed.data?.taskExpandArgs?.mode === 'lightweight' &&
    matchesPendingManualPromotionFlow(parsed.data?.promotionFlow, 'doc-tune', ['01-tiny-fix'], 'lightweight');
  return {
    id: 'task-expand-follow-up-expansion',
    pass,
    detail: pass
      ? 'warcraft_task_expand returns the next expansion step when manual tasks still remain outside the draft plan'
      : `response=${JSON.stringify(parsed.data ?? null)}`,
  };
}

async function checkTaskExpandReturnsStructuredLightweightRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('quick-fix');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'quick-fix');
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Tiny Fix',
    priority: 3,
    description:
      'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Second Tiny Fix',
    priority: 3,
    description:
      'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'quick-fix',
    name: 'Third Tiny Fix',
    priority: 3,
    description:
      'Background: third tiny change. Impact: status text only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);

  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'quick-fix').execute({
    feature: 'quick-fix',
    mode: 'lightweight',
  } as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'lightweight_plan_invalid' &&
    Array.isArray(parsed.data?.validationIssues) &&
    parsed.data.validationIssues.length > 0 &&
    parsed.data?.retryTaskExpandArgs?.feature === 'quick-fix' &&
    JSON.stringify(parsed.data?.retryTaskExpandArgs?.tasks) ===
      JSON.stringify(['01-tiny-fix', '02-second-tiny-fix', '03-third-tiny-fix']) &&
    parsed.data?.retryTaskExpandArgs?.mode === 'standard' &&
    Array.isArray(parsed.hints) &&
    /warcraft_task_expand/.test(String(parsed.hints?.[0] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'lightweight_plan_invalid';
  return {
    id: 'task-expand-lightweight-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_task_expand returns structured recovery metadata when lightweight guardrails reject expansion'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkTaskExpandReturnsStructuredNonDraftRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const existingPlanContent =
    '# doc-tune\n\nWorkflow Path: lightweight\n\n## Discovery\n\nImpact: existing plan\nSafety: low\nVerify: tests\nRollback: revert\n\n## Plan Review Checklist\n- [x] Discovery is complete and current\n- [x] Scope and non-goals are explicit\n- [x] Risks, rollout, and verification are defined\n- [x] Tasks and dependencies are actionable\n\n## Tasks\n\n### 1. Existing Task';
  ctx.planService.write('doc-tune', existingPlanContent);
  ctx.planService.approve('doc-tune', undefined, existingPlanContent);
  await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Tiny Fix',
    priority: 3,
    description:
      'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);

  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    mode: 'lightweight',
  } as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'existing_plan_not_draft' &&
    parsed.data?.currentPlanStatus === 'approved' &&
    parsed.data?.planWriteArgs?.feature === 'doc-tune' &&
    /Existing Task/.test(String(parsed.data?.planWriteArgs?.content || '')) &&
    parsed.data?.retryTaskExpandArgs?.feature === 'doc-tune' &&
    JSON.stringify(parsed.data?.retryTaskExpandArgs?.tasks) === JSON.stringify(['01-tiny-fix']) &&
    parsed.data?.retryTaskExpandArgs?.mode === 'lightweight' &&
    Array.isArray(parsed.hints) &&
    /warcraft_plan_write/.test(String(parsed.hints?.[0] || '')) &&
    /warcraft_task_expand/.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'existing_plan_not_draft';
  return {
    id: 'task-expand-non-draft-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_task_expand returns structured recovery metadata when expansion is attempted against a non-draft plan'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkTaskExpandReturnsStructuredNoPendingRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  ctx.planService.write(
    'doc-tune',
    '# doc-tune\n\nWorkflow Path: lightweight\n\n## Discovery\n\nImpact: existing plan\nSafety: low\nVerify: tests\nRollback: revert\n\n## Tasks\n\n### 1. Existing Task',
  );
  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  } as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'no_pending_manual_tasks_to_expand' &&
    parsed.data?.planApproveArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.mode === 'sync' &&
    matchesDraftPlanPromotionFlow(parsed.data?.promotionFlow, 'doc-tune') &&
    Array.isArray(parsed.hints) &&
    /draft plan already covers/i.test(String(parsed.hints?.[0] || '')) &&
    /warcraft_plan_approve/i.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'no_pending_manual_tasks_to_expand';
  return {
    id: 'task-expand-no-pending-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_task_expand returns structured continuation metadata when a draft plan has nothing left to expand'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkTaskExpandReturnsStructuredApprovedNoPendingRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const approvedPlan =
    '# doc-tune\n\nWorkflow Path: lightweight\n\n## Discovery\n\nImpact: existing plan\nSafety: low\nVerify: tests\nRollback: revert\n\n## Plan Review Checklist\n- [x] Discovery is complete and current\n- [x] Scope and non-goals are explicit\n- [x] Risks, rollout, and verification are defined\n- [x] Tasks and dependencies are actionable\n\n## Tasks\n\n### 1. Existing Task';
  ctx.planService.write('doc-tune', approvedPlan);
  ctx.planService.approve('doc-tune', undefined, approvedPlan);
  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  } as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'approved_plan_has_no_pending_manual_tasks_to_expand' &&
    parsed.data?.taskSyncArgs?.feature === 'doc-tune' &&
    parsed.data?.taskSyncArgs?.mode === 'sync' &&
    matchesApprovedPlanSyncFlow(parsed.data?.promotionFlow, 'doc-tune') &&
    Array.isArray(parsed.hints) &&
    /no remaining manual work/i.test(String(parsed.hints?.[0] || '')) &&
    /warcraft_tasks_sync/.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'approved_plan_has_no_pending_manual_tasks_to_expand';
  return {
    id: 'task-expand-approved-no-pending-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_task_expand returns continuation metadata when an approved plan has no remaining manual tasks to merge'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkTaskExpandReturnsStructuredSelectionRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune');
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Tiny Fix',
    priority: 3,
    description:
      'Background: tiny change. Impact: prompt only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Second Tiny Fix',
    priority: 3,
    description:
      'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);

  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    tasks: ['99-missing-task'],
  } as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'manual_task_selection_invalid' &&
    parsed.data?.requestedTask === '99-missing-task' &&
    JSON.stringify(parsed.data?.availableManualTasks) === JSON.stringify(['01-tiny-fix', '02-second-tiny-fix']) &&
    parsed.data?.retryTaskExpandArgs?.feature === 'doc-tune' &&
    JSON.stringify(parsed.data?.retryTaskExpandArgs?.tasks) === JSON.stringify(['01-tiny-fix', '02-second-tiny-fix']) &&
    Array.isArray(parsed.hints) &&
    /Available pending manual tasks/.test(String(parsed.hints?.[0] || '')) &&
    /warcraft_task_expand/.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'manual_task_selection_invalid';
  return {
    id: 'task-expand-selection-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_task_expand returns structured recovery metadata when selected manual tasks are invalid'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkTaskExpandReturnsStructuredDraftDiscoveryRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  ctx.planService.write('doc-tune', '# doc-tune\n\nWorkflow Path: lightweight\n\n## Tasks\n\n### 1. Existing Task');
  await ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    name: 'Second Tiny Fix',
    priority: 3,
    description:
      'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);
  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    tasks: ['01-second-tiny-fix'],
  } as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    parsed.data?.blockedReason === 'draft_plan_discovery_section_invalid' &&
    parsed.data?.discoveryError &&
    parsed.data?.repairPlanWriteArgs?.feature === 'doc-tune' &&
    /Second Tiny Fix/.test(String(parsed.data?.repairPlanWriteArgs?.content || '')) &&
    JSON.stringify(parsed.data?.affectedManualTasks) === JSON.stringify(['01-second-tiny-fix']) &&
    Array.isArray(parsed.hints) &&
    /warcraft_plan_write/.test(String(parsed.hints?.[0] || '')) &&
    /warcraft_plan_approve|warcraft_task_expand/.test(String(parsed.hints?.[1] || '')) &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'draft_plan_discovery_section_invalid';
  return {
    id: 'task-expand-draft-discovery-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_task_expand returns structured repair metadata when an existing draft plan is missing discovery details'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkTaskExpandReturnsStructuredDraftRepairRecovery(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  ctx.planService.write(
    'doc-tune',
    '# doc-tune\n\nWorkflow Path: lightweight\n\n## Discovery\n\nImpact: existing plan\nSafety: low\nVerify: tests\nRollback: revert',
  );
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune');
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Second Tiny Fix',
    priority: 3,
    description:
      'Background: second tiny change. Impact: help text only. Safety: low. Verify: prompt tests. Rollback: revert.',
  } as any);

  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
    tasks: ['01-second-tiny-fix'],
  } as any)) as string;
  const parsed = parseToolResponse(raw) as any;
  const pass =
    parsed.success === false &&
    /## Tasks section/.test(String(parsed.error || '')) &&
    Array.isArray(parsed.hints) &&
    /warcraft_plan_write/.test(String(parsed.hints?.[0] || '')) &&
    /retry warcraft_task_expand/i.test(String(parsed.hints?.[1] || '')) &&
    parsed.data?.blockedReason === 'draft_plan_tasks_section_missing' &&
    parsed.data?.requiredSection === '## Tasks' &&
    parsed.data?.repairPlanWriteArgs?.feature === 'doc-tune' &&
    /## Tasks/.test(String(parsed.data?.repairPlanWriteArgs?.content || '')) &&
    parsed.data?.retryTaskExpandArgs?.feature === 'doc-tune' &&
    JSON.stringify(parsed.data?.retryTaskExpandArgs?.tasks) === JSON.stringify(['01-second-tiny-fix']) &&
    parsed.data?.retryTaskExpandArgs?.mode === 'lightweight' &&
    Array.isArray(parsed.warnings) &&
    parsed.warnings[0]?.type === 'draft_plan_tasks_section_missing';
  return {
    id: 'task-expand-draft-repair-structured-recovery',
    pass,
    detail: pass
      ? 'warcraft_task_expand returns structured repair metadata when an existing draft plan is missing a tasks section'
      : `response=${JSON.stringify(parsed)}`,
  };
}

async function checkTaskExpandCanMergeIntoDraftPlan(): Promise<CheckResult> {
  const ctx = createWorkspace();
  ctx.featureService.create('doc-tune');
  ctx.planService.write(
    'doc-tune',
    [
      '# doc-tune',
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
  );
  const createTask = ctx.taskTools.createTaskTool((name?: string) => name || 'doc-tune');
  await createTask.execute({
    feature: 'doc-tune',
    name: 'Refresh help text',
    priority: 3,
    description:
      'Background: update inline help text for the instant workflow path. Impact: help text only. Safety: keep behavior unchanged. Verify: docs tests still pass. Rollback: revert.',
  } as any);

  const raw = (await ctx.taskTools.expandTaskTool((name?: string) => name || 'doc-tune').execute({
    feature: 'doc-tune',
  } as any)) as string;
  const parsed = parseToolResponse(raw);
  const writtenPlan = ctx.planService.read('doc-tune');
  const planContent = String(writtenPlan?.content || '');
  const pass =
    parsed.success === true &&
    parsed.data?.mergedIntoExistingPlan === true &&
    /### 1\. Existing Task/.test(planContent) &&
    /### 2\. Refresh help text/.test(planContent) &&
    Array.isArray(parsed.data?.syncPreview?.wouldReconcile) &&
    parsed.data.syncPreview.wouldReconcile.length === 1;
  return {
    id: 'task-expand-merge-draft-plan',
    pass,
    detail: pass ? 'warcraft_task_expand can merge pending manual work into an existing draft plan' : `response=${JSON.stringify(parsed.data ?? null)} writtenPlan=${planContent}`,
  };
}

async function checkPromptsMentionInstantPath(): Promise<CheckResult> {
  const khadgar = buildKhadgarPrompt({ verificationModel: 'tdd' });
  const saurfang = buildSaurfangPrompt({ verificationModel: 'tdd' });
  const indexSource = readFileSync(path.join(process.cwd(), 'packages/opencode-warcraft/src/index.ts'), 'utf-8');
  const pass =
    /instant workflow|skip plan|warcraft_task_create/i.test(khadgar) &&
    /instant workflow|skip plan|warcraft_task_create/i.test(MIMIRON_PROMPT) &&
    /instant workflow|skip plan|warcraft_task_create/i.test(saurfang) &&
    /instant workflow|skip plan|warcraft_task_create/i.test(indexSource);
  return {
    id: 'prompts-mention-instant-path',
    pass,
    detail: pass ? 'system + agent prompts describe the instant/manual path' : 'prompts still emphasize only plan-first/lightweight paths',
  };
}

async function checkBeadsModeManualBriefPersistence(): Promise<CheckResult> {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'instant-workflow-beads-'));
  const stateByBead = new Map<string, string>();
  const repository = {
    getEpicByFeatureName: () => ({ success: true, value: 'epic-1' }),
    createTask: () => ({ success: true, value: 'task-1' }),
    setTaskState: (beadId: string, state: Record<string, unknown>) => {
      stateByBead.set(beadId, encodeTaskState(state as any));
      return { success: true, value: undefined };
    },
    getTaskState: (beadId: string) => ({ success: true, value: decodeTaskState(stateByBead.get(beadId) ?? null) }),
    flushArtifacts: () => ({ success: true, value: undefined }),
  } as any;

  const store = new BeadsTaskStore(projectRoot, repository);
  const service = new TaskService(projectRoot, store, 'on');
  const folder = service.create(
    'quick-fix',
    'Tighten prompt wording',
    1,
    3,
    'Background: tiny fix. Impact: prompt text only. Safety: low. Verify: prompt tests. Rollback: revert.',
  );
  const spec = formatSpecContent(
    service.buildSpecData({
      featureName: 'quick-fix',
      task: { folder, name: 'Tighten prompt wording', order: 1 },
      dependsOn: [],
      allTasks: [{ folder, name: 'Tighten prompt wording', order: 1 }],
      planContent: null,
      contextFiles: [],
      completedTasks: [],
    }),
  );
  rmSync(projectRoot, { recursive: true, force: true });

  const pass = !spec.includes('_No plan section available._') && /Background: tiny fix\./.test(spec);
  return {
    id: 'beads-mode-manual-brief-persistence',
    pass,
    detail: pass
      ? 'beads-backed manual tasks preserve the self-contained brief'
      : 'beads-backed manual tasks still lose the instant-task brief during persistence/readback',
  };
}

async function main() {
  const checks = await Promise.all([
    checkFeatureCreateMentionsInstantPath(),
    checkFeatureCreateAnalyzesTinyRequest(),
    checkFeatureCreateAnalyzesBroadRequest(),
    checkManualTaskCanPromoteInstantWorkflow(),
    checkManualTaskWarnsWhenInstantWorkflowOutgrowsTinyPath(),
    checkManualTaskCreatesLightweightRecommendationForNonTinyBrief(),
    checkManualTaskReturnsPlanScaffoldWhenItNeedsReview(),
    checkManualTaskReturnsPlanWriteArgsWhenItNeedsReview(),
    checkManualTaskReturnsTaskExpandArgsWhenItNeedsReview(),
    checkManualTaskReturnsPromotionFlowWhenItNeedsReview(),
    checkManualTaskSpecIsSelfContained(),
    checkStatusNextActionSupportsInstantPath(),
    checkStatusNextActionSupportsLightweightRecommendation(),
    checkStatusReturnsPlanApproveArgsForDraftPlan(),
    checkStatusReturnsDraftPlanPromotionFlow(),
    checkInstantWorkflowExpansionGuidance(),
    checkInstantWorkflowEscalatesPastLightweightTaskLimit(),
    checkStatusReturnsPlanScaffoldForEscalatedInstantWork(),
    checkStatusReturnsPlanWriteArgsForEscalatedInstantWork(),
    checkStatusReturnsTaskExpandArgsForEscalatedInstantWork(),
    checkStatusReturnsPromotionFlowForEscalatedInstantWork(),
    checkStatusDraftPlanSurfacesRemainingManualPromotion(),
    checkStatusReturnsTaskSyncArgsAfterApproval(),
    checkSyncTasksReturnsStructuredMissingPlanRecovery(),
    checkSyncTasksReturnsStructuredApprovalRecovery(),
    checkSyncTasksReturnsStructuredLightweightRecovery(),
    checkPlanApproveReturnsStructuredMissingPlanRecovery(),
    checkPlanApproveReturnsSyncFlow(),
    checkPlanApproveReturnsStructuredChecklistRecovery(),
    checkPlanApproveRejectsRemainingManualTasks(),
    checkPlanApproveReturnsStructuredBlockedRecovery(),
    checkPlanReadReturnsStructuredMissingPlanRecovery(),
    checkPlanWriteReturnsStructuredScaffoldRetryRecovery(),
    checkPlanWriteReturnsStructuredNoPendingScaffoldRecovery(),
    checkPlanWriteReturnsStructuredDiscoveryRecovery(),
    checkPlanWriteCanMaterializeLightweightScaffold(),
    checkPlanWriteReturnsPromotionFlow(),
    checkPlanWriteCanMaterializeStandardScaffold(),
    checkScaffoldPromotionSyncsManualTasksIntoPlan(),
    checkTaskExpandWritesPlanAndPreviewsPromotion(),
    checkTaskExpandReturnsPromotionFlow(),
    checkTaskExpandReturnsFollowUpExpansionForRemainingManualTasks(),
    checkTaskExpandReturnsStructuredLightweightRecovery(),
    checkTaskExpandReturnsStructuredNonDraftRecovery(),
    checkTaskExpandReturnsStructuredNoPendingRecovery(),
    checkTaskExpandReturnsStructuredApprovedNoPendingRecovery(),
    checkTaskExpandReturnsStructuredSelectionRecovery(),
    checkTaskExpandReturnsStructuredDraftDiscoveryRecovery(),
    checkTaskExpandReturnsStructuredDraftRepairRecovery(),
    checkTaskExpandCanMergeIntoDraftPlan(),
    checkPromptsMentionInstantPath(),
    checkBeadsModeManualBriefPersistence(),
  ]);

  const score = checks.filter((check) => check.pass).length;
  for (const check of checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.id} - ${check.detail}`);
  }
  console.log(`METRIC instant_workflow_score=${score}`);

  // best-effort tmp cleanup
  try {
    rmSync(path.join(os.tmpdir(), 'instant-workflow-score-'), { recursive: true, force: true });
  } catch {}
}

await main();
