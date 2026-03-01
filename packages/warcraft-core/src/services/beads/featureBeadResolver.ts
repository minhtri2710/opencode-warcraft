import type { BeadsModeProvider, FeatureJson } from '../../types.js';
import { BeadGateway } from './BeadGateway.js';
import { isBeadsEnabled } from './beadsMode.js';

/**
 * Resolution options for epic bead ID lookup.
 */
export interface EpicResolutionOptions {
  /** Project root directory path */
  projectRoot: string;
  /** Feature name to resolve */
  featureName: string;
  /** Path utilities to get feature.json path */
  getFeatureJsonPath: (root: string, name: string, mode: 'on' | 'off') => string;
  /** JSON read utility (with null fallback) */
  readJson: <T>(path: string) => T | null;
  /** Beads mode provider */
  beadsModeProvider: BeadsModeProvider;
}

/**
 * Resolve epic bead ID for a feature, with fallback to bead list lookup.
 *
 * Strategy:
 * 1. Try reading feature.json with current beads mode
 * 2. (Optional strict variant) Fall back to reading with 'off' mode
 * 3. If beads enabled and ID not found, list epics from BeadGateway to find match by name
 *
 * @param options - Resolution options
 * @returns Epic bead ID, or null if not found (for optional variant)
 * @throws Error if feature not found and strict variant is used
 */
function resolveEpicBeadId(options: EpicResolutionOptions, strict: boolean): string | null {
  const { projectRoot, featureName, getFeatureJsonPath, readJson, beadsModeProvider } = options;

  // Try reading feature.json with current beads mode
  let feature = readJson<FeatureJson>(getFeatureJsonPath(projectRoot, featureName, beadsModeProvider.getBeadsMode()));

  // Strict variant: fall back to 'off' mode if first read failed
  if (strict && !feature?.epicBeadId) {
    feature = readJson<FeatureJson>(getFeatureJsonPath(projectRoot, featureName, 'off'));
  }

  // Return epic bead ID if found in feature.json
  if (feature?.epicBeadId) {
    return feature.epicBeadId;
  }

  // If beads enabled, try listing epics from BeadGateway to find match by name
  if (isBeadsEnabled(beadsModeProvider)) {
    const gateway = new BeadGateway(projectRoot);
    const epics = gateway.list({ type: 'epic', status: 'all' });
    const epic = epics.find((entry) => entry.title === featureName);

    if (epic?.id) {
      return epic.id;
    }

    // Strict: throw if not found in BeadGateway
    if (strict) {
      throw new Error(`Feature '${featureName}' not found in beads`);
    }
  }

  return null;
}

/**
 * Resolve epic bead ID for a feature (optional variant).
 *
 * Returns null if epic bead ID cannot be resolved.
 *
 * @param options - Resolution options
 * @returns Epic bead ID, or null if not found
 */
export function getEpicBeadIdOptional(options: EpicResolutionOptions): string | null {
  return resolveEpicBeadId(options, false);
}

/**
 * Resolve epic bead ID for a feature (strict variant).
 *
 * Throws Error if epic bead ID cannot be resolved.
 *
 * @param options - Resolution options
 * @returns Epic bead ID
 * @throws Error if feature not found
 */
export function getEpicBeadIdStrict(options: EpicResolutionOptions): string {
  const result = resolveEpicBeadId(options, true);

  if (!result) {
    throw new Error(`Feature '${options.featureName}' not found`);
  }

  return result;
}
