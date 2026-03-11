import type { ConfigService } from 'warcraft-core';

const MAX_HOOK_COUNTERS = 100;

export interface HookCadenceTracker {
  shouldExecuteHook(hookName: string, configService: ConfigService, options?: { safetyCritical?: boolean }): boolean;
  reset(): void;
}

/**
 * Create a per-plugin cadence tracker so hook turn state stays scoped to one
 * plugin instance instead of bleeding across repositories or sessions.
 */
export function createHookCadenceTracker(): HookCadenceTracker {
  const hookCounters = new Map<string, number>();

  return {
    shouldExecuteHook(hookName: string, configService: ConfigService, options?: { safetyCritical?: boolean }): boolean {
      const cadence = configService.getHookCadence(hookName, options);
      const previousTurn = hookCounters.get(hookName) ?? 0;
      const currentTurn = previousTurn + 1;

      if (hookCounters.has(hookName)) {
        hookCounters.delete(hookName);
      } else if (hookCounters.size >= MAX_HOOK_COUNTERS) {
        const oldestHook = hookCounters.keys().next().value;
        if (oldestHook !== undefined) {
          hookCounters.delete(oldestHook);
          console.warn(`[warcraft] hookCounters exceeded max size, evicting oldest entry: ${oldestHook}`);
        }
      }

      hookCounters.set(hookName, currentTurn);

      if (currentTurn === 1) return true;
      return (currentTurn - 1) % cadence === 0;
    },

    reset(): void {
      hookCounters.clear();
    },
  };
}
