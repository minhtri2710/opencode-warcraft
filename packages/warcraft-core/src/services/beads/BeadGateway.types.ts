export type BeadArtifactKind =
  | 'spec'
  | 'worker_prompt'
  | 'plan_approval'
  | 'approved_plan'
  | 'plan_comments'
  | 'feature_state'
  | 'task_state';

export interface PlanApprovalPayload {
  /** SHA-256 hash of the approved plan content */
  hash: string;
  /** ISO timestamp when plan was approved */
  approvedAt: string;
  /** Optional session ID that performed the approval */
  approvedBySession?: string;
}

export interface TaskBeadArtifacts {
  spec?: string;
  worker_prompt?: string;
  /** Plan approval record with hash for integrity checking */
  plan_approval?: string;
  /** Full approved plan content snapshot */
  approved_plan?: string;
  /** Structured plan comments */
  plan_comments?: string;
  /** Feature metadata/state when beadsMode is on */
  feature_state?: string;
  /** Task metadata/state when beadsMode is on */
  task_state?: string;
}

export type BeadGatewayErrorCode =
  | 'br_not_found'
  | 'command_error'
  | 'parse_error'
  | 'missing_field'
  | 'invalid_priority';

export class BeadGatewayError extends Error {
  constructor(
    public readonly code: BeadGatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BeadGatewayError';
  }
}
