import * as path from 'path';
import {
  AgentsMdService,
  BeadsRepository,
  BvTriageService,
  type ConfigService,
  ContextService,
  computeTrustMetrics,
  createEventLogger,
  createStores,
  createWorktreeService,
  detectContext,
  type EventLogger,
  FeatureService,
  getFeaturePath,
  PlanService,
  TaskService,
  type WorktreeService,
} from 'warcraft-core';
import { COMPLETION_GATES, hasCompletionGateEvidence, isPathInside, validateTaskStatus } from './guards.js';
import { createBuiltinMcps } from './mcp/index.js';
import { createCheckBlocked } from './services/blocked-check.js';
import { createCheckDependencies } from './services/dependency-check.js';
import { createResolveFeature } from './services/feature-resolution.js';
import { createCaptureSession, createUpdateFeatureMetadata } from './services/session-capture.js';
import { getFilteredSkills } from './skills/builtin.js';
import {
  BatchTools,
  ContextTools,
  DoctorTools,
  FeatureTools,
  PlanTools,
  SkillTools,
  TaskTools,
  WorktreeTools,
} from './tools/index.js';
import type { BlockedResult } from './types.js';

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
  eventLogger: EventLogger;
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
  doctorTools: DoctorTools;
  skillTools: SkillTools;
  parallelExecution?: { strategy?: 'unbounded' | 'bounded'; maxConcurrency?: number };
}

export function createWarcraftContainer(directory: string, configService: ConfigService): WarcraftContainer {
  const beadsMode = configService.getBeadsMode();
  const repository = new BeadsRepository(directory, {}, beadsMode);
  const stores = createStores(directory, beadsMode, repository);
  const planService = new PlanService(directory, stores.planStore, beadsMode);
  const taskService = new TaskService(directory, stores.taskStore, beadsMode, {
    strictTaskTransitions: true,
  });
  const featureService = new FeatureService(directory, stores.featureStore, beadsMode, taskService);
  const contextService = new ContextService(directory, configService);
  const agentsMdService = new AgentsMdService(directory, contextService);
  const disabledMcps = configService.getDisabledMcps();
  const disabledSkills = configService.getDisabledSkills();
  const builtinMcps = createBuiltinMcps(disabledMcps);
  const filteredSkills = getFilteredSkills(disabledSkills);
  const worktreeService = createWorktreeService(directory, beadsMode);
  const eventLogger = createEventLogger(directory);

  // Initialize BV Triage Service with explicit state ownership
  const bvTriageService = new BvTriageService(directory, beadsMode !== 'off');
  const parallelExecution = (
    configService.get() as {
      parallelExecution?: { strategy?: 'unbounded' | 'bounded'; maxConcurrency?: number };
    }
  ).parallelExecution;

  // --- Extracted business logic (wired via factory functions) ---

  const resolveFeature = createResolveFeature(directory, featureService, detectContext);
  const captureSession = createCaptureSession(featureService);
  const updateFeatureMetadata = createUpdateFeatureMetadata(featureService);
  const checkBlocked = createCheckBlocked((feature: string) =>
    getFeaturePath(directory, feature, configService.getBeadsMode()),
  );
  const checkDependencies = createCheckDependencies(taskService, bvTriageService);

  // --- Tool modules ---

  const lockDir = path.join(directory, '.beads', '.locks');

  /** Lazy getter for feature reopen rate from trust metrics. Computed at dispatch time, not container creation. */
  const getFeatureReopenRate = (): number => {
    try {
      const metrics = computeTrustMetrics(directory);
      return metrics.reopenRate;
    } catch {
      return 0;
    }
  };

  const featureTools = new FeatureTools({ featureService });
  const planTools = new PlanTools({
    featureService,
    planService,
    captureSession,
    updateFeatureMetadata,
    workflowGatesMode: configService.getWorkflowGatesMode(),
  });
  const taskTools = new TaskTools({
    featureService,
    planService,
    taskService,
    workflowGatesMode: configService.getWorkflowGatesMode(),
    validateTaskStatus,
    eventLogger,
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
    workflowGatesMode: configService.getWorkflowGatesMode(),
    verificationModel: configService.getVerificationModel(),
    structuredVerificationMode: configService.getStructuredVerificationMode(),
    getFeatureReopenRate,
    eventLogger,
    lockDir,
    projectDir: directory,
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
    verificationModel: configService.getVerificationModel(),
    getFeatureReopenRate,
    lockDir,
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
    projectRoot: directory,
  });
  const skillTools = new SkillTools({ filteredSkills });
  const doctorTools = new DoctorTools({
    featureService,
    taskService,
    worktreeService,
    checkBlocked,
  });

  return {
    featureService,
    planService,
    taskService,
    worktreeService,
    contextService,
    agentsMdService,
    configService,
    bvTriageService,
    eventLogger,
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
    doctorTools,
    skillTools,
    parallelExecution,
  };
}
