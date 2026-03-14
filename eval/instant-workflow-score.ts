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
import { buildKhadgarPrompt } from '../packages/opencode-warcraft/src/agents/khadgar.js';
import { MIMIRON_PROMPT } from '../packages/opencode-warcraft/src/agents/mimiron.js';
import { buildSaurfangPrompt } from '../packages/opencode-warcraft/src/agents/saurfang.js';
import { ContextTools } from '../packages/opencode-warcraft/src/tools/context-tools.js';
import { FeatureTools } from '../packages/opencode-warcraft/src/tools/feature-tools.js';
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

  return { projectRoot, featureService, planService, taskService, featureTools, taskTools, contextTools };
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

async function main() {
  const checks = await Promise.all([
    checkFeatureCreateMentionsInstantPath(),
    checkManualTaskCanPromoteInstantWorkflow(),
    checkManualTaskSpecIsSelfContained(),
    checkStatusNextActionSupportsInstantPath(),
    checkPromptsMentionInstantPath(),
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
