import { createHash } from 'crypto';

/**
 * Convert a human-readable task name to a filesystem-safe slug.
 * Lowercases, replaces whitespace runs with hyphens, strips non-alphanumeric/hyphen chars.
 */
export function slugifyTaskName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  // Preserve existing slugs for normal task names, but never emit an empty or hyphen-only folder segment.
  if (/[a-z0-9]/.test(slug)) {
    return slug;
  }

  const hash = createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 8);
  return `task-${hash}`;
}

export function slugifyIdentifierSegment(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length > 0) {
    return slug;
  }

  const hash = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);
  return `id-${hash}`;
}

export function deriveDeterministicLocalId(...parts: string[]): string {
  return `local-${parts.map((part) => slugifyIdentifierSegment(part)).join('-')}`;
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
