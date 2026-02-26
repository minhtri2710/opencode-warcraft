/**
 * Storage port interfaces for warcraft-core services.
 *
 * These abstract the mode-specific (beads vs filesystem) storage
 * behind clean contracts, eliminating isBeadsEnabled branching
 * from domain services.
 */

import type {
  FeatureJson,
  FeatureStatusType,
  TaskStatus,
  TaskInfo,
  PlanComment,
} from '../../types.js';
import type { LockOptions } from '../../utils/json-lock.js';
import type { RunnableTasksResult } from '../taskService.js';
import type { BackgroundPatchFields } from '../taskService.js';

// ============================================================================
// Feature Store
// ============================================================================

/** Input for creating a new feature (before epicBeadId is assigned). */
export interface CreateFeatureInput {
  name: string;
  ticket?: string;
  status: FeatureStatusType;
  createdAt: string;
}

/**
 * FeatureStore abstracts feature state persistence.
 *
 * - BeadsFeatureStore: creates epic beads, writes cache + artifacts
 * - FilesystemFeatureStore: writes local JSON + directories
 */
export interface FeatureStore {
  /** Check if a feature already exists. */
  exists(name: string): boolean;

  /**
   * Create a new feature with all necessary storage (dirs, state, bead epic).
   * Returns the full FeatureJson with epicBeadId assigned.
   */
  create(input: CreateFeatureInput, priority: number): FeatureJson;

  /** Get feature by name. Returns null if not found. */
  get(name: string): FeatureJson | null;

  /** List all feature names (sorted). */
  list(): string[];

  /** Persist updated feature state (atomic write). */
  save(feature: FeatureJson): void;

  /** Complete a feature (save + close bead if applicable). */
  complete(feature: FeatureJson): void;
}

// ============================================================================
// Task Store
// ============================================================================

/** Artifact kinds supported by task storage. */
export type TaskArtifactKind = 'spec' | 'worker_prompt' | 'report';

/** Options for task save operations. */
export interface TaskSaveOptions {
  /** Whether to sync bead status after saving (beads mode only). */
  syncBeadStatus?: boolean;
}

/**
 * TaskStore abstracts task state persistence and artifact management.
 *
 * - BeadsTaskStore: creates task beads, reads/writes artifacts, supports robot plan
 * - FilesystemTaskStore: manages local task directories and status.json files
 */
export interface TaskStore {
  /**
   * Create a new task. Handles bead creation, directory creation, and initial state.
   * Returns the TaskStatus with beadId set (if applicable).
   */
  createTask(
    featureName: string,
    folder: string,
    title: string,
    status: TaskStatus,
    priority: number,
  ): TaskStatus;

  /** Get task info by folder name. Returns null if not found. */
  get(featureName: string, folder: string): TaskInfo | null;

  /** Get full TaskStatus for a task (includes all fields). */
  getRawStatus(featureName: string, folder: string): TaskStatus | null;

  /** List all tasks for a feature (sorted by folder order). */
  list(featureName: string): TaskInfo[];

  /** Determine next task order number. */
  getNextOrder(featureName: string): number;

  /**
   * Save updated task status.
   * @param options.syncBeadStatus - If true, sync the status to the bead system.
   */
  save(
    featureName: string,
    folder: string,
    status: TaskStatus,
    options?: TaskSaveOptions,
  ): void;

  /**
   * Patch background-owned fields atomically without clobbering completion fields.
   * Safe for concurrent use by background workers.
   */
  patchBackground(
    featureName: string,
    folder: string,
    patch: BackgroundPatchFields,
    lockOptions?: LockOptions,
  ): TaskStatus;

  /** Delete a task (remove directory/artifacts). */
  delete(featureName: string, folder: string): void;

  /** Write a task artifact (spec, worker_prompt, report). Returns an identifier (beadId or path). */
  writeArtifact(
    featureName: string,
    folder: string,
    kind: TaskArtifactKind,
    content: string,
  ): string;

  /** Read a task artifact. Returns null if not found. */
  readArtifact(
    featureName: string,
    folder: string,
    kind: TaskArtifactKind,
  ): string | null;

  /** Write a task report. Returns a path or identifier. */
  writeReport(featureName: string, folder: string, report: string): string;

  /**
   * Get runnable tasks using store-specific strategies.
   * Returns null if the store doesn't support advanced scheduling (filesystem fallback used).
   */
  getRunnableTasks(featureName: string): RunnableTasksResult | null;

  /** Ensure pending writes are flushed to persistent storage. No-op for filesystem. */
  flush(): void;
}

// ============================================================================
// Plan Store
// ============================================================================

/**
 * PlanStore abstracts plan approval state and comment persistence.
 *
 * Plan file reading/writing is always filesystem-based (both modes write plan.md).
 * This interface covers the mode-specific approval/comment storage.
 *
 * - BeadsPlanStore: stores approval in bead artifacts, comments in bead artifacts
 * - FilesystemPlanStore: stores approval in feature.json, comments in feature.json
 */
export interface PlanStore {
  /**
   * Store plan approval.
   * @param featureName - Feature name
   * @param planContent - Full plan content (for snapshot)
   * @param planHash - SHA-256 hash of plan content
   * @param timestamp - ISO timestamp of approval
   * @param sessionId - Optional session that approved
   */
  approve(
    featureName: string,
    planContent: string,
    planHash: string,
    timestamp: string,
    sessionId?: string,
  ): void;

  /**
   * Check if the plan is currently approved.
   * Compares stored hash against the current plan content hash.
   */
  isApproved(featureName: string, currentPlanHash: string): boolean;

  /** Revoke plan approval (e.g., when plan content changes). */
  revokeApproval(featureName: string): void;

  /** Get structured plan comments. */
  getComments(featureName: string): PlanComment[];

  /** Replace all plan comments. */
  setComments(featureName: string, comments: PlanComment[]): void;

  /** Sync plan content to external store (bead description). No-op for filesystem. */
  syncPlanDescription(featureName: string, content: string): void;

  /** Sync a plan comment to external store. No-op for filesystem. */
  syncPlanComment(featureName: string, comment: PlanComment): void;
}

// ============================================================================
// Factory
// ============================================================================

/** Bundle of all stores for dependency injection. */
export interface StoreSet {
  featureStore: FeatureStore;
  taskStore: TaskStore;
  planStore: PlanStore;
}
