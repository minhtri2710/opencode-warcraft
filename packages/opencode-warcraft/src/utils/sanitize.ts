/**
 * Sanitise a `learnings` value so that malformed payloads
 * (non-array, non-string elements, empty / whitespace-only strings)
 * are silently discarded rather than persisted or causing a crash.
 */
export function sanitizeLearnings(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const valid = raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return valid.length > 0 ? valid : undefined;
}
