import { describe, expect, it } from 'bun:test';
import { BeadGatewayError } from './BeadGateway.types.js';
import {
  decodeAuditLog,
  decodeComments,
  decodeDependentIssues,
  decodeIdFromJson,
  decodeListItems,
  decodeShowPayload,
  decodeTasksFromDepList,
  extractBeadContent,
} from './beadDecoders.js';

describe('beadDecoders', () => {
  describe('decodeListItems', () => {
    it('decodes top-level array', () => {
      const output = JSON.stringify([
        { id: 'bd-1', title: 'Task 1', status: 'open', issue_type: 'task' },
        { id: 'bd-2', title: 'Epic 1', status: 'closed', issue_type: 'epic' },
      ]);
      const items = decodeListItems(output, 'test');
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ id: 'bd-1', title: 'Task 1', status: 'open', type: 'task' });
      expect(items[1]).toEqual({ id: 'bd-2', title: 'Epic 1', status: 'closed', type: 'epic' });
    });

    it('decodes envelope object with issues key', () => {
      const output = JSON.stringify({
        issues: [{ id: 'bd-1', title: 'T', status: 'open' }],
      });
      const items = decodeListItems(output, 'test');
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('bd-1');
    });

    it('filters out items without id', () => {
      const output = JSON.stringify([
        { id: 'bd-1', title: 'Good', status: 'open' },
        { id: '', title: 'Bad', status: 'open' },
      ]);
      const items = decodeListItems(output, 'test');
      expect(items).toHaveLength(1);
    });

    it('returns empty array for non-array non-object', () => {
      const items = decodeListItems('"hello"', 'test');
      expect(items).toEqual([]);
    });

    it('throws on invalid JSON', () => {
      expect(() => decodeListItems('not json', 'test')).toThrow(BeadGatewayError);
    });
  });

  describe('decodeDependentIssues', () => {
    it('decodes embedded issue objects', () => {
      const output = JSON.stringify([
        { type: 'parent-child', issue: { id: 't-1', title: 'Task', status: 'open', issue_type: 'task' } },
      ]);
      const items = decodeDependentIssues(output, 'test');
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ id: 't-1', title: 'Task', status: 'open', type: 'task' });
    });

    it('decodes flat dependency items', () => {
      const output = JSON.stringify([{ type: 'parent-child', id: 't-1', title: 'Flat', status: 'open' }]);
      const items = decodeDependentIssues(output, 'test');
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('t-1');
    });

    it('filters by relation type', () => {
      const output = JSON.stringify([
        { type: 'parent-child', issue: { id: 't-1', title: 'Child', status: 'open' } },
        { type: 'blocks', issue: { id: 't-2', title: 'Blocker', status: 'open' } },
      ]);
      const items = decodeDependentIssues(output, 'test', 'parent-child');
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('t-1');
    });

    it('deduplicates by id', () => {
      const output = JSON.stringify([
        { type: 'parent-child', issue: { id: 't-1', title: 'First', status: 'open' } },
        { type: 'parent-child', issue: { id: 't-1', title: 'Dupe', status: 'closed' } },
      ]);
      const items = decodeDependentIssues(output, 'test');
      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Dupe'); // Last wins in Map
    });

    it('applies issueTypeHint for flat items', () => {
      const output = JSON.stringify([{ type: 'parent-child', id: 't-1', title: 'T', status: 'open' }]);
      const items = decodeDependentIssues(output, 'test', 'parent-child', 'task');
      expect(items[0].type).toBe('task');
    });

    it('decodes documented schema format {issue_id, depends_on_id, dep_type}', () => {
      const output = JSON.stringify([{ issue_id: 'bd-abc', depends_on_id: 'bd-def', dep_type: 'blocks' }]);
      const items = decodeDependentIssues(output, 'test', 'blocks');
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual({ id: 'bd-abc', title: '', status: '', type: undefined });
    });

    it('filters documented schema by dep_type', () => {
      const output = JSON.stringify([
        { issue_id: 'bd-1', depends_on_id: 'bd-2', dep_type: 'blocks' },
        { issue_id: 'bd-3', depends_on_id: 'bd-4', dep_type: 'parent-child' },
      ]);
      const items = decodeDependentIssues(output, 'test', 'blocks');
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('bd-1');
    });

    it('decodes mixed formats in the same response', () => {
      const output = JSON.stringify([
        { type: 'parent-child', issue: { id: 't-1', title: 'Embedded', status: 'open' } },
        { type: 'parent-child', id: 't-2', title: 'Flat', status: 'closed' },
        { issue_id: 't-3', depends_on_id: 't-0', dep_type: 'parent-child' },
      ]);
      const items = decodeDependentIssues(output, 'test', 'parent-child');
      expect(items).toHaveLength(3);
      expect(items[0].id).toBe('t-1');
      expect(items[1].id).toBe('t-2');
      expect(items[2].id).toBe('t-3');
    });

    it('skips items with unknown format (no id or issue_id)', () => {
      const output = JSON.stringify([{ depends_on_id: 'bd-def', dep_type: 'blocks' }, { random_field: 'value' }]);
      const items = decodeDependentIssues(output, 'test', 'blocks');
      expect(items).toEqual([]);
    });

    it('applies issueTypeHint for documented schema items', () => {
      const output = JSON.stringify([{ issue_id: 'bd-1', depends_on_id: 'bd-2', dep_type: 'parent-child' }]);
      const items = decodeDependentIssues(output, 'test', 'parent-child', 'task');
      expect(items[0].type).toBe('task');
    });
  });

  describe('decodeTasksFromDepList', () => {
    it('maps bead statuses to task statuses', () => {
      const output = JSON.stringify([
        { type: 'parent-child', issue: { id: 't-1', title: 'Open', status: 'open' } },
        { type: 'parent-child', issue: { id: 't-2', title: 'Closed', status: 'closed' } },
        { type: 'parent-child', issue: { id: 't-3', title: 'Deferred', status: 'deferred' } },
        { type: 'parent-child', issue: { id: 't-4', title: 'Unknown', status: 'weird' } },
      ]);
      const tasks = decodeTasksFromDepList(output, 'epic-1');
      expect(tasks[0].status).toBe('pending');
      expect(tasks[1].status).toBe('done');
      expect(tasks[2].status).toBe('blocked');
      expect(tasks[3].status).toBe('pending');
    });

    it('sets origin and folder correctly', () => {
      const output = JSON.stringify([{ type: 'parent-child', issue: { id: 't-1', title: 'Task', status: 'open' } }]);
      const tasks = decodeTasksFromDepList(output, 'epic-1');
      expect(tasks[0].folder).toBe('');
      expect(tasks[0].origin).toBe('plan');
      expect(tasks[0].beadId).toBe('t-1');
    });
  });

  describe('decodeComments', () => {
    it('decodes comments with all fields', () => {
      const output = JSON.stringify([
        { id: 'c-1', body: 'Hello', author: 'user', timestamp: '2026-01-01T00:00:00Z', prompt: 'p', response: 'r' },
      ]);
      const comments = decodeComments(output, 'bd-1');
      expect(comments).toHaveLength(1);
      expect(comments[0]).toEqual({
        id: 'c-1',
        body: 'Hello',
        author: 'user',
        timestamp: '2026-01-01T00:00:00Z',
        prompt: 'p',
        response: 'r',
      });
    });

    it('maps text→body and created_at→timestamp', () => {
      const output = JSON.stringify([{ id: 1, text: 'Alt', created_at: '2026-01-01T00:00:00Z' }]);
      const comments = decodeComments(output, 'bd-1');
      expect(comments[0].body).toBe('Alt');
      expect(comments[0].timestamp).toBe('2026-01-01T00:00:00Z');
    });

    it('throws on missing id', () => {
      const output = JSON.stringify([{ body: 'No ID' }]);
      expect(() => decodeComments(output, 'bd-1')).toThrow(BeadGatewayError);
    });

    it('throws on non-array', () => {
      expect(() => decodeComments('{}', 'bd-1')).toThrow(BeadGatewayError);
    });

    it('throws on non-object item', () => {
      expect(() => decodeComments('["string"]', 'bd-1')).toThrow(BeadGatewayError);
    });
  });

  describe('decodeAuditLog', () => {
    it('decodes audit entries with snake_case→camelCase mapping', () => {
      const output = JSON.stringify([
        {
          id: 'a-1',
          kind: 'llm_call',
          issue_id: 'bd-1',
          model: 'gpt-4',
          tool_name: 't',
          exit_code: 0,
          error: 'e',
          timestamp: 'ts',
        },
      ]);
      const entries = decodeAuditLog(output, 'bd-1');
      expect(entries[0]).toEqual({
        id: 'a-1',
        kind: 'llm_call',
        issueId: 'bd-1',
        model: 'gpt-4',
        toolName: 't',
        exitCode: 0,
        error: 'e',
        timestamp: 'ts',
      });
    });

    it('returns empty array for []', () => {
      expect(decodeAuditLog('[]', 'bd-1')).toEqual([]);
    });
  });

  describe('decodeShowPayload', () => {
    it('unwraps single-element array', () => {
      const output = JSON.stringify([{ id: 'bd-1', description: 'test' }]);
      const result = decodeShowPayload(output, 'bd-1') as Record<string, unknown>;
      expect(result.id).toBe('bd-1');
    });

    it('returns object directly', () => {
      const output = JSON.stringify({ id: 'bd-1' });
      const result = decodeShowPayload(output, 'bd-1') as Record<string, unknown>;
      expect(result.id).toBe('bd-1');
    });

    it('returns multi-element array as-is', () => {
      const output = JSON.stringify([{ id: 'a' }, { id: 'b' }]);
      const result = decodeShowPayload(output, 'bd-1');
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('decodeIdFromJson', () => {
    it('extracts id', () => {
      expect(decodeIdFromJson('{"id":"abc-123"}', 'test')).toBe('abc-123');
    });

    it('throws on missing id', () => {
      expect(() => decodeIdFromJson('{"name":"x"}', 'test')).toThrow(BeadGatewayError);
    });

    it('throws on invalid JSON', () => {
      expect(() => decodeIdFromJson('bad', 'test')).toThrow(BeadGatewayError);
    });
  });

  describe('extractBeadContent', () => {
    it('extracts description from object', () => {
      expect(extractBeadContent({ description: 'hello' })).toBe('hello');
    });

    it('extracts from nested issue', () => {
      expect(extractBeadContent({ issue: { body: 'content' } })).toBe('content');
    });

    it('extracts from array', () => {
      expect(extractBeadContent([{ description: 'first' }])).toBe('first');
    });

    it('returns null for empty', () => {
      expect(extractBeadContent(null)).toBeNull();
      expect(extractBeadContent({})).toBeNull();
      expect(extractBeadContent('')).toBeNull();
      expect(extractBeadContent('   ')).toBeNull();
    });

    it('returns string directly', () => {
      expect(extractBeadContent('hello world')).toBe('hello world');
    });
  });
});
