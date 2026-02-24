/**
 * Shared types for opencode-warcraft plugin
 */

export interface ToolContext {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
}
