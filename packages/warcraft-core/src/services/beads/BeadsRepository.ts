/**
 * BeadsRepository - High-level repository for bead operations.
 *
 * This repository provides a canonical API for all bead operations,
 * wrapping BeadGateway and BeadsViewerGateway with:
 * - Consistent error handling and normalization
 * - Sync/flush timing policy
 * - Canonical mapping: description vs labels
 * - Epic resolution with fallback logic
 * - Artifact encoding/decoding using schema module
 *
 * All services SHOULD use this repository for bead operations
 * to ensure consistency across the codebase.
 */

import type { TaskStatus, TaskStatusType } from '../../types.js';
import {
  decodeTaskReport,
  decodeTaskState,
  decodeWorkerPrompt,
  encodeTaskState,
  taskStateFromTaskStatus,
  taskStateToTaskStatus,
} from './artifactSchemas.js';
import { BeadGateway, BeadGatewayError } from './BeadGateway.js';
import type { AuditEntry, AuditRecordParams, BeadArtifactKind, BeadComment } from './BeadGateway.types.js';
import type { RobotInsightsResult, RobotPlanResult } from './BeadsViewerGateway.js';
import { BeadsViewerGateway } from './BeadsViewerGateway.js';
import type { BvHealth } from './bv-runner.js';

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
export type Result<T> = { success: true; value: T } | { success: false; error: RepositoryError };

const INTERNAL_GATEWAY_CODE_PATTERN = /\[(BR_[A-Z_]+)\]/;
const INIT_FAILURE_INTERNAL_CODES = new Set(['BR_INIT_FAILED', 'BR_NOT_INITIALIZED']);

export function getRepositoryInternalCode(error: unknown): string | null {
  if (error instanceof BeadGatewayError) {
    return error.internalCode ?? extractInternalCodeFromMessage(error.message);
  }

  if (error instanceof RepositoryError) {
    return getRepositoryInternalCode(error.cause) ?? extractInternalCodeFromMessage(error.message);
  }

  if (error instanceof Error) {
    return extractInternalCodeFromMessage(error.message);
  }

  return null;
}

export function isRepositoryInitFailure(error: unknown): boolean {
  const internalCode = getRepositoryInternalCode(error);
  return internalCode !== null && INIT_FAILURE_INTERNAL_CODES.has(internalCode);
}

export function throwIfInitFailure(error: unknown, context: string): void {
  if (!isRepositoryInitFailure(error)) {
    return;
  }
  const reason = error instanceof Error ? error.message : String(error);
  throw new Error(`${context}: ${reason}`);
}

function extractInternalCodeFromMessage(message: string): string | null {
  const matched = message.match(INTERNAL_GATEWAY_CODE_PATTERN);
  return matched ? matched[1] : null;
}

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
 * - Plan management (description, labels)
 * - Task artifact operations
 * - Robot plan and insights queries (via BeadsViewerGateway)
 * - Sync policy enforcement
 * - Error normalization
 */
export class BeadsRepository {
  private readonly gateway: BeadGateway;
  private readonly viewerGateway: BeadsViewerGateway;
  private readonly syncPolicy: SyncPolicy;

  // Epic ID resolution cache: featureName -> epicBeadId.
  // Populated by createEpic() so that getEpicByFeatureName() can resolve
  // the epic in O(1) without an expensive `br list --type epic --status all`
  // CLI call. Cleared on importArtifacts() since external state may have changed.
  private epicIdCache = new Map<string, string>();

  constructor(projectRoot: string, syncPolicy: Partial<SyncPolicy> = {}, beadsMode: 'on' | 'off' = 'on') {
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
      this.epicIdCache.clear();
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
  }

