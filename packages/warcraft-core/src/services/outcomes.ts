/**
 * Typed outcome envelope for operations that may partially succeed.
 *
 * Unlike Result<T> (binary success/failure), OperationOutcome captures
 * three severity levels to distinguish complete success from degraded
 * states where the primary operation succeeded but side-effects failed.
 */

export type OutcomeSeverity = 'ok' | 'degraded' | 'fatal';

export interface Diagnostic {
  /** Machine-readable error code (e.g., 'flush_failed', 'label_sync_failed') */
  code: string;
  /** Human-readable description */
  message: string;
  /** Severity of this individual diagnostic */
  severity: OutcomeSeverity;
  /** Additional structured context for debugging */
  context?: Record<string, unknown>;
}

export interface OperationOutcome<T = void> {
  /** Overall severity: worst severity among all diagnostics, or 'ok' if none */
  severity: OutcomeSeverity;
  /** The operation's return value (present when severity is not 'fatal') */
  value?: T;
  /** Ordered list of diagnostics collected during the operation */
  diagnostics: Diagnostic[];
}

/** Convenience: create an ok outcome with a value */
export function ok<T>(value: T): OperationOutcome<T> {
  return { severity: 'ok', value, diagnostics: [] };
}

/** Convenience: create an ok outcome with no value */
export function okVoid(): OperationOutcome<void> {
  return { severity: 'ok', value: undefined, diagnostics: [] };
}

/** Convenience: create a degraded outcome with value + diagnostics */
export function degraded<T>(value: T, diagnostics: Diagnostic[]): OperationOutcome<T> {
  return { severity: 'degraded', value, diagnostics };
}

/** Convenience: create a fatal outcome with diagnostics */
export function fatal<T = void>(diagnostics: Diagnostic[]): OperationOutcome<T> {
  return { severity: 'fatal', diagnostics };
}

/** Create a single diagnostic entry */
export function diagnostic(
  code: string,
  message: string,
  severity: OutcomeSeverity = 'degraded',
  context?: Record<string, unknown>,
): Diagnostic {
  return { code, message, severity, context };
}

/** Check if an outcome is at least partially successful (ok or degraded) */
export function isUsable<T>(outcome: OperationOutcome<T>): outcome is OperationOutcome<T> & { value: T } {
  return outcome.severity !== 'fatal' && outcome.value !== undefined;
}

/** Merge multiple diagnostics into the worst severity */
export function worstSeverity(diagnostics: Diagnostic[]): OutcomeSeverity {
  if (diagnostics.some((d) => d.severity === 'fatal')) return 'fatal';
  if (diagnostics.some((d) => d.severity === 'degraded')) return 'degraded';
  return 'ok';
}

/** Append diagnostics to an existing outcome, recalculating severity */
export function withDiagnostics<T>(
  outcome: OperationOutcome<T>,
  newDiagnostics: Diagnostic[],
): OperationOutcome<T> {
  const allDiagnostics = [...outcome.diagnostics, ...newDiagnostics];
  const severity = worstSeverity(allDiagnostics);
  return { ...outcome, severity, diagnostics: allDiagnostics };
}

/** Create a diagnostic from an error (Error instance, string, or unknown) */
export function fromError(
  code: string,
  error: unknown,
  severity: OutcomeSeverity = 'degraded',
  context?: Record<string, unknown>,
): Diagnostic {
  const message = error instanceof Error ? error.message : String(error);
  return diagnostic(code, message, severity, context);
}

/** Merge multiple outcomes into one, combining all diagnostics and taking worst severity */
export function collectOutcomes(outcomes: OperationOutcome<unknown>[]): OperationOutcome<void> {
  const allDiagnostics = outcomes.flatMap((o) => o.diagnostics);
  const severity = worstSeverity(allDiagnostics);
  return { severity, value: undefined, diagnostics: allDiagnostics };
}
