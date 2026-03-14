import { grepAppMcp } from './grep-app.js';
import type { McpConfig } from './types.js';
import { websearchMcp } from './websearch.js';

const allBuiltinMcps: Record<string, McpConfig> = {
  websearch: websearchMcp,
  grep_app: grepAppMcp,
};

export const createBuiltinMcps = (disabledMcps: string[] = []): Record<string, McpConfig> => {
  const disabled = new Set(disabledMcps);
  return Object.fromEntries(Object.entries(allBuiltinMcps).filter(([name]) => !disabled.has(name)));
};
