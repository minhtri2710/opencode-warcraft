import * as fs from 'fs';
import * as path from 'path';
import {
  AgentsMdService,
  BeadsRepository,
  BvTriageService,
  buildEffectiveDependencies,
  type ConfigService,
  ContextService,
  createStores,
  detectContext,
  FeatureService,
  getFeaturePath,
  getWarcraftPath,
  PlanService,
  TaskService,
  WorktreeService,
} from 'warcraft-core';
import {
  COMPLETION_GATES,
  hasCompletionGateEvidence,
  isPathInside,
  validateTaskStatus,
  WORKFLOW_GATES_MODE,
} from './guards.js';
import { createBuiltinMcps } from './mcp/index.js';
import { getFilteredSkills } from './skills/builtin.js';
import {
  BatchTools,
  ContextTools,
  FeatureTools,
  PlanTools,
  SkillTools,
  TaskTools,
  WorktreeTools,
} from './tools/index.js';
import type { BlockedResult, ToolContext } from './types.js';

// ============================================================================
// Service Composition Root
// Instantiates all services and wires tool modules together.
// ============================================================================

export interface WarcraftContainer {
  featureService: FeatureService;
  planService: PlanService;
  taskService: TaskService;
  worktreeService: WorktreeService;
  contextService: ContextService;
  agentsMdService: AgentsMdService;
  configService: ConfigService;
  bvTriageService: BvTriageService;
  builtinMcps: ReturnType<typeof createBuiltinMcps>;
  filteredSkills: ReturnType<typeof getFilteredSkills>;
  resolveFeature: (explicit?: string) => string | null;
  captureSession: (feature: string, toolContext: unknown) => void;
  updateFeatureMetadata: (
    feature: string,
    patch: {
      workflowPath?: 'standard' | 'lightweight';
      reviewChecklistVersion?: 'v1';
      reviewChecklistCompletedAt?: string;
    },
  ) => void;
  checkBlocked: (feature: string) => BlockedResult;
  checkDependencies: (feature: string, taskFolder: string) => { allowed: boolean; error?: string };
  isPathInside: typeof isPathInside;
  featureTools: FeatureTools;
  planTools: PlanTools;
  taskTools: TaskTools;
  worktreeTools: WorktreeTools;
  batchTools: BatchTools;
  contextTools: ContextTools;
  skillTools: SkillTools;
  parallelExecution?: { strategy?: 'unbounded' | 'bounded'; maxConcurrency?: number };
}

