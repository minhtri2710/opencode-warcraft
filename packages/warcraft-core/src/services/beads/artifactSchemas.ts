/**
 * Canonical bead artifact schema module.
 *
 * This module provides:
 * - Strict type definitions for all artifact payloads stored in beads
 * - Encode/decode helpers with validation
 * - Versioned payloads for forward compatibility
 * - Migration shims for legacy payloads
 *
 * All bead metadata writes MUST use these schemas to ensure consistency.
 */

import type { FeatureJson, TaskStatus, PlanComment } from '../../types.js';

// ============================================================================
// Schema Versioning
// ============================================================================

/**
 * Current schema version for all artifacts.
 * Increment this when breaking changes are introduced to artifact structures.
 */
export const CURRENT_SCHEMA_VERSION = 1 as const;

/**
 * Base interface for versioned artifacts.
 */
export interface VersionedArtifact {
  /** Schema version for forward compatibility */
  schemaVersion: number;
}

// ============================================================================
// Feature State Artifact
// ============================================================================

/**
 * Feature state artifact payload.
 * Stored as 'feature_state' artifact in epic beads.
 */
export interface FeatureStateArtifact extends VersionedArtifact {
  /** Feature name */
  name: string;
  /** Current feature status */
  status: 'planning' | 'approved' | 'executing' | 'completed';
  /** ISO timestamp when feature was created */
  createdAt: string;
  /** ISO timestamp when feature was approved (optional) */
  approvedAt?: string;
  /** ISO timestamp when feature was completed (optional) */
  completedAt?: string;
  /** Workflow path: standard or lightweight */
  workflowPath?: 'standard' | 'lightweight';
  /** External ticket reference (optional) */
  ticket?: string;
  /** Session ID that created this feature (optional) */
  sessionId?: string;
}

/**
 * Legacy feature state artifact (pre-schema-versioning).
 * Used for migration.
 */
interface LegacyFeatureState {
  name: string;
  status: string;
  createdAt?: string;
  approvedAt?: string;
  completedAt?: string;
}

/**
 * Encode a feature state artifact to JSON string.
 */
export function encodeFeatureState(artifact: FeatureStateArtifact): string {
  return JSON.stringify(artifact);
}

/**
 * Decode a feature state artifact from JSON string.
 * Handles both current and legacy formats.
 */
export function decodeFeatureState(raw: string | null): FeatureStateArtifact | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    // If already has schemaVersion, validate and return
    if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
      const artifact = parsed as FeatureStateArtifact;
      if (artifact.schemaVersion === CURRENT_SCHEMA_VERSION) {
        return artifact;
      }
      // Future: handle schema migration here
      return null;
    }

    // Legacy migration path
    const legacy = parsed as LegacyFeatureState;
    if (legacy.name && legacy.status) {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        name: legacy.name,
        status: validateFeatureStatus(legacy.status),
        createdAt: legacy.createdAt || new Date().toISOString(),
        approvedAt: legacy.approvedAt,
        completedAt: legacy.completedAt,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validate and normalize feature status.
 */
function validateFeatureStatus(status: string): FeatureStateArtifact['status'] {
  const valid = ['planning', 'approved', 'executing', 'completed'];
  if (valid.includes(status)) {
    return status as FeatureStateArtifact['status'];
  }
  return 'planning'; // Default fallback
}

/**
 * Create a FeatureStateArtifact from a FeatureJson object.
 */
export function featureStateFromFeatureJson(featureJson: FeatureJson): FeatureStateArtifact {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: featureJson.name,
    status: featureJson.status,
    createdAt: featureJson.createdAt,
    approvedAt: featureJson.approvedAt,
    completedAt: featureJson.completedAt,
    workflowPath: featureJson.workflowPath,
    ticket: featureJson.ticket,
    sessionId: featureJson.sessionId,
  };
}

/**
 * Convert a FeatureStateArtifact to a partial FeatureJson for merging.
 */
export function featureStateToFeatureJson(artifact: FeatureStateArtifact): Partial<FeatureJson> {
  return {
    name: artifact.name,
    status: artifact.status,
    createdAt: artifact.createdAt,
    approvedAt: artifact.approvedAt,
    completedAt: artifact.completedAt,
    workflowPath: artifact.workflowPath,
    ticket: artifact.ticket,
    sessionId: artifact.sessionId,
  };
}

// ============================================================================
// Task State Artifact
// ============================================================================

/**
 * Task state artifact payload.
 * Stored as 'task_state' artifact in task beads.
 */
