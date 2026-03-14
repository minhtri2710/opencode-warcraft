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
    /Workflow Path: lightweight/i.test(String(writtenPlan?.content || '')) &&
    /## Ghost Diffs/.test(String(writtenPlan?.content || ''));
  return {
    id: 'plan-write-use-scaffold-lightweight',
    pass,
    detail: pass ? 'warcraft_plan_write can materialize a lightweight scaffold from pending manual tasks' : `writtenPlan=${String(writtenPlan?.content || '')}`,
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
    checkManualTaskSpecIsSelfContained(),
    checkStatusNextActionSupportsInstantPath(),
    checkStatusNextActionSupportsLightweightRecommendation(),
    checkInstantWorkflowExpansionGuidance(),
    checkInstantWorkflowEscalatesPastLightweightTaskLimit(),
    checkStatusReturnsPlanScaffoldForEscalatedInstantWork(),
    checkStatusReturnsPlanWriteArgsForEscalatedInstantWork(),
    checkPlanWriteCanMaterializeLightweightScaffold(),
    checkPlanWriteCanMaterializeStandardScaffold(),
    checkScaffoldPromotionSyncsManualTasksIntoPlan(),
    checkTaskExpandWritesPlanAndPreviewsPromotion(),
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
