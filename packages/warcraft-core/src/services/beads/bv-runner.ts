import { execFileSync } from 'child_process';

export type BvCommandExecutor = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: 'utf-8'; timeout?: number },
) => string;

export interface BvHealth {
  enabled: boolean;
  available: boolean;
  lastError: string | null;
  lastErrorAt: number | null;
  lastSuccessAt: number | null;
}

export const defaultBvExecutor: BvCommandExecutor = (command, args, options) => {
  return execFileSync(command, args, options);
};

/**
 * Execute a BV CLI robot command and return parsed JSON.
 * Shared by both BeadsViewerGateway and BvTriageService.
 */
export function runBvCommand(
  args: string[],
  options: {
    directory: string;
    enabled: boolean;
    executor: BvCommandExecutor;
  },
): { result: unknown | null; error: string | null } {
  if (!options.enabled) {
    return { result: null, error: 'disabled by beadsMode=off' };
  }
  try {
    const output = options.executor('bv', [...args, '--format', 'json'], {
      cwd: options.directory,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    return { result: JSON.parse(output) as unknown, error: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { result: null, error: reason };
  }
}
