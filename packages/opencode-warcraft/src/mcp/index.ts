import { context7Mcp } from './context7.js';
import { grepAppMcp } from './grep-app.js';
import type { McpConfig } from './types.js';
import { websearchMcp } from './websearch.js';

const allBuiltinMcps: Record<string, McpConfig> = {
  websearch: websearchMcp,
  context7: context7Mcp,
  grep_app: grepAppMcp,
};

export const createBuiltinMcps = (disabledMcps: string[] = []): Record<string, McpConfig> => {
  const disabled = new Set(disabledMcps);
  return Object.fromEntries(Object.entries(allBuiltinMcps).filter(([name]) => !disabled.has(name)));
};
