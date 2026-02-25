/**
 * BeadsRepository - High-level repository for bead operations.
 *
 * This repository provides a canonical API for all bead operations,
 * wrapping BeadGateway and BeadsViewerGateway with:
 * - Consistent error handling and normalization
 * - Sync/flush timing policy
 * - Canonical mapping: description vs comments vs labels
 * - Epic resolution with fallback logic
 * - Artifact encoding/decoding using schema module
 *
 * All services SHOULD use this repository for bead operations
 * to ensure consistency across the codebase.
 */

import { BeadGateway, BeadGatewayError } from './BeadGateway.js';
import { BeadsViewerGateway } from './BeadsViewerGateway.js';
import type { BvHealth, RobotPlanResult } from './BeadsViewerGateway.js';
import type { BeadArtifactKind } from './BeadGateway.types.js';
import {
  encodeFeatureState,
  decodeFeatureState,
  encodeTaskState,
  decodeTaskState,
  encodePlanApproval,
  decodePlanApproval,
  encodeApprovedPlan,
  decodeApprovedPlan,
  encodePlanComments,
  decodePlanComments,
  decodeWorkerPrompt,
  decodeTaskReport,
  featureStateFromFeatureJson,
  featureStateToFeatureJson,
  taskStateFromTaskStatus,
  taskStateToTaskStatus,
} from './artifactSchemas.js';
import type { FeatureJson, TaskStatus, PlanComment } from '../../types.js';

// ============================================================================
// Repository Errors
// ============================================================================

/**
 * Normalized error codes for repository operations.
 */
export type RepositoryErrorCode =
  | 'beads_disabled'
  | 'epic_not_found'
  | 'task_not_found'
  | 'sync_failed'
  | 'invalid_artifact'
  | 'gateway_error';

/**
 * Normalized error class for repository operations.
 */
export class RepositoryError extends Error {
  constructor(
    public readonly code: RepositoryErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/**
 * Result type for operations that may fail.
 */
export type Result<T> =
  | { success: true; value: T }
  | { success: false; error: RepositoryError };

// ============================================================================
// Sync Policy
// ============================================================================

/**
 * Sync policy configuration.
 */
export interface SyncPolicy {
  /** Whether to auto-import before read operations */
  autoImport: boolean;
  /** Whether to auto-flush after write operations */
  autoFlush: boolean;
}

/**
 * Default sync policy: balanced between safety and performance.
 */
const DEFAULT_SYNC_POLICY: SyncPolicy = {
  autoImport: false, // Don't auto-import on every read (expensive)
  autoFlush: true, // Always flush after writes for safety
};

// ============================================================================
// Beads Repository
// ============================================================================

/**
 * High-level repository for bead operations.
 *
 * Responsibilities:
 * - Epic resolution with fallback logic
 * - Feature/task state CRUD operations
 * - Plan management (description, approval, comments)
 * - Task artifact operations
 * - Robot plan queries (via BeadsViewerGateway)
 * - Sync policy enforcement
 * - Error normalization
 */
export class BeadsRepository {
  private readonly gateway: BeadGateway;
  private readonly viewerGateway: BeadsViewerGateway;
  private readonly syncPolicy: SyncPolicy;

  // Short-lived memoization cache (cleared on each operation)
  private cache = new Map<string, unknown>();

  constructor(
    projectRoot: string,
    syncPolicy: Partial<SyncPolicy> = {},
    beadsMode: 'on' | 'off' = 'on',
  ) {
    this.syncPolicy = { ...DEFAULT_SYNC_POLICY, ...syncPolicy };
    this.gateway = new BeadGateway(projectRoot);
    this.viewerGateway = new BeadsViewerGateway(projectRoot, beadsMode === 'on');
  }

  // ==========================================================================
  // Sync Policy
  // ==========================================================================

  /**
   * Import bead artifacts from disk (br sync --import-only).
   * Called explicitly when external bead state may have changed.
   */
  importArtifacts(): Result<void> {
    try {
      this.gateway.importArtifacts();
      this.cache.clear();
      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: new RepositoryError('sync_failed', 'Failed to import bead artifacts', error),
      };
    }
  }

  /**
   * Flush bead artifacts to disk (br sync --flush-only).
   * Called after write operations when autoFlush is enabled.
   */
  flushArtifacts(): Result<void> {
    try {
      this.gateway.flushArtifacts();
      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: new RepositoryError('sync_failed', 'Failed to flush bead artifacts', error),
      };
    }
  }

  /**
   * Apply sync policy for read operations.
   */
  private beforeRead(): void {
    if (this.syncPolicy.autoImport) {
      const result = this.importArtifacts();
      if (result.success === false) {
        // Log but don't fail - allow stale reads
        console.warn(`[BeadsRepository] Auto-import failed: ${result.error.message}`);
      }
    }
    this.cache.clear();
  }

