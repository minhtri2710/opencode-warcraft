/**
 * Shared utilities for reading and writing bead artifacts.
 *
 * This centralizes the try/catch + JSON.parse/stringify + null fallback
 * pattern used across FeatureService, TaskService, and PlanService.
 */

/**
 * Read and parse a JSON bead artifact.
 *
 * Handles:
 * - Null/undefined raw content
 * - JSON parse errors
 * - Returns null on any error
 *
 * @template T - Expected artifact type
 * @param raw - Raw artifact content string (or null)
 * @returns Parsed artifact object, or null if read/parse fails
 */
export function readJsonArtifact<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Serialize an artifact object to JSON string for upsert.
 *
 * This is a thin wrapper around JSON.stringify that provides a consistent
 * API and future-proofs for potential formatting or validation.
 *
 * @param value - Artifact object to serialize
 * @returns JSON string suitable for upsertArtifact
 */
export function writeJsonArtifact<T>(value: T): string {
  return JSON.stringify(value);
}

/**
 * Read a bead artifact through a gateway/client interface.
 *
 * Generic function that works with both BeadGateway and the BeadClient interface.
 *
 * @template T - Expected artifact type
 * @param readFn - Function that reads raw artifact content (returns string | null)
 * @returns Parsed artifact object, or null if read/parse fails
 */
export function readBeadArtifact<T>(
  readFn: () => string | null
): T | null {
  try {
    const raw = readFn();
    return readJsonArtifact<T>(raw);
  } catch {
    return null;
  }
}

/**
 * Write a bead artifact through a gateway/client interface.
 *
 * Generic function that works with both BeadGateway and the BeadClient interface.
 *
 * @template T - Artifact object type
 * @param value - Artifact object to write
 * @param writeFn - Function that upserts the artifact (takes JSON string)
 * @returns JSON string that was written (useful for testing/debugging)
 */
export function writeBeadArtifact<T>(
  value: T,
  writeFn: (content: string) => void
): string {
  const json = writeJsonArtifact(value);
  writeFn(json);
  return json;
}
