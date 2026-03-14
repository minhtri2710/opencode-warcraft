import type { TaskInfo, TaskStatusType } from '../../types.js';
import type { AuditEntry, BeadComment } from './BeadGateway.types.js';
import { BeadGatewayError } from './BeadGateway.types.js';
import { mapBeadStatusToTaskStatus } from './beadStatus.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Truncate raw output for inclusion in error messages. */
function excerpt(output: string, maxLen = 200): string {
  return output.length > maxLen ? `${output.slice(0, maxLen)}...` : output;
}

/** Parse JSON with a uniform error surface. */
function parseJsonPayload(output: string, target: string): unknown {
  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new BeadGatewayError(
      'parse_error',
      `Failed to parse ${target} [BR_PARSE_FAILED]: invalid JSON. Raw excerpt: "${excerpt(output)}"`,
      'BR_PARSE_FAILED',
    );
  }
}

/** Assert that a parsed value is a JSON array. */
function requireArray(parsed: unknown, target: string): unknown[] {
  if (!Array.isArray(parsed)) {
    throw new BeadGatewayError(
      'parse_error',
      `Failed to parse ${target} [BR_PARSE_FAILED]: expected JSON array`,
      'BR_PARSE_FAILED',
    );
  }
  return parsed;
}

/** Assert that an array element is a non-null object. */
function requireObject(item: unknown, target: string, label: string): Record<string, unknown> {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new BeadGatewayError(
      'parse_error',
      `Failed to parse ${target} [BR_PARSE_FAILED]: ${label} is not an object`,
      'BR_PARSE_FAILED',
    );
  }
  return item as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// List items decoder  (br list --json)
// ---------------------------------------------------------------------------

export interface ListItem {
  id: string;
  title: string;
  status: string;
  type?: string;
}

/**
 * Decode `br list --json` output.
 *
 * Handles two known shapes:
 * 1. Top-level array of issue objects.
 * 2. Wrapper object with an array under one of the known envelope keys.
 */
export function decodeListItems(output: string, target: string): ListItem[] {
  const parsed = parseJsonPayload(output, target);
  const items = unwrapArray(parsed, ['issues', 'results', 'items', 'data']);

  return items
    .map((item: unknown) => {
      const obj = item as Record<string, unknown>;
      return {
        id: String(obj.id || ''),
        title: String(obj.title || ''),
        status: String(obj.status || ''),
        type: obj.issue_type ? String(obj.issue_type) : obj.type ? String(obj.type) : undefined,
      };
    })
    .filter((item) => item.id);
}

// ---------------------------------------------------------------------------
// Dependent issues decoder  (br dep list --json)
// ---------------------------------------------------------------------------

/**
 * Decode `br dep list --json` output.
 *
 * Known shapes per dependency item:
 * - `{ type, issue: { id, title, status, issue_type } }` (embedded)
 * - `{ type, id, title, status }` (flat)
 * - `{ issue_id, depends_on_id, dep_type }` (documented CLI schema)
 * - Wrapper object with array under envelope key.
 */
export function decodeDependentIssues(
  output: string,
  target: string,
  acceptedRelationType: string = 'parent-child',
  issueTypeHint?: string,
): ListItem[] {
  const parsed = parseJsonPayload(output, target);
  const dependencies = unwrapArray(parsed, ['dependencies', 'results', 'items', 'data']);

  const children = new Map<string, ListItem>();
  for (const dependency of dependencies) {
    const dep = dependency as Record<string, unknown>;
    const relationType = dep.type ? String(dep.type) : dep.dep_type ? String(dep.dep_type) : undefined;
    if (relationType && relationType !== acceptedRelationType) {
      continue;
    }

    const candidate = dep.issue ?? dep.dependent ?? dep.target ?? dep.child ?? dep.to;
    const hasEmbeddedIssue = Boolean(candidate && typeof candidate === 'object');
    const issue = hasEmbeddedIssue ? (candidate as Record<string, unknown>) : dep;
    const id = String(issue.id || issue.issue_id || '');
    if (!id) {
      continue;
    }

    children.set(id, {
      id,
      title: String(issue.title || dep.title || ''),
      status: String(issue.status || dep.status || ''),
      type:
        hasEmbeddedIssue && (issue.issue_type || issue.type) ? String(issue.issue_type || issue.type) : issueTypeHint,
    });
  }

  return Array.from(children.values());
}

