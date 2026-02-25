import type { BeadsModeProvider } from '../../types.js';

/**
 * Check if beads mode is enabled (not 'off').
 *
 * This centralizes the pattern: `provider.getBeadsMode() !== 'off'`
 *
 * @param provider - The beads mode provider to query
 * @returns true if beadsMode is 'on', false if 'off'
 */
export function isBeadsEnabled(provider: BeadsModeProvider): boolean {
  return provider.getBeadsMode() !== 'off';
}

/**
 * Require that beads mode is enabled, throwing otherwise.
 *
 * Use this for operations that mandate bead integration.
 *
 * @param provider - The beads mode provider to query
 * @param context - Optional context string for error message
 * @throws Error if beadsMode is 'off'
 */
export function requireBeadsEnabled(provider: BeadsModeProvider, context?: string): void {
  if (!isBeadsEnabled(provider)) {
    const contextMsg = context ? ` ${context}` : '';
    throw new Error(`Beads mode is required but is currently 'off'.${contextMsg}`);
  }
}
