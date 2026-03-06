export type BeadArtifactKind = 'spec' | 'worker_prompt' | 'report' | 'task_state';

export interface TaskBeadArtifacts {
  spec?: string;
  worker_prompt?: string;
  /** Task completion report content */
  report?: string;
  /** Task metadata/state when beadsMode is on */
  task_state?: string;
}

export interface BeadComment {
  id: string;
  body: string;
  author?: string;
  timestamp?: string;
  prompt?: string;
  response?: string;
}

/**
 * Parameters for recording an audit event via `br audit record`.
 *
 * SECURITY: Do NOT add prompt or response fields — these may contain
 * API keys, PII, or proprietary code. Only metadata about the interaction
 * (model name, tool name, exit code, error message) is permitted.
 */
export interface AuditRecordParams {
  /** Kind of audit event */
  kind: 'llm_call' | 'tool_call' | 'label';
  /** Bead ID the event relates to */
  issueId: string;
  /** LLM model identifier (e.g. 'claude-opus-4') */
  model?: string;
  /** Tool name that was called */
  toolName?: string;
  /** Process/tool exit code */
  exitCode?: number;
  /** Error message (sanitized — no prompts/responses) */
  error?: string;
}

/**
 * A single entry from the audit log as returned by `br audit log`.
 */
export interface AuditEntry {
  id: string;
  kind: string;
  issueId: string;
  model?: string;
  toolName?: string;
  exitCode?: number;
  error?: string;
  timestamp?: string;
}

export type BeadGatewayErrorCode =
  | 'br_not_found'
  | 'command_error'
  | 'parse_error'
  | 'missing_field'
  | 'invalid_priority';

export type BeadGatewayInternalCode =
  | 'BR_NOT_FOUND'
  | 'BR_INIT_FAILED'
  | 'BR_NOT_INITIALIZED'
  | 'BR_COMMAND_FAILED'
  | 'BR_PARSE_FAILED';
export class BeadGatewayError extends Error {
  constructor(
    public readonly code: BeadGatewayErrorCode,
    message: string,
    public readonly internalCode?: BeadGatewayInternalCode,
  ) {
    super(message);
    this.name = 'BeadGatewayError';
  }
}