  /**
   * Apply sync policy for write operations.
   */
  private afterWrite(): void {
    if (this.syncPolicy.autoFlush) {
      const result = this.flushArtifacts();
      if (result.success === false) {
        console.warn(`[BeadsRepository] Auto-flush failed: ${result.error.message}`);
      }
    }
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
      this.epicIdCache.set(name, epicBeadId);
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

  /**
   * Reopen a closed bead.
   *
   * @param beadId - Bead ID to reopen
   */
  reopenBead(beadId: string): Result<void> {
    try {
      this.gateway.reopenBead(beadId);
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
   * Create a new task bead under an epic.
   *
   * @param title - Task title
   * @param epicBeadId - Parent epic bead ID
   * @param priority - Task priority (1-5)
   * @returns Task bead ID
   */
  createTask(title: string, epicBeadId: string, priority: number): Result<string> {
    try {
      const taskBeadId = this.gateway.createTask(title, epicBeadId, priority);
      this.afterWrite();
      return { success: true, value: taskBeadId };
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
   * Resolution strategy (ordered by cost):
   * 1. Check in-memory cache (O(1)) — populated by createEpic() for same-session epics
   * 2. Fall back to gateway.list() (O(n) CLI call) — for epics created in prior sessions
   *
   * @param featureName - Feature name to resolve
   * @param strict - Whether to throw if not found (default: false)
   * @returns Epic bead ID, or null if not found (when strict=false)
   * @throws RepositoryError with code 'epic_not_found' if strict=true and not found
   */
  getEpicByFeatureName(featureName: string, strict: boolean = false): Result<string | null> {
    try {
      // Fast path: check in-memory cache first (avoids O(n) CLI call)
      const cached = this.epicIdCache.get(featureName);
      if (cached) {
        return { success: true, value: cached };
      }

      // Slow path: list all epics via CLI
      this.beforeRead();

      const epics = this.gateway.list({ type: 'epic', status: 'all' });
      const epic = epics.find((entry) => entry.title === featureName);

      if (!epic?.id) {
        if (strict) {
          return {
            success: false,
            error: new RepositoryError('epic_not_found', `Epic bead for feature '${featureName}' not found`),
          };
        }
        return { success: true, value: null };
      }

      // Warm the cache for subsequent lookups
      this.epicIdCache.set(featureName, epic.id);

      return { success: true, value: epic.id };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  // ==========================================================================
  // Task Lifecycle
  // ==========================================================================

  /**
   * Sync a task bead's status label.
   *
   * @param beadId - Task bead ID
   * @param status - New task status
   */
  syncTaskStatus(beadId: string, status: TaskStatusType): Result<void> {
    try {
      this.gateway.syncTaskStatus(beadId, status);
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
  // Dependency Operations
  // ==========================================================================

  /**
   * List dependency edges for a task bead.
   *
   * @param beadId - Task bead ID
   * @returns Array of dependency targets
   */
  listDependencies(beadId: string): Result<Array<{ id: string; title: string; status: string }>> {
    try {
      this.beforeRead();
      const deps = this.gateway.listDependencies(beadId);
      return { success: true, value: deps };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Add a dependency edge between two task beads.
   *
   * @param beadId - Task bead ID
   * @param dependsOnBeadId - Bead ID of the dependency target
   */
  addDependency(beadId: string, dependsOnBeadId: string): Result<void> {
    try {
      this.gateway.addDependency(beadId, dependsOnBeadId);
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
   * Remove a dependency edge between two task beads.
   *
   * @param beadId - Task bead ID
   * @param dependsOnBeadId - Bead ID of the dependency target to remove
   */
  removeDependency(beadId: string, dependsOnBeadId: string): Result<void> {
    try {
      this.gateway.removeDependency(beadId, dependsOnBeadId);
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
      if (raw === null) {
        return { success: true, value: null };
      }

      const artifact = decodeTaskState(raw);

      if (!artifact) {
        try {
          const parsed = JSON.parse(raw) as { schemaVersion?: unknown };
          if (parsed && typeof parsed === 'object' && 'schemaVersion' in parsed) {
            throw new Error(`Unsupported task_state schema version '${String(parsed.schemaVersion)}'`);
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Unsupported task_state schema version')) {
            throw error;
          }
        }
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
   * Get comments from a bead (stored as bead comments).
   *
   * @param beadId - Bead ID
   * @returns Array of bead comments
   */
  getComments(beadId: string): Result<BeadComment[]> {
    try {
      this.beforeRead();

      const comments = this.gateway.listComments(beadId);
      return { success: true, value: comments };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  /**
   * Append a comment to a bead (stored as bead comment).
   *
   * Comments are append-only timeline events.
   *
   * @param beadId - Bead ID
   * @param body - Comment body to append
   */
  appendComment(beadId: string, body: string): Result<void> {
    try {
      this.gateway.addComment(beadId, body);
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
  // Audit Operations (sidecar — must NEVER block callers)
  // ==========================================================================

  /**
   * Record an audit event for agent interaction logging.
   *
   * This is a sidecar operation: failures are logged but never propagated
   * to callers. All call sites MUST use this method (not gateway.auditRecord
   * directly) to ensure the non-blocking guarantee.
   *
   * @param beadId - Bead ID the event relates to
   * @param event - Audit event parameters
   */
  recordAuditEvent(beadId: string, event: AuditRecordParams): void {
    try {
      this.gateway.auditRecord({ ...event, issueId: beadId });
    } catch (error) {
      console.warn(
        `[BeadsRepository] Audit record failed (non-blocking): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Retrieve the audit log for a bead.
   *
   * This is a sidecar operation: failures return an empty array and are
   * logged but never propagated to callers.
   *
   * @param beadId - Bead ID to retrieve audit log for
   * @returns Array of audit entries, or empty array on failure
   */
  getAuditLog(beadId: string): AuditEntry[] {
    try {
      return this.gateway.auditLog(beadId);
    } catch (error) {
      console.warn(
        `[BeadsRepository] Audit log retrieval failed (non-blocking): ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  // ==========================================================================
  // Bead Display Operations
  // ==========================================================================

  /**
   * Get bead in toon format (token-optimized, LLM-friendly).
   *
   * Returns the raw toon-format string without parsing.
   * On failure, falls back to existing JSON `show()` with a warning.
   *
   * @param beadId - Bead ID to show
   * @returns Raw toon-format string, or JSON stringified show() fallback
   */
  getBeadToon(beadId: string): Result<string> {
    try {
      this.beforeRead();
      const toonOutput = this.gateway.showToon(beadId);
      return { success: true, value: toonOutput };
    } catch {
      console.warn(`[BeadsRepository] toon format failed for bead '${beadId}', falling back to JSON show()`);
      try {
        const jsonOutput = this.gateway.show(beadId);
        return { success: true, value: JSON.stringify(jsonOutput) };
      } catch (fallbackError) {
        return {
          success: false,
          error: this.normalizeError(fallbackError),
        };
      }
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
        return artifact ? { success: true, value: artifact.content } : { success: true, value: null };
      }

      if (kind === 'report') {
        const artifact = decodeTaskReport(raw);
        return artifact ? { success: true, value: artifact.content } : { success: true, value: null };
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
  listTaskBeadsForEpic(epicBeadId: string): Result<Array<{ id: string; title: string; status: string }>> {
    try {
      this.beforeRead();

      const tasks = this.gateway.list({ type: 'task', parent: epicBeadId, status: 'all' });
      return { success: true, value: tasks };
    } catch (error) {
      return {
        success: false,
        error: this.normalizeError(error),
      };
    }
  }

  listEpics(status?: 'open' | 'closed' | 'all'): Result<Array<{ id: string; title: string; status: string }>> {
    try {
      this.beforeRead();
      const epics = this.gateway.list({ type: 'epic', status: status ?? 'all' });
      return { success: true, value: epics };
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

  /**
   * Remove a workflow label from a bead.
   *
   * Best-effort: swallows errors if the label doesn't exist.
   *
   * @param beadId - Bead ID
   * @param label - Label to remove
   */
  removeWorkflowLabel(beadId: string, label: string): Result<void> {
    try {
      this.gateway.removeLabel(beadId, label);
      this.afterWrite();

      return { success: true, value: undefined };
    } catch {
      // Best-effort: swallow errors (label may not exist)
      return { success: true, value: undefined };
    }
  }

  /**
   * Check if a bead has a specific workflow label.
   *
   * @param beadId - Bead ID
   * @param label - Label to check for
   * @returns true if the bead has the label, false otherwise
   */
  hasWorkflowLabel(beadId: string, label: string): Result<boolean> {
    try {
      this.beforeRead();

      const payload = this.gateway.show(beadId);
      if (
        payload !== null &&
        typeof payload === 'object' &&
        'labels' in payload &&
        Array.isArray((payload as Record<string, unknown>).labels)
      ) {
        const labels = (payload as Record<string, unknown>).labels as string[];
        return { success: true, value: labels.includes(label) };
      }

      return { success: true, value: false };
    } catch {
      // If show fails, treat as no label
      return { success: true, value: false };
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
   * Get robot insights with graph health diagnostics.
   *
   * Delegates to BeadsViewerGateway for bv --robot-insights output.
   *
   * @returns Robot insights result, or null if unavailable
   */
  getRobotInsights(): RobotInsightsResult | null {
    return this.viewerGateway.getRobotInsights();
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
      const internalCode = getRepositoryInternalCode(error);
      const codePrefix = internalCode ? `[${internalCode}] ` : '';
      const details =
        internalCode && error.message.includes(`[${internalCode}]`) ? error.message : `${codePrefix}${error.message}`;
      return new RepositoryError('gateway_error', `Bead gateway error: ${details}`, error);
    }

    if (error instanceof Error) {
      const internalCode = getRepositoryInternalCode(error);
      const codePrefix = internalCode ? `[${internalCode}] ` : '';
      return new RepositoryError('gateway_error', `Bead gateway error: ${codePrefix}${error.message}`, error);
    }

    return new RepositoryError('gateway_error', String(error));
  }
}
