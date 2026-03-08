import type { PluginInput } from '@opencode-ai/plugin';
import type { Logger, LogLevel } from 'warcraft-core';
import { createNoopLogger } from 'warcraft-core';

interface AppLogBody {
  service: string;
  level: LogLevel;
  message: string;
  extra?: Record<string, unknown>;
}

interface AppLogOptions {
  body?: AppLogBody;
}

type AppLogFn = (options?: AppLogOptions) => unknown;

function resolveAppLog(client: PluginInput['client'] | null | undefined): AppLogFn | null {
  const app = (client as { app?: { log?: unknown } } | null | undefined)?.app;
  if (!app || typeof app !== 'object' || typeof app.log !== 'function') {
    return null;
  }
  return app.log.bind(app) as AppLogFn;
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<unknown>).catch === 'function';
}

export function createOpencodeLogger(client: PluginInput['client'] | null | undefined): Logger {
  const appLog = resolveAppLog(client);
  if (!appLog) {
    return createNoopLogger();
  }

  const emit = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    const body: AppLogBody = {
      service: 'warcraft',
      level,
      message,
      ...(context ? { extra: context } : {}),
    };

    try {
      const request = appLog({ body });
      if (isPromiseLike(request)) {
        void request.catch(() => undefined);
      }
    } catch {
      // Logging must never throw
    }
  };

  return {
    debug: (message, context) => emit('debug', message, context),
    info: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context),
  };
}