  /**
   * Apply sync policy for write operations.
   */
  private afterWrite(): void {
    if (this.syncPolicy.autoFlush) {
      const result = this.flushArtifacts();
      if (result.success === false) {
        // Log but don't fail - data is persisted, just not flushed yet
        console.warn(`[BeadsRepository] Auto-flush failed: ${result.error.message}`);
      }
    }
    this.cache.clear();
  }

  // ==========================================================================
  // Bead Lifecycle
  // ==========================================================================

  /**
   * Create a new epic bead for a feature.
   *
   * @param name - Feature name (used as epic title)
   * @param priority - Feature priority (1-5)
   * @returns Epic bead ID
   */
  createEpic(name: string, priority: number): Result<string> {
    try {
      const epicBeadId = this.gateway.createEpic(name, priority);
      this.afterWrite();
      return { success: true, value: epicBeadId };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Close a bead (used when completing a feature or task).
   *
   * @param beadId - Bead ID to close
   */
  closeBead(beadId: string): Result<void> {
    try {
      this.gateway.closeBead(beadId);
      this.afterWrite();
      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }


  // ==========================================================================
  // Epic Resolution
  // ==========================================================================

  /**
   * Resolve epic bead ID by feature name, with fallback logic.
   *
   * Strategy:
   * 1. List epics from bead gateway
   * 2. Find match by title
   * 3. Return null if not found (for optional variant)
   *
   * @param featureName - Feature name to resolve
   * @param strict - Whether to throw if not found (default: false)
   * @returns Epic bead ID, or null if not found (when strict=false)
   * @throws RepositoryError with code 'epic_not_found' if strict=true and not found
   */
  getEpicByFeatureName(featureName: string, strict: boolean = false): Result<string | null> {
    try {
      this.beforeRead();

      const epics = this.gateway.list({ type: 'epic', status: 'all' });
      const epic = epics.find((entry) => entry.title === featureName);

      if (!epic?.id) {
        if (strict) {
          return {
            success: false,
            error: new RepositoryError(
              'epic_not_found',
              `Epic bead for feature '${featureName}' not found`,
            ),
          };
        }
        return { success: true, value: null };
      }

      return { success: true, value: epic.id };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  // ==========================================================================
  // Feature State Operations
  // ==========================================================================

  /**
   * Get feature state from epic bead artifact.
   *
   * @param epicBeadId - Epic bead ID
   * @returns Feature state artifact, or null if not found
   */
  getFeatureState(epicBeadId: string): Result<FeatureJson | null> {
    try {
      this.beforeRead();

      const raw = this.gateway.readArtifact(epicBeadId, 'feature_state');
      const artifact = decodeFeatureState(raw);

      if (!artifact) {
        return { success: true, value: null };
      }

      const partialFeatureJson = featureStateToFeatureJson(artifact);
      // Convert to full FeatureJson by ensuring required fields
      const featureJson: FeatureJson = {
        name: partialFeatureJson.name,
        epicBeadId: epicBeadId,
        status: partialFeatureJson.status,
        createdAt: partialFeatureJson.createdAt,
        approvedAt: partialFeatureJson.approvedAt,
        completedAt: partialFeatureJson.completedAt,
        workflowPath: partialFeatureJson.workflowPath,
        reviewChecklistVersion: partialFeatureJson.reviewChecklistVersion,
        reviewChecklistCompletedAt: partialFeatureJson.reviewChecklistCompletedAt,
        ticket: partialFeatureJson.ticket,
        sessionId: partialFeatureJson.sessionId,
      };
      // Add epicBeadId since it's not stored in the artifact
      featureJson.epicBeadId = epicBeadId;

      return { success: true, value: featureJson };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Set feature state in epic bead artifact.
   *
   * @param epicBeadId - Epic bead ID
   * @param featureJson - Feature data to store
   */
  setFeatureState(epicBeadId: string, featureJson: FeatureJson): Result<void> {
    try {
      const artifact = featureStateFromFeatureJson(featureJson);
      const encoded = encodeFeatureState(artifact);

      this.gateway.upsertArtifact(epicBeadId, 'feature_state', encoded);
      this.afterWrite();

      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  // ==========================================================================
  // Task State Operations
  // ==========================================================================

  /**
   * Get task state from task bead artifact.
   *
   * @param taskBeadId - Task bead ID
   * @returns Task status, or null if not found
   */
  getTaskState(taskBeadId: string): Result<TaskStatus | null> {
    try {
      this.beforeRead();

      const raw = this.gateway.readArtifact(taskBeadId, 'task_state');
      const artifact = decodeTaskState(raw);

      if (!artifact) {
        return { success: true, value: null };
      }

      const taskStatus = taskStateToTaskStatus(artifact);
      return { success: true, value: taskStatus };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Set task state in task bead artifact.
   *
   * @param taskBeadId - Task bead ID
   * @param taskStatus - Task status to store
   */
  setTaskState(taskBeadId: string, taskStatus: TaskStatus): Result<void> {
    try {
      const artifact = taskStateFromTaskStatus(taskStatus);
      const encoded = encodeTaskState(artifact);

      this.gateway.upsertArtifact(taskBeadId, 'task_state', encoded);
      this.afterWrite();

      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  // ==========================================================================
  // Plan Operations
  // ==========================================================================

  /**
   * Set plan description in epic bead.
   *
   * The plan description is stored as the bead description field,
   * not as an artifact. This is the canonical plan content.
   *
   * @param epicBeadId - Epic bead ID
   * @param content - Plan markdown content
   */
  setPlanDescription(epicBeadId: string, content: string): Result<void> {
    try {
      this.gateway.updateDescription(epicBeadId, content);
      this.afterWrite();

      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Get plan description from epic bead.
   *
   * @param epicBeadId - Epic bead ID
   * @returns Plan content, or null if not found
   */
  getPlanDescription(epicBeadId: string): Result<string | null> {
    try {
      this.beforeRead();

      const content = this.gateway.readDescription(epicBeadId);
      return { success: true, value: content };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Get plan approval artifact.
   *
   * @param epicBeadId - Epic bead ID
   * @returns Plan approval artifact, or null if not approved
   */
  getPlanApproval(epicBeadId: string): Result<{
    hash: string;
    approvedAt: string;
    approvedBySession?: string;
  } | null> {
    try {
      this.beforeRead();

      const raw = this.gateway.readArtifact(epicBeadId, 'plan_approval');
      const artifact = decodePlanApproval(raw);

      if (!artifact) {
        return { success: true, value: null };
      }

      return {
        success: true,
        value: {
          hash: artifact.hash,
          approvedAt: artifact.approvedAt,
          approvedBySession: artifact.approvedBySession,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Set plan approval artifact.
   *
   * @param epicBeadId - Epic bead ID
   * @param hash - SHA-256 hash of approved plan content
   * @param approvedAt - ISO timestamp of approval
   * @param approvedBySession - Optional session ID that approved
   */
  setPlanApproval(
    epicBeadId: string,
    hash: string,
    approvedAt: string,
    approvedBySession?: string,
  ): Result<void> {
    try {
      const artifact = { schemaVersion: 1, hash, approvedAt, approvedBySession } as const;
      const encoded = encodePlanApproval(artifact);

      this.gateway.upsertArtifact(epicBeadId, 'plan_approval', encoded);
      this.afterWrite();

      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Get approved plan snapshot.
   *
   * @param epicBeadId - Epic bead ID
   * @returns Approved plan content, or null if not found
   */
  getApprovedPlan(epicBeadId: string): Result<string | null> {
    try {
      this.beforeRead();

      const raw = this.gateway.readArtifact(epicBeadId, 'approved_plan');
      const artifact = decodeApprovedPlan(raw);

      return artifact
        ? { success: true, value: artifact.content }
        : { success: true, value: null };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Set approved plan snapshot.
   *
   * @param epicBeadId - Epic bead ID
   * @param content - Full plan content to snapshot
   * @param contentHash - SHA-256 hash of the content
   */
  setApprovedPlan(epicBeadId: string, content: string, contentHash: string): Result<void> {
    try {
      const artifact = {
        schemaVersion: 1,
        content,
        snapshotAt: new Date().toISOString(),
        contentHash,
      } as const;
      const encoded = encodeApprovedPlan(artifact);

      this.gateway.upsertArtifact(epicBeadId, 'approved_plan', encoded);
      this.afterWrite();

      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Append a comment to the plan (stored as bead comment).
   *
   * Comments are append-only timeline events.
   *
   * @param epicBeadId - Epic bead ID
   * @param comment - Comment text to append
   */
  appendPlanComment(epicBeadId: string, comment: string): Result<void> {
    try {
      this.gateway.addComment(epicBeadId, comment);
      this.afterWrite();

      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Get plan comments artifact (structured comments).
   *
   * @param epicBeadId - Epic bead ID
   * @returns Plan comments array, or null if not found
   */
  getPlanComments(epicBeadId: string): Result<PlanComment[] | null> {
    try {
      this.beforeRead();

      const raw = this.gateway.readArtifact(epicBeadId, 'plan_comments');
      const artifact = decodePlanComments(raw);

      return artifact
        ? { success: true, value: artifact.comments }
        : { success: true, value: null };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Set plan comments artifact.
   *
   * @param epicBeadId - Epic bead ID
   * @param comments - Plan comments array to store
   */
  setPlanComments(epicBeadId: string, comments: PlanComment[]): Result<void> {
    try {
      const artifact = { schemaVersion: 1, comments };
      const encoded = encodePlanComments(artifact);

      this.gateway.upsertArtifact(epicBeadId, 'plan_comments', encoded);
      this.afterWrite();

      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  // ==========================================================================
  // Task Artifact Operations
  // ==========================================================================

  /**
   * Upsert a task artifact.
   *
   * @param taskBeadId - Task bead ID
   * @param kind - Artifact kind (spec, worker_prompt, report, etc.)
   * @param content - Artifact content
   */
  upsertTaskArtifact(taskBeadId: string, kind: BeadArtifactKind, content: string): Result<void> {
    try {
      this.gateway.upsertArtifact(taskBeadId, kind, content);
      this.afterWrite();

      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Read a task artifact.
   *
   * @param taskBeadId - Task bead ID
   * @param kind - Artifact kind to read
   * @returns Artifact content, or null if not found
   */
  readTaskArtifact(taskBeadId: string, kind: BeadArtifactKind): Result<string | null> {
    try {
      this.beforeRead();

      const raw = this.gateway.readArtifact(taskBeadId, kind);

      // Decode specific artifacts that have schemas
      if (kind === 'worker_prompt') {
        const artifact = decodeWorkerPrompt(raw);
        return artifact
          ? { success: true, value: artifact.content }
          : { success: true, value: null };
      }

      if (kind === 'report') {
        const artifact = decodeTaskReport(raw);
        return artifact
          ? { success: true, value: artifact.content }
          : { success: true, value: null };
      }

      // Other artifacts returned as-is
      return { success: true, value: raw };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  // ==========================================================================
  // Task Bead Listing
  // ==========================================================================

  /**
   * List all task beads for an epic.
   *
   * @param epicBeadId - Epic bead ID
   * @returns Array of task bead info
   */
  listTaskBeadsForEpic(epicBeadId: string): Result<
    Array<{ id: string; title: string; status: string }>
  > {
    try {
      this.beforeRead();

      const tasks = this.gateway.list({ type: 'task', parent: epicBeadId });
      return { success: true, value: tasks };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  // ==========================================================================
  // Workflow Labels
  // ==========================================================================

  /**
   * Add a workflow label to a bead.
   *
   * Labels are used for narrow state markers only:
   * - 'approved' - Plan is approved
   * - 'blocked' - Feature/task is blocked
   * - 'in_progress' - Work is in progress
   *
   * @param beadId - Bead ID
   * @param label - Label to add
   */
  addWorkflowLabel(beadId: string, label: string): Result<void> {
    try {
      this.gateway.addLabel(beadId, label);
      this.afterWrite();

      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  // ==========================================================================
  // Robot Plan (via BeadsViewerGateway)
  // ==========================================================================

  /**
   * Get robot plan with parallel execution tracks.
   *
   * Delegates to BeadsViewerGateway for bv --robot-plan output.
   *
   * @returns Robot plan result, or null if unavailable
   */
  getRobotPlan(): RobotPlanResult | null {
    return this.viewerGateway.getRobotPlan();
  }

  /**
   * Get health status of the BeadsViewerGateway.
   *
   * @returns Health status
   */
  getViewerHealth(): BvHealth {
    return this.viewerGateway.getHealth();
  }

  // ==========================================================================
  // Direct Gateway Access (for advanced use cases)
  // ==========================================================================

  /**
   * Get direct access to the underlying BeadGateway.
   * Use sparingly - prefer repository methods when possible.
   */
  getGateway(): BeadGateway {
    return this.gateway;
  }

  /**
   * Get direct access to the underlying BeadsViewerGateway.
   * Use sparingly - prefer repository methods when possible.
   */
  getViewerGateway(): BeadsViewerGateway {
    return this.viewerGateway;
  }

  // ==========================================================================
  // Error Normalization
  // ==========================================================================

  /**
   * Normalize errors to RepositoryError format.
   */
  private normalizeError(error: unknown): RepositoryError {
    if (error instanceof RepositoryError) {
      return error;
    }

    if (error instanceof BeadGatewayError) {
      return new RepositoryError(
        'gateway_error',
        `Bead gateway error: ${error.message}`,
        error,
      );
    }

    if (error instanceof Error) {
      return new RepositoryError(
        'gateway_error',
        `Bead gateway error: ${error.message}`,
        error,
      );
    }

    return new RepositoryError(
      'gateway_error',
      String(error),
    );
  }
}