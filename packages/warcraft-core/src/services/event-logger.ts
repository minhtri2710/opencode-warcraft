/**
 * JSONL event logger for warcraft operational events.
 *
 * Captures structured events (dispatch, commit, merge, blocked, retry, degraded,
 * reopen, prune, duplicate_dispatch_prevented) to a `.beads/events.jsonl` file
 * for operator observability and trust metrics.
 *
 * Events are appended as newline-delimited JSON for easy grep/streaming analysis.
 * All writes are best-effort — event logging never blocks or fails operations.
 *
 * Trust metrics tracked:
 * - Reopen rate after `done` (reopen events)
 * - Blocked-task MTTR (blocked + commit pairs)
 * - Duplicate-dispatch prevention count (duplicate_dispatch_prevented events)
 * - Prune dry-run acceptance rate (prune events with dryRun/confirmed details)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { TraceContext } from './trace-context.js';

/** Supported event types for the Warcraft event log */
export const WARCRAFT_EVENT_TYPES = [
  'dispatch',
  'prompt_prepared',
  'worktree_created',
  'worktree_removed',
  'commit',
  'merge',
  'verification_run',
  'blocked',
  'retry',
  'degraded',
  'reopen',
  'prune',
  'duplicate_dispatch_prevented',
] as const;

export type WarcraftEventType = (typeof WARCRAFT_EVENT_TYPES)[number];

export interface WarcraftEvent {
  type: WarcraftEventType;
  feature: string;
  task: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  timestamp?: string;
  details?: Record<string, unknown>;
}

export interface EventLogger {
  /** Emit a structured event to the JSONL log */
  emit(event: Omit<WarcraftEvent, 'timestamp'> & { timestamp?: string }): void;
  /** Read the most recent trace context for a task, if present in the log. */
  getLatestTraceContext?: (feature: string, task: string) => TraceContext | null;
}

/** Trust metrics summary computed from JSONL event log */
export interface TrustMetrics {
  /** Number of tasks reopened after being marked done */
  reopenCount: number;
  /** Total tasks completed (commit events with status=completed) */
  totalCompleted: number;
  /** Reopen rate: reopenCount / totalCompleted (0 if no completions) */
  reopenRate: number;
  /** Mean time to resolution for blocked tasks (ms), null if no resolved blockers */
  blockedMttrMs: number | null;
  /** Number of duplicate dispatches prevented */
  duplicateDispatchPreventedCount: number;
  /** Number of prune dry-runs */
  pruneDryRunCount: number;
  /** Number of prune confirmations (destructive prunes accepted) */
  pruneConfirmedCount: number;
  /** Prune acceptance rate: pruneConfirmedCount / pruneDryRunCount (0 if no dry-runs) */
  pruneAcceptanceRate: number;
}

/** Create an event logger that appends JSONL to `.beads/events.jsonl` */
export function createEventLogger(projectRoot: string): EventLogger {
  const logDir = path.join(projectRoot, '.beads');
  const logFile = path.join(logDir, 'events.jsonl');

  return {
    emit(event): void {
      try {
        const entry: WarcraftEvent = {
          ...event,
          timestamp: event.timestamp ?? new Date().toISOString(),
        };
        if (!fs.existsSync(logDir)) {
          fs.mkdirSync(logDir, { recursive: true });
        }
        fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
      } catch {
        // Best-effort: never throw from event logging
      }
    },
    getLatestTraceContext(feature: string, task: string): TraceContext | null {
      const events = readEvents(logFile);

      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (event.feature !== feature || event.task !== task) {
          continue;
        }

        const trace = extractTraceContext(event);
        if (trace) {
          return trace;
        }
      }

      return null;
    },
  };
}

/** Create a no-op event logger (for testing or when logging is disabled) */
export function createNoopEventLogger(): EventLogger {
  return {
    emit(): void {},
    getLatestTraceContext(): TraceContext | null {
      return null;
    },
  };
}

function readEvents(logFile: string): WarcraftEvent[] {
  if (!fs.existsSync(logFile)) {
    return [];
  }

  let content: string;
  try {
    content = fs.readFileSync(logFile, 'utf-8');
  } catch {
    return [];
  }

  return content
    .trim()
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as WarcraftEvent];
      } catch {
        return [];
      }
    });
}

function extractTraceContext(event: WarcraftEvent): TraceContext | null {
  if (!event.traceId || !event.spanId) {
    return null;
  }

  return {
    traceId: event.traceId,
    spanId: event.spanId,
    ...(event.parentSpanId ? { parentSpanId: event.parentSpanId } : {}),
  };
}

/**
 * Compute trust metrics from a JSONL event log file.
 *
 * Reads `.beads/events.jsonl` and aggregates:
 * - Reopen rate after done
 * - Blocked-task MTTR
 * - Duplicate-dispatch prevention count
 * - Prune dry-run acceptance rate
 */
export function computeTrustMetrics(projectRoot: string): TrustMetrics {
  const logFile = path.join(projectRoot, '.beads', 'events.jsonl');

  const defaults: TrustMetrics = {
    reopenCount: 0,
    totalCompleted: 0,
    reopenRate: 0,
    blockedMttrMs: null,
    duplicateDispatchPreventedCount: 0,
    pruneDryRunCount: 0,
    pruneConfirmedCount: 0,
    pruneAcceptanceRate: 0,
  };

  const events = readEvents(logFile);
  if (events.length === 0) {
    return defaults;
  }

  let reopenCount = 0;
  let totalCompleted = 0;
  let duplicateDispatchPreventedCount = 0;
  let pruneDryRunCount = 0;
  let pruneConfirmedCount = 0;

  // Track blocked timestamps per task for MTTR calculation
  const blockedAt = new Map<string, string>();
  const mttrValues: number[] = [];

  for (const event of events) {
    const taskKey = `${event.feature}::${event.task}`;

    switch (event.type) {
      case 'commit':
        if (event.details?.status === 'completed') {
          totalCompleted++;
        }
        // If this task was blocked, calculate MTTR
        if (blockedAt.has(taskKey) && event.timestamp) {
          const blockedTime = new Date(blockedAt.get(taskKey)!).getTime();
          const resolvedTime = new Date(event.timestamp).getTime();
          if (!Number.isNaN(blockedTime) && !Number.isNaN(resolvedTime)) {
            mttrValues.push(resolvedTime - blockedTime);
          }
          blockedAt.delete(taskKey);
        }
        break;

      case 'reopen':
        reopenCount++;
        break;

      case 'blocked':
        if (event.timestamp) {
          blockedAt.set(taskKey, event.timestamp);
        }
        break;

      case 'duplicate_dispatch_prevented':
        duplicateDispatchPreventedCount++;
        break;

      case 'prune':
        if (event.details?.dryRun === true) {
          pruneDryRunCount++;
        }
        if (event.details?.confirmed === true) {
          pruneConfirmedCount++;
        }
        break;
    }
  }

  const reopenRate = totalCompleted > 0 ? reopenCount / totalCompleted : 0;
  const blockedMttrMs = mttrValues.length > 0 ? mttrValues.reduce((a, b) => a + b, 0) / mttrValues.length : null;
  const pruneAcceptanceRate = pruneDryRunCount > 0 ? pruneConfirmedCount / pruneDryRunCount : 0;

  return {
    reopenCount,
    totalCompleted,
    reopenRate,
    blockedMttrMs,
    duplicateDispatchPreventedCount,
    pruneDryRunCount,
    pruneConfirmedCount,
    pruneAcceptanceRate,
  };
}
