/**
 * Structured logger abstraction for warcraft-core.
 *
 * Provides a minimal, injectable logger interface that services
 * can use instead of `console.warn`. Supports configurable log levels
 * and pluggable sinks for testing and JSONL event capture.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/** Sink function that receives structured log entries */
export type LogSink = (entry: LogEntry) => void;

export interface ConsoleLoggerOptions {
  /** Minimum log level to emit (default: 'info') */
  minLevel?: LogLevel;
  /** Custom sink (default: console-based output) */
  sink?: LogSink;
}

/** Create a logger that discards all messages (useful as default injection) */
export function createNoopLogger(): Logger {
  const noop = (): void => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}

/** Default console sink that writes to stderr */
function defaultConsoleSink(entry: LogEntry): void {
  const prefix = `[warcraft] [${entry.level.toUpperCase()}]`;
  const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : '';
  const line = `${prefix} ${entry.message}${contextStr}`;
  if (entry.level === 'error') {
    console.error(line);
  } else if (entry.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/** Create a structured logger with configurable level and sink */
export function createConsoleLogger(options?: ConsoleLoggerOptions): Logger {
  const minLevel = options?.minLevel ?? 'info';
  const sink = options?.sink ?? defaultConsoleSink;
  const minLevelValue = LOG_LEVELS[minLevel];

  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVELS[level] < minLevelValue) return;
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context,
    };
    sink(entry);
  }

  return {
    debug: (message, context) => log('debug', message, context),
    info: (message, context) => log('info', message, context),
    warn: (message, context) => log('warn', message, context),
    error: (message, context) => log('error', message, context),
  };
}
