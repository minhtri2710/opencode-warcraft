import * as path from 'path';
import type { TaskStatusType } from 'warcraft-core';

// ============================================================================
// Validation & Gate Logic
// Extracted from index.ts — pure functions with no service dependencies.
// ============================================================================

const VALID_TASK_STATUSES = new Set<string>([
  'pending',
  'in_progress',
  'dispatch_prepared',
  'done',
  'cancelled',
  'blocked',
  'failed',
  'partial',
]);

export const COMPLETION_GATES = ['build', 'test', 'lint'] as const;

export type CompletionGate = (typeof COMPLETION_GATES)[number];

export const COMPLETION_PASS_SIGNAL =
  /\b(exit(?:\s+code)?\s*0|pass(?:ed|es)?|success(?:ful|fully)?|succeed(?:ed|s)?|ok)\b/i;

export const COMPLETION_FAIL_SIGNAL = /\b(not ok|not successful|failed|failure|error)\b/i;

/**
 * Escape special regex characters in a string to use it safely in a RegExp constructor.
 * @param string - The string to escape
 * @returns The escaped string safe for use in regex
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function validateTaskStatus(status: string): TaskStatusType {
  if (!VALID_TASK_STATUSES.has(status)) {
    throw new Error(`Invalid task status: "${status}". Valid values: ${Array.from(VALID_TASK_STATUSES).join(', ')}`);
  }
  return status as TaskStatusType;
}

export function hasCompletionGateEvidence(summary: string, gate: (typeof COMPLETION_GATES)[number]): boolean {
  const lines = summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const gatePattern = `\\b${escapeRegExp(gate)}s?\\b`;
  const gateSuccessPattern = new RegExp(
    `${gatePattern}(?:[^\\n\\r]{0,40}?)\\b(?:exit(?:\\s+code)?\\s*0|pass(?:ed|es)?|success(?:ful|fully)?|succeeded|ok)\\b`,
    'i',
  );

  return lines.some((line) => {
    // Check for fail signals first - if present, reject the line
    if (COMPLETION_FAIL_SIGNAL.test(line)) {
      return false;
    }

    return gateSuccessPattern.test(line);
  });
}

// ============================================================================
// Structured Verification Types & Gate Logic
// ============================================================================

/** Structured result for a single verification gate (build, test, lint). */
export interface GateVerification {
  /** Command that was run (e.g., 'bun run build') */
  cmd: string;
  /** Process exit code (0 = success) */
  exitCode: number;
  /** Optional captured output */
  output?: string;
}

/** Structured verification payload for all gates. */
export type StructuredVerification = {
  [K in CompletionGate]?: GateVerification;
};

/**
 * Check verification gates using structured data (preferred) with regex fallback.
 *
 * - When structured verification data exists for a gate, it takes precedence.
 * - In 'compat' mode, missing structured gates fall back to regex on summary.
 * - In 'enforce' mode, missing structured gates are treated as missing (no fallback).
 *
 * @returns Object with passed boolean, missing gates, and whether regex fallback was used.
 */
export function checkVerificationGates(
  verification: StructuredVerification | undefined,
  summary: string,
  gates: readonly CompletionGate[],
  mode: 'compat' | 'enforce',
  hasEvidence: (summary: string, gate: CompletionGate) => boolean,
): { passed: boolean; missing: CompletionGate[]; usedRegexFallback: boolean } {
  const missing: CompletionGate[] = [];
  let usedRegexFallback = false;

  for (const gate of gates) {
    // Prefer structured verification
    if (verification?.[gate]) {
      if (verification[gate].exitCode !== 0) {
        missing.push(gate);
      }
      continue;
    }

    // No structured data for this gate
    if (mode === 'enforce') {
      // Enforce mode: no fallback, gate is missing
      missing.push(gate);
      continue;
    }

    // Compat mode: fall back to regex on summary
    usedRegexFallback = true;
    if (!hasEvidence(summary, gate)) {
      missing.push(gate);
    }
  }

  return { passed: missing.length === 0, missing, usedRegexFallback };
}

export function isPathInside(candidatePath: string, parentPath: string): boolean {
  const absoluteCandidate = path.resolve(candidatePath);
  const absoluteParent = path.resolve(parentPath);
  const relative = path.relative(absoluteParent, absoluteCandidate);

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