// ---------------------------------------------------------------------------
// Tasks-from-dep-list decoder  (br dep list → TaskInfo[])
// ---------------------------------------------------------------------------

export function decodeTasksFromDepList(output: string, epicId: string): TaskInfo[] {
  const items = decodeDependentIssues(output, `tasks for epic '${epicId}'`, 'parent-child');
  return items.map((item) => ({
    folder: '',
    name: item.title,
    beadId: item.id,
    status: mapBeadStatusToTaskStatus(item.status) as TaskStatusType,
    origin: 'plan' as const,
  }));
}

// ---------------------------------------------------------------------------
// Comments decoder  (br comments list --json)
// ---------------------------------------------------------------------------

export function decodeComments(output: string, beadId: string): BeadComment[] {
  const target = `comments for bead '${beadId}'`;
  const parsed = parseJsonPayload(output, target);
  const items = requireArray(parsed, target);

  return items.map((item: unknown) => {
    const obj = requireObject(item, target, 'comment item');
    const comment: BeadComment = {
      id: String(obj.id || ''),
      body: String(obj.body || obj.text || ''),
    };

    if (obj.author !== undefined) comment.author = String(obj.author);
    if (obj.timestamp !== undefined) comment.timestamp = String(obj.timestamp);
    else if (obj.created_at !== undefined) comment.timestamp = String(obj.created_at);
    if (obj.prompt !== undefined) comment.prompt = String(obj.prompt);
    if (obj.response !== undefined) comment.response = String(obj.response);

    if (!comment.id) {
      throw new BeadGatewayError('missing_field', `Failed to parse ${target}: missing id field in comment`);
    }

    return comment;
  });
}

// ---------------------------------------------------------------------------
// Audit log decoder  (br audit log --json)
// ---------------------------------------------------------------------------

export function decodeAuditLog(output: string, beadId: string): AuditEntry[] {
  const target = `audit log for bead '${beadId}'`;
  const parsed = parseJsonPayload(output, target);
  const items = requireArray(parsed, target);

  return items.map((item: unknown) => {
    const obj = requireObject(item, target, 'audit entry');
    const entry: AuditEntry = {
      id: String(obj.id || ''),
      kind: String(obj.kind || ''),
      issueId: String(obj.issue_id || ''),
    };

    if (obj.model !== undefined) entry.model = String(obj.model);
    if (obj.tool_name !== undefined) entry.toolName = String(obj.tool_name);
    if (obj.exit_code !== undefined) entry.exitCode = Number(obj.exit_code);
    if (obj.error !== undefined) entry.error = String(obj.error);
    if (obj.timestamp !== undefined) entry.timestamp = String(obj.timestamp);

    return entry;
  });
}

// ---------------------------------------------------------------------------
// Show payload decoder  (br show --json)
// ---------------------------------------------------------------------------

/**
 * Decode `br show --json` output.
 * `br show --json` returns a single-element array; unwrap it.
 */
export function decodeShowPayload(output: string, beadId: string): unknown {
  const parsed = parseJsonPayload(output, `bead data for '${beadId}'`);
  if (Array.isArray(parsed) && parsed.length === 1) {
    return parsed[0];
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// ID-from-JSON decoder  (br create --json)
// ---------------------------------------------------------------------------

export function decodeIdFromJson(output: string, target: string): string {
  const parsed = parseJsonPayload(output, target) as { id?: string };
  if (!parsed.id) {
    throw new BeadGatewayError('missing_field', `Failed to parse ${target}: missing id in br output`);
  }
  return parsed.id;
}

// ---------------------------------------------------------------------------
// Content extractor  (recursive description/body extraction from show payload)
// ---------------------------------------------------------------------------

export function extractBeadContent(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed.length > 0 ? payload : null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const content = extractBeadContent(item);
      if (content) {
        return content;
      }
    }
    return null;
  }

  const obj = payload as Record<string, unknown>;
  const preferredKeys = ['description', 'body', 'content'];
  for (const key of preferredKeys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  const nestedKeys = ['issue', 'issues', 'result', 'results', 'item', 'items', 'data'];
  for (const key of nestedKeys) {
    const value = obj[key];
    if (value !== undefined) {
      const content = extractBeadContent(value);
      if (content) {
        return content;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal: unwrap array from envelope or use directly
// ---------------------------------------------------------------------------

function unwrapArray(parsed: unknown, envelopeKeys: string[]): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === 'object') {
    for (const key of envelopeKeys) {
      const value = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }
  return [];
}
