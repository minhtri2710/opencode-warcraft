/**
 * JSONL event logger for warcraft operational events.
 *
 * Captures structured events (dispatch, commit, merge, blocked, retry, degraded)
 * to a `.beads/events.jsonl` file for operator observability and trust metrics.
 *
 * Events are appended as newline-delimited JSON for easy grep/streaming analysis.
 * All writes are best-effort — event logging never blocks or fails operations.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Supported event types for the Warcraft event log */
export const WARCRAFT_EVENT_TYPES = [
  'dispatch',
  'commit',
  'merge',
  'blocked',
  'retry',
  'degraded',
] as const;

export type WarcraftEventType = (typeof WARCRAFT_EVENT_TYPES)[number];

export interface WarcraftEvent {
  type: WarcraftEventType;
  feature: string;
  task: string;
  timestamp?: string;
  details?: Record<string, unknown>;
}

export interface EventLogger {
  /** Emit a structured event to the JSONL log */
  emit(event: Omit<WarcraftEvent, 'timestamp'> & { timestamp?: string }): void;
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
  };
}

/** Create a no-op event logger (for testing or when logging is disabled) */
export function createNoopEventLogger(): EventLogger {
  return {
    emit(): void {},
  };
}
