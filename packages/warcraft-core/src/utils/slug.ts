/**
 * Convert a human-readable task name to a filesystem-safe slug.
 * Lowercases, replaces whitespace runs with hyphens, strips non-alphanumeric/hyphen chars.
 */
export function slugifyTaskName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Derive the canonical task folder name from a numeric order and a slug (or raw name).
 * If `nameOrSlug` is already slugified it is used as-is; otherwise it is slugified first.
 *
 * @param order - 1-based task order
 * @param nameOrSlug - Task name (will be slugified) or pre-slugified string
 * @returns e.g. '01-setup-api', '02-build-ui'
 */
export function deriveTaskFolder(order: number, nameOrSlug: string): string {
  const slug = slugifyTaskName(nameOrSlug);
  return `${String(order).padStart(2, '0')}-${slug}`;
}