export interface TaskStateArtifact extends VersionedArtifact {
  /** Current task status */
  status: 'pending' | 'in_progress' | 'done' | 'cancelled' | 'blocked' | 'failed' | 'partial';
  /** Task origin: plan or manual */
  origin: 'plan' | 'manual';
  /** Plan section title (optional) */
  planTitle?: string;
  /** Task summary (optional) */
  summary?: string;
  /** ISO timestamp when task was started (optional) */
  startedAt?: string;
  /** ISO timestamp when task was completed (optional) */
  completedAt?: string;
  /** Base commit for worktree (optional) */
  baseCommit?: string;
  /** Idempotency key for safe retries (optional) */
  idempotencyKey?: string;
  /** Worker session info for background execution (optional) */
  workerSession?: {
    /** Background task ID from OMO-Slim */
    taskId?: string;
    /** Unique session identifier */
    sessionId: string;
    /** Worker instance identifier */
    workerId?: string;
    /** Agent type handling this task */
    agent?: string;
    /** Execution mode: inline or delegate */
    mode?: 'inline' | 'delegate';
    /** ISO timestamp of last heartbeat */
    lastHeartbeatAt?: string;
    /** Current attempt number (1-based) */
    attempt?: number;
    /** Number of messages exchanged in session */
    messageCount?: number;
  };
  /** Child bead ID for this task (optional) */
  beadId?: string;
  /** Task dependencies expressed as task folder names */
  dependsOn?: string[];
  /** Blocker details when status is 'blocked' (optional) */
  blocker?: {
    reason: string;
    detail?: string;
  };
}

/**
 * Legacy task state artifact (pre-schema-versioning).
 * Used for migration.
 */
interface LegacyTaskState {
  status?: string;
  origin?: string;
  planTitle?: string;
  summary?: string;
  startedAt?: string;
  completedAt?: string;
  baseCommit?: string;
  idempotencyKey?: string;
  workerSession?: unknown;
  beadId?: string;
  dependsOn?: string[];
  blocker?: unknown;
}

/**
 * Encode a task state artifact to JSON string.
 */
export function encodeTaskState(artifact: TaskStateArtifact): string {
  return JSON.stringify(artifact);
}

/**
 * Decode a task state artifact from JSON string.
 * Handles both current and legacy formats.
 */
export function decodeTaskState(raw: string | null): TaskStateArtifact | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    // If already has schemaVersion, validate and return
    if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
      const artifact = parsed as TaskStateArtifact;
      if (artifact.schemaVersion === CURRENT_SCHEMA_VERSION) {
        return artifact;
      }
      // Future: handle schema migration here
      return null;
    }

    // Legacy migration path - directly from TaskStatus
    const legacy = parsed as TaskStatus | LegacyTaskState;
    return {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      status: (legacy.status || 'pending') as TaskStateArtifact['status'],
      origin: (legacy.origin || 'plan') as TaskStateArtifact['origin'],
      planTitle: legacy.planTitle,
      summary: legacy.summary,
      startedAt: legacy.startedAt,
      completedAt: legacy.completedAt,
      baseCommit: legacy.baseCommit,
      idempotencyKey: legacy.idempotencyKey,
      workerSession: legacy.workerSession as TaskStateArtifact['workerSession'],
      beadId: legacy.beadId,
      dependsOn: legacy.dependsOn,
      blocker: legacy.blocker as TaskStateArtifact['blocker'],
    };
  } catch {
    return null;
  }
}

/**
 * Create a TaskStateArtifact from a TaskStatus object.
 */
export function taskStateFromTaskStatus(taskStatus: TaskStatus): TaskStateArtifact {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    status: taskStatus.status,
    origin: taskStatus.origin,
    planTitle: taskStatus.planTitle,
    summary: taskStatus.summary,
    startedAt: taskStatus.startedAt,
    completedAt: taskStatus.completedAt,
    baseCommit: taskStatus.baseCommit,
    idempotencyKey: taskStatus.idempotencyKey,
    workerSession: taskStatus.workerSession,
    beadId: taskStatus.beadId,
    dependsOn: taskStatus.dependsOn,
    blocker: taskStatus.blocker,
  };
}

/**
 * Convert a TaskStateArtifact to a TaskStatus for merging.
 */
export function taskStateToTaskStatus(artifact: TaskStateArtifact): TaskStatus {
  return {
    schemaVersion: artifact.schemaVersion,
    status: artifact.status,
    origin: artifact.origin,
    planTitle: artifact.planTitle,
    summary: artifact.summary,
    startedAt: artifact.startedAt,
    completedAt: artifact.completedAt,
    baseCommit: artifact.baseCommit,
    idempotencyKey: artifact.idempotencyKey,
    workerSession: artifact.workerSession,
    beadId: artifact.beadId,
    dependsOn: artifact.dependsOn,
    blocker: artifact.blocker,
  };
}

