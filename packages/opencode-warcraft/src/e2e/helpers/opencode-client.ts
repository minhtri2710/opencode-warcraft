import type { PluginInput } from '@opencode-ai/plugin';
import { createOpencodeClient } from '@opencode-ai/sdk';

export type LoggedAppCall = {
  body?: {
    service?: string;
    level?: 'debug' | 'info' | 'warn' | 'error';
    message?: string;
    extra?: Record<string, unknown>;
  };
};

export function createTestOpencodeClient(): {
  client: PluginInput['client'];
  logCalls: LoggedAppCall[];
} {
  const client = createOpencodeClient({ baseUrl: 'http://localhost:1' }) as unknown as PluginInput['client'];
  const logCalls: LoggedAppCall[] = [];

  const app = (client as { app?: { log?: (options?: LoggedAppCall) => Promise<boolean> } }).app;
  if (app && typeof app === 'object') {
    app.log = async (options?: LoggedAppCall) => {
      logCalls.push(options ?? {});
      return true;
    };
  }

  return { client, logCalls };
}