export function createWarcraftContainer(directory: string, configService: ConfigService): WarcraftContainer {
  const beadsMode = configService.getBeadsMode();
  const repository = new BeadsRepository(directory, {}, beadsMode);
  const stores = createStores(directory, beadsMode, repository);
  const planService = new PlanService(directory, stores.planStore, beadsMode);
  const taskService = new TaskService(directory, stores.taskStore, beadsMode);
  const featureService = new FeatureService(directory, stores.featureStore, planService, beadsMode, taskService);
  const contextService = new ContextService(directory, configService);
  const agentsMdService = new AgentsMdService(directory, contextService);
  const disabledMcps = configService.getDisabledMcps();
  const disabledSkills = configService.getDisabledSkills();
  const builtinMcps = createBuiltinMcps(disabledMcps);
  const filteredSkills = getFilteredSkills(disabledSkills);
  const worktreeService = new WorktreeService({
    baseDir: directory,
    warcraftDir: getWarcraftPath(directory, configService.getBeadsMode()),
  });

  // Initialize BV Triage Service with explicit state ownership
  const bvTriageService = new BvTriageService(directory, configService.getBeadsMode() !== 'off');
  const parallelExecution = (
    configService.get() as {
      parallelExecution?: { strategy?: 'unbounded' | 'bounded'; maxConcurrency?: number };
    }
  ).parallelExecution;

  // --- Feature resolution ---

  const resolveFeature = (explicit?: string): string | null => {
    const listFeaturesSafe = (): string[] => {
      try {
        return featureService.list();
      } catch {
        return [];
      }
    };

    const resolveByIdentity = (identity: string): string | null => {
      return identity;
    };

    if (explicit) {
      return resolveByIdentity(explicit);
    }

    const context = detectContext(directory);
    if (context.feature) {
      return resolveByIdentity(context.feature);
    }

    const features = listFeaturesSafe();
    if (features.length === 1) return features[0];

    return null;
  };

  // --- Session & metadata helpers ---

  const captureSession = (feature: string, toolContext: unknown) => {
    const ctx = toolContext as ToolContext;
    if (ctx?.sessionID) {
      try {
        const currentSession = featureService.getSession(feature);
        if (currentSession !== ctx.sessionID) {
          featureService.setSession(feature, ctx.sessionID);
        }
      } catch (_error) {
        // Ignore if feature not found yet
      }
    }
  };

  const updateFeatureMetadata = (
    feature: string,
    patch: {
      workflowPath?: 'standard' | 'lightweight';
      reviewChecklistVersion?: 'v1';
      reviewChecklistCompletedAt?: string;
    },
  ): void => {
    try {
      const exists = featureService.get(feature);
      if (exists) {
        featureService.patchMetadata(feature, patch);
      }
    } catch (_error) {
      // Ignore
    }
  };

  // --- Blocked check ---

  const checkBlocked = (feature: string): BlockedResult => {
    const blockedPath = path.join(getFeaturePath(directory, feature, configService.getBeadsMode()), 'BLOCKED');
    try {
      const reason = fs.readFileSync(blockedPath, 'utf-8').trim();
      const message = `⛔ BLOCKED by Commander

${reason || '(No reason provided)'}

The human has blocked this feature. Wait for them to unblock it.
To unblock: Remove ${blockedPath}`;
      return { blocked: true, reason, message, blockedPath };
    } catch {
      return { blocked: false };
    }
  };

  // --- Dependency checking ---

  const checkDependencies = (feature: string, taskFolder: string): { allowed: boolean; error?: string } => {
    const taskStatus = taskService.getRawStatus(feature, taskFolder);
    if (!taskStatus) {
      return { allowed: true };
    }

    const tasks = taskService.list(feature).map((task) => {
      const status = taskService.getRawStatus(feature, task.folder);
      return {
        folder: task.folder,
        status: task.status,
        dependsOn: status?.dependsOn,
      };
    });

    const effectiveDeps = buildEffectiveDependencies(tasks);
    const deps = effectiveDeps.get(taskFolder) ?? [];

    if (deps.length === 0) {
      return { allowed: true };
    }

    const unmetDeps: Array<{ folder: string; status: string }> = [];

    for (const depFolder of deps) {
      const depStatus = taskService.getRawStatus(feature, depFolder);

      if (!depStatus || depStatus.status !== 'done') {
        unmetDeps.push({
          folder: depFolder,
          status: depStatus?.status ?? 'unknown',
        });
      }
    }

    if (unmetDeps.length > 0) {
      const depList = unmetDeps.map((d) => `"${d.folder}" (${d.status})`).join(', ');
      const triage = taskStatus.beadId ? bvTriageService.getBlockerTriage(taskStatus.beadId) : null;
      const bvHealth = bvTriageService.getHealth();
      const triageHint = triage
        ? ` Beads triage (bv): ${triage.summary}`
        : bvHealth.lastError
          ? ` Beads triage (bv unavailable): ${bvHealth.lastError}`
          : '';

      return {
        allowed: false,
        error:
          `Dependency constraint: Task "${taskFolder}" cannot start - dependencies not done: ${depList}. ` +
          `Only tasks with status 'done' satisfy dependencies.${triageHint}`,
      };
    }

    return { allowed: true };
  };

  // --- Tool modules ---

  const featureTools = new FeatureTools({ featureService });
  const planTools = new PlanTools({
    featureService,
    planService,
    captureSession,
    updateFeatureMetadata,
    workflowGatesMode: WORKFLOW_GATES_MODE,
  });
  const taskTools = new TaskTools({
    featureService,
    planService,
    taskService,
    workflowGatesMode: WORKFLOW_GATES_MODE,
    validateTaskStatus,
  });
  const worktreeTools = new WorktreeTools({
    featureService,
    planService,
    taskService,
    worktreeService,
    contextService,
    validateTaskStatus,
    checkBlocked,
    checkDependencies,
    hasCompletionGateEvidence,
    completionGates: COMPLETION_GATES,
  });
  const batchTools = new BatchTools({
    featureService,
    planService,
    taskService,
    worktreeService,
    contextService,
    checkBlocked,
    checkDependencies,
    parallelExecution,
  });
  const contextTools = new ContextTools({
    featureService,
    planService,
    taskService,
    contextService,
    agentsMdService,
    worktreeService,
    checkBlocked,
    bvTriageService,
  });
  const skillTools = new SkillTools({ filteredSkills });

  return {
    featureService,
    planService,
    taskService,
    worktreeService,
    contextService,
    agentsMdService,
    configService,
    bvTriageService,
    builtinMcps,
    filteredSkills,
    resolveFeature,
    captureSession,
    updateFeatureMetadata,
    checkBlocked,
    checkDependencies,
    isPathInside,
    featureTools,
    planTools,
    taskTools,
    worktreeTools,
    batchTools,
    contextTools,
    skillTools,
    parallelExecution,
  };
}
