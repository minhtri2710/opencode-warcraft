/**
 * Canonical bead artifact schema module.
 *
 * This module provides:
 * - Strict type definitions for task, spec, worker prompt, and report artifact payloads
 * - Encode/decode helpers with validation
 * - Versioned payloads for forward compatibility
 * - Migration shims for legacy payloads
 *
 * All bead metadata writes MUST use these schemas to ensure consistency.
 */

import type { TaskStatus } from '../../types.js';

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
    /** Workspace mode used for execution. */
    workspaceMode?: 'worktree' | 'direct';
    /** Absolute workspace path for the running task. */
    workspacePath?: string;
    /** Branch name when executing in git worktree mode. */
    workspaceBranch?: string;
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
  /** Task folder name (e.g., '01-setup'). Persisted for stable identity across reordering. */
  folder?: string;
  /** Learnings surfaced by the worker upon task completion (done tasks only). */
  learnings?: string[];
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
  folder?: string;
  learnings?: string[];
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
      folder: legacy.folder,
      learnings: legacy.learnings,
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
    folder: taskStatus.folder,
    learnings: taskStatus.learnings,
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
    folder: artifact.folder,
    learnings: artifact.learnings,
  };
}

// ============================================================================
// Task Spec Artifact
// ============================================================================

/**
 * Legacy task spec artifact payload.
 *
 * Canonical task spec markdown is now produced by `specFormatter.ts` and stored directly
 * as the bead description. These legacy helpers remain only for backward-compatible reads
 * and tests that still exercise the older structured shape.
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
 * Legacy encoder retained for backward-compatible tests only.
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
