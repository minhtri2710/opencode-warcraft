import { describe, expect, it } from 'bun:test';
import { BeadGatewayError } from './BeadGateway.types.js';
import {
  decodeAuditLog,
  decodeComments,
  decodeDependentIssues,
  decodeIdFromJson,
  decodeListItems,
  decodeShowPayload,
  extractBeadContent,
} from './beadDecoders.js';

describe('beadDecoders extra edge cases', () => {
  describe('decodeListItems', () => {
    it('handles envelope with results key', () => {
      const output = JSON.stringify({ results: [{ id: 'bd-1', title: 'T', status: 'open' }] });
      const items = decodeListItems(output, 'test');
      expect(items).toHaveLength(1);
    });

    it('handles envelope with items key', () => {
      const output = JSON.stringify({ items: [{ id: 'bd-1', title: 'T', status: 'open' }] });
      const items = decodeListItems(output, 'test');
      expect(items).toHaveLength(1);
    });

    it('handles envelope with data key', () => {
      const output = JSON.stringify({ data: [{ id: 'bd-1', title: 'T', status: 'open' }] });
      const items = decodeListItems(output, 'test');
      expect(items).toHaveLength(1);
    });

    it('returns empty for envelope with no recognized keys', () => {
      const output = JSON.stringify({ unknown: [{ id: 'bd-1' }] });
      const items = decodeListItems(output, 'test');
      expect(items).toEqual([]);
    });

    it('maps type field from type when issue_type absent', () => {
      const output = JSON.stringify([{ id: 'bd-1', title: 'T', status: 'open', type: 'epic' }]);
      const items = decodeListItems(output, 'test');
      expect(items[0].type).toBe('epic');
    });

    it('prefers issue_type over type', () => {
      const output = JSON.stringify([{ id: 'bd-1', title: 'T', status: 'open', issue_type: 'task', type: 'epic' }]);
      const items = decodeListItems(output, 'test');
      expect(items[0].type).toBe('task');
    });

    it('handles items with missing fields gracefully', () => {
      const output = JSON.stringify([{ id: 'bd-1' }]);
      const items = decodeListItems(output, 'test');
      expect(items[0].title).toBe('');
      expect(items[0].status).toBe('');
      expect(items[0].type).toBeUndefined();
    });
  });

  describe('decodeDependentIssues', () => {
    it('handles envelope with dependencies key', () => {
      const output = JSON.stringify({
        dependencies: [{ type: 'parent-child', id: 't-1', title: 'T', status: 'open' }],
      });
      const items = decodeDependentIssues(output, 'test');
      expect(items).toHaveLength(1);
    });

    it('handles dependent, target, child, and to keys as embedded issue', () => {
      for (const key of ['dependent', 'target', 'child', 'to']) {
        const output = JSON.stringify([
          { type: 'parent-child', [key]: { id: `via-${key}`, title: 'T', status: 'open' } },
        ]);
        const items = decodeDependentIssues(output, 'test');
        expect(items[0].id).toBe(`via-${key}`);
      }
    });

    it('accepts all items when no relation type filter specified', () => {
      const output = JSON.stringify([
        { type: 'blocks', id: 't-1', title: 'A', status: 'open' },
        { type: 'parent-child', id: 't-2', title: 'B', status: 'open' },
      ]);
      // Default acceptedRelationType is 'parent-child'
      const items = decodeDependentIssues(output, 'test');
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('t-2');
    });
  });

  describe('decodeComments', () => {
    it('handles comment with only id and body', () => {
      const output = JSON.stringify([{ id: 'c-1', body: 'Hello' }]);
      const comments = decodeComments(output, 'bd-1');
      expect(comments[0].author).toBeUndefined();
      expect(comments[0].timestamp).toBeUndefined();
      expect(comments[0].prompt).toBeUndefined();
      expect(comments[0].response).toBeUndefined();
    });
  });

  describe('decodeAuditLog', () => {
    it('handles entry with only required fields', () => {
      const output = JSON.stringify([{ id: 'a-1', kind: 'tool_use', issue_id: 'bd-1' }]);
      const entries = decodeAuditLog(output, 'bd-1');
      expect(entries[0].model).toBeUndefined();
      expect(entries[0].toolName).toBeUndefined();
      expect(entries[0].exitCode).toBeUndefined();
      expect(entries[0].error).toBeUndefined();
      expect(entries[0].timestamp).toBeUndefined();
    });
  });

  describe('decodeShowPayload', () => {
    it('returns empty array as-is', () => {
      const result = decodeShowPayload('[]', 'bd-1');
      expect(Array.isArray(result)).toBe(true);
      expect((result as unknown[]).length).toBe(0);
    });

    it('throws on invalid JSON', () => {
      expect(() => decodeShowPayload('not json', 'bd-1')).toThrow(BeadGatewayError);
    });
  });

  describe('extractBeadContent', () => {
    it('extracts content field', () => {
      expect(extractBeadContent({ content: 'Content value' })).toBe('Content value');
    });

    it('prefers description over body over content', () => {
      expect(extractBeadContent({ content: 'C', body: 'B', description: 'D' })).toBe('D');
    });

    it('returns null for array of empty objects', () => {
      expect(extractBeadContent([{}, {}])).toBeNull();
    });

    it('extracts from nested data key', () => {
      expect(extractBeadContent({ data: { description: 'Nested' } })).toBe('Nested');
    });

    it('extracts from nested results key', () => {
      expect(extractBeadContent({ results: [{ body: 'Found' }] })).toBe('Found');
    });

    it('returns null for number input', () => {
      expect(extractBeadContent(42)).toBeNull();
    });

    it('returns null for boolean input', () => {
      expect(extractBeadContent(true)).toBeNull();
    });
  });
});
