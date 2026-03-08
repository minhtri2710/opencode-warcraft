/**
 * Task complexity classifier.
 *
 * Pure, deterministic classification of task dispatch complexity from runtime signals.
 * Used by the prompt builder to select the appropriate Mekkatorque prompt mode.
 *
 * Three levels:
 * - **trivial**: Small spec, few files, no deps, no retries — skip verbose prompt sections.
 * - **standard**: Default prompt behavior — no changes.
 * - **complex**: Large spec, many files, retries, or high reopen rate — add incremental verification guidance.
 *
 * Classification is O(1) relative to task history size (FR-010, NFR-002).
 *
 * @see specs/004-adaptive-prompts/spec.md — FR-001 through FR-004
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Task complexity level used by prompt-builder mode selection.
 */
export type TaskComplexity = 'trivial' | 'standard' | 'complex';

/**
 * Runtime signals used to classify task complexity.
 *
 * All fields are numeric and must be provided — no optional fields
 * to keep classification deterministic and explicit.
 */
export interface ComplexitySignals {
  /** Character count of the task spec content. */
  specLength: number;
  /** Number of files mentioned in the task spec. */
  fileCount: number;
  /** Number of dependsOn entries for the task. */
  dependencyCount: number;
  /** Number of prior failed/blocked attempts at this task. */
  previousAttempts: number;
  /** Feature-level reopen rate from trust metrics (0.0–1.0). */
  featureReopenRate: number;
}

// ============================================================================
// Thresholds (configurable constants)
// ============================================================================

/** Trivial: specLength must be strictly less than this. */
const TRIVIAL_SPEC_LENGTH_UPPER = 500;

/** Trivial: fileCount must be at most this. */
const TRIVIAL_FILE_COUNT_MAX = 2;

/** Complex: specLength must be strictly greater than this. */
const COMPLEX_SPEC_LENGTH_LOWER = 3000;

/** Complex: fileCount must be strictly greater than this. */
const COMPLEX_FILE_COUNT_LOWER = 5;

/** Complex: previousAttempts must be at least this. */
const COMPLEX_PREVIOUS_ATTEMPTS_MIN = 2;

/** Complex: featureReopenRate must be strictly greater than this. */
const COMPLEX_REOPEN_RATE_LOWER = 0.2;

// ============================================================================
// Classifier
// ============================================================================

/**
 * Classify task complexity from runtime signals.
 *
 * Evaluation order: complex checked first (any condition triggers),
 * then trivial (all conditions must hold), otherwise standard.
 *
 * This ensures complex always overrides trivial when both could apply
 * (e.g., small spec but many retries).
 *
 * Pure function — no side effects, no external calls.
 */
export function classifyComplexity(signals: ComplexitySignals): TaskComplexity {
  // Complex: any single condition triggers
  if (
    signals.specLength > COMPLEX_SPEC_LENGTH_LOWER ||
    signals.fileCount > COMPLEX_FILE_COUNT_LOWER ||
    signals.previousAttempts >= COMPLEX_PREVIOUS_ATTEMPTS_MIN ||
    signals.featureReopenRate > COMPLEX_REOPEN_RATE_LOWER
  ) {
    return 'complex';
  }

  // Trivial: ALL conditions must hold
  if (
    signals.specLength < TRIVIAL_SPEC_LENGTH_UPPER &&
    signals.fileCount <= TRIVIAL_FILE_COUNT_MAX &&
    signals.dependencyCount === 0 &&
    signals.previousAttempts === 0
  ) {
    return 'trivial';
  }

  // Standard: everything else
  return 'standard';
}