// ============================================================================
// Plan Approval Artifact
// ============================================================================

/**
 * Plan approval artifact payload.
 * Stored as 'plan_approval' artifact in epic beads.
 */
export interface PlanApprovalArtifact extends VersionedArtifact {
  /** SHA-256 hash of the approved plan content */
  hash: string;
  /** ISO timestamp when plan was approved */
  approvedAt: string;
  /** Optional session ID that performed the approval */
  approvedBySession?: string;
}

/**
 * Legacy plan approval (pre-schema-versioning).
 */
interface LegacyPlanApproval {
  hash?: string;
  approvedAt?: string;
  approvedBySession?: string;
}

/**
 * Encode a plan approval artifact to JSON string.
 */
export function encodePlanApproval(artifact: PlanApprovalArtifact): string {
  return JSON.stringify(artifact);
}

/**
 * Decode a plan approval artifact from JSON string.
 * Handles both current and legacy formats.
 */
export function decodePlanApproval(raw: string | null): PlanApprovalArtifact | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    // If already has schemaVersion, validate and return
    if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
      const artifact = parsed as PlanApprovalArtifact;
      if (artifact.schemaVersion === CURRENT_SCHEMA_VERSION && artifact.hash && artifact.approvedAt) {
        return artifact;
      }
      return null;
    }

    // Legacy migration path
    const legacy = parsed as LegacyPlanApproval;
    if (legacy.hash && legacy.approvedAt) {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        hash: legacy.hash,
        approvedAt: legacy.approvedAt,
        approvedBySession: legacy.approvedBySession,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Approved Plan Artifact
// ============================================================================

/**
 * Approved plan artifact payload.
 * Stored as 'approved_plan' artifact in epic beads.
 * Contains the full plan content snapshot at approval time.
 */
export interface ApprovedPlanArtifact extends VersionedArtifact {
  /** Full plan markdown content */
  content: string;
  /** ISO timestamp when snapshot was created */
  snapshotAt: string;
  /** SHA-256 hash of the plan content */
  contentHash: string;
}

/**
 * Encode an approved plan artifact to JSON string.
 */
export function encodeApprovedPlan(artifact: ApprovedPlanArtifact): string {
  return JSON.stringify(artifact);
}

/**
 * Decode an approved plan artifact from JSON string.
 */
export function decodeApprovedPlan(raw: string | null): ApprovedPlanArtifact | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    if (typeof parsed === 'object' && parsed !== null) {
      const artifact = parsed as ApprovedPlanArtifact;

      // Handle versioned artifacts
      if ('schemaVersion' in artifact) {
        if (artifact.schemaVersion === CURRENT_SCHEMA_VERSION && artifact.content) {
          return artifact;
        }
        return null;
      }

      // Legacy migration: simple string content
      if (typeof parsed === 'object' && 'content' in parsed && typeof parsed.content === 'string') {
        return {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          content: parsed.content,
          snapshotAt: parsed.snapshotAt || new Date().toISOString(),
          contentHash: parsed.contentHash || '',
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Plan Comments Artifact
// ============================================================================

/**
 * Plan comment artifact payload.
 * Stored as 'plan_comments' artifact in epic beads.
 * Contains structured plan comment threads.
 */
export interface PlanCommentsArtifact extends VersionedArtifact {
  /** Array of plan comment threads */
  comments: PlanComment[];
}

/**
 * Legacy plan comments (pre-schema-versioning).
 */
interface LegacyPlanComments {
  threads?: PlanComment[];
  comments?: PlanComment[];
}

/**
 * Encode plan comments artifact to JSON string.
 */
export function encodePlanComments(artifact: PlanCommentsArtifact): string {
  return JSON.stringify(artifact);
}

/**
 * Decode plan comments artifact from JSON string.
 * Handles both current and legacy formats.
 */
export function decodePlanComments(raw: string | null): PlanCommentsArtifact | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    // If already has schemaVersion, validate and return
    if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
      const artifact = parsed as PlanCommentsArtifact;
      if (artifact.schemaVersion === CURRENT_SCHEMA_VERSION && Array.isArray(artifact.comments)) {
        return artifact;
      }
      return null;
    }

    // Legacy migration path - support both 'threads' and 'comments' keys
    const legacy = parsed as LegacyPlanComments;
    const comments = legacy.threads || legacy.comments;

    if (Array.isArray(comments)) {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        comments,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Task Spec Artifact
// ============================================================================

/**
 * Task spec artifact payload.
 * Stored directly as the bead description (not in artifacts block).
 */
export interface TaskSpecArtifact {
  /** Task folder name (e.g., '01-setup') */
  taskFolder: string;
  /** Feature name */
  featureName: string;
  /** Plan section content */
  planSection: string;
  /** Context content */
  context: string;
  /** Prior task summaries */
  priorTasks: Array<{ folder: string; summary?: string }>;
}

/**
 * Encode task spec artifact to markdown string.
 * This is stored directly as the bead description.
 */
export function encodeTaskSpec(artifact: TaskSpecArtifact): string {
  const { taskFolder, featureName, planSection, context, priorTasks } = artifact;

  let markdown = `# Task: ${taskFolder}\n\n`;
  markdown += `**Feature:** ${featureName}\n\n`;
  markdown += `## Plan Section\n\n${planSection}\n\n`;

  if (priorTasks.length > 0) {
    markdown += `## Prior Tasks\n\n`;
    for (const prior of priorTasks) {
      markdown += `- \`${prior.folder}\``;
      if (prior.summary) {
        markdown += `: ${prior.summary}`;
      }
      markdown += '\n';
    }
    markdown += '\n';
  }

  markdown += `## Context\n\n${context}`;

  return markdown;
}

// Note: Task spec is stored as the bead description, so decoding
// requires parsing the markdown format. This is handled by BeadsRepository.

// ============================================================================
// Worker Prompt Artifact
// ============================================================================

/**
 * Worker prompt artifact payload.
 * Stored as 'worker_prompt' artifact in task beads.
 */
export interface WorkerPromptArtifact extends VersionedArtifact {
  /** Worker prompt content */
  content: string;
  /** ISO timestamp when prompt was generated */
  generatedAt: string;
}

/**
 * Encode worker prompt artifact to JSON string.
 */
export function encodeWorkerPrompt(artifact: WorkerPromptArtifact): string {
  return JSON.stringify(artifact);
}

/**
 * Decode worker prompt artifact from JSON string.
 */
export function decodeWorkerPrompt(raw: string | null): WorkerPromptArtifact | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    // If already has schemaVersion, validate and return
    if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
      const artifact = parsed as WorkerPromptArtifact;
      if (artifact.schemaVersion === CURRENT_SCHEMA_VERSION && typeof artifact.content === 'string') {
        return artifact;
      }
      return null;
    }

    // Legacy migration: simple string content
    if (typeof parsed === 'string') {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        content: parsed,
        generatedAt: new Date().toISOString(),
      };
    }

    // Legacy migration: object with content field
    if (typeof parsed === 'object' && 'content' in parsed && typeof parsed.content === 'string') {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        content: parsed.content,
        generatedAt: (parsed as { generatedAt?: string }).generatedAt || new Date().toISOString(),
      };
    }

    return null;
  } catch {
    // If JSON.parse fails, treat raw content as legacy string
    if (raw && raw.length > 0) {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        content: raw,
        generatedAt: new Date().toISOString(),
      };
    }
    return null;
  }
}

