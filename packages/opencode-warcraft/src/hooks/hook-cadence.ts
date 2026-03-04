import type { ConfigService } from 'warcraft-core';

/**
 * Per-hook turn counters for cadence-based firing.
 * Turn 1 always fires. Subsequent turns fire when (turn - 1) % cadence === 0.
 *
 * Hook names should come from a bounded set (e.g. registered plugin hook points).
 * If unbounded names are used, the size guard in {@link shouldExecuteHook} will
 * clear the map and log a warning to prevent unbounded memory growth.
 */
const hookCounters = new Map<string, number>();

/**
 * Check whether a hook should execute on this turn.
 * Increments the internal counter for the hook each call.
 */
export function shouldExecuteHook(
  hookName: string,
  configService: ConfigService,
  options?: { safetyCritical?: boolean },
): boolean {
  const cadence = configService.getHookCadence(hookName, options);
  const currentTurn = (hookCounters.get(hookName) ?? 0) + 1;
  hookCounters.set(hookName, currentTurn);

  if (hookCounters.size > 100) {
    hookCounters.clear();
    console.warn('[warcraft] hookCounters exceeded max size, clearing');
  }

  if (currentTurn === 1) return true;
  return (currentTurn - 1) % cadence === 0;
}

/**
 * Reset all hook counters. Used for testing.
 */
export function resetHookCounters(): void {
  hookCounters.clear();
}
