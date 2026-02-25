/**
 * Shared types for opencode-warcraft plugin
 */

export interface ToolContext {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
}

/**
 * Canonical structured response shape for all Warcraft tools.
 * Phase 6 will migrate all tools to use this contract.
 */
export interface ToolResult<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
	hints?: string[];
	warnings?: ToolWarning[];
}

export interface ToolWarning {
	type: string;
	severity: 'info' | 'warning' | 'error';
	message: string;
	affected?: string;
	count?: number;
}

/** Helper to create a success ToolResult JSON string. */
export function toolSuccess<T>(data: T): string {
	return JSON.stringify({ success: true, data } satisfies ToolResult<T>, null, 2);
}

/** Helper to create an error ToolResult JSON string. */
export function toolError(error: string, hints?: string[]): string {
	return JSON.stringify({ success: false, error, hints } satisfies ToolResult, null, 2);
}