// ============================================================================
// Task Report Artifact
// ============================================================================

/**
 * Task report artifact payload.
 * Stored as 'report' artifact in task beads.
 */
export interface TaskReportArtifact extends VersionedArtifact {
  /** Report content */
  content: string;
  /** ISO timestamp when report was created */
  createdAt: string;
}

/**
 * Encode task report artifact to JSON string.
 */
export function encodeTaskReport(artifact: TaskReportArtifact): string {
  return JSON.stringify(artifact);
}

/**
 * Decode task report artifact from JSON string.
 */
export function decodeTaskReport(raw: string | null): TaskReportArtifact | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    // If already has schemaVersion, validate and return
    if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
      const artifact = parsed as TaskReportArtifact;
      if (artifact.schemaVersion === CURRENT_SCHEMA_VERSION && typeof artifact.content === 'string') {
        return artifact;
      }
      return null;
    }

    // Legacy migration: simple string content
    if (typeof parsed === 'string') {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        content: parsed,
        createdAt: new Date().toISOString(),
      };
    }

    // Legacy migration: object with content field
    if (typeof parsed === 'object' && 'content' in parsed && typeof parsed.content === 'string') {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        content: parsed.content,
        createdAt: (parsed as { createdAt?: string }).createdAt || new Date().toISOString(),
      };
    }

    return null;
  } catch {
    // If JSON.parse fails, treat raw content as legacy string
    if (raw && raw.length > 0) {
      return {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        content: raw,
        createdAt: new Date().toISOString(),
      };
    }
    return null;
  }
}
