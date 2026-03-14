import { describe, expect, it } from 'bun:test';
import {
  decodeListItems,
  decodeIdFromJson,
  extractBeadContent,
} from './beadDecoders.js';

describe('beadDecoders more scenarios', () => {
  describe('decodeListItems', () => {
    it('throws for empty string', () => {
      expect(() => decodeListItems('', 'target')).toThrow();
    });

    it('throws for non-JSON output', () => {
      expect(() => decodeListItems('random text', 'target')).toThrow();
    });

    it('parses valid JSON array', () => {
      const output = JSON.stringify([{ id: 'item-1', title: 'Test' }]);
      const result = decodeListItems(output, 'target');
      expect(result).toHaveLength(1);
    });
  });

  describe('decodeIdFromJson', () => {
    it('extracts ID from JSON output', () => {
      const output = JSON.stringify({ id: 'bead-123' });
      const result = decodeIdFromJson(output, 'bead');
      expect(result).toBe('bead-123');
    });

    it('throws for invalid JSON', () => {
      expect(() => decodeIdFromJson('not json', 'bead')).toThrow();
    });
  });

  describe('extractBeadContent', () => {
    it('returns null for null payload', () => {
      expect(extractBeadContent(null)).toBeNull();
    });

    it('returns null for undefined payload', () => {
      expect(extractBeadContent(undefined)).toBeNull();
    });

    it('extracts body from payload with body field', () => {
      const result = extractBeadContent({ body: 'Hello content' });
      expect(result).toBe('Hello content');
    });

    it('returns null for empty object', () => {
      expect(extractBeadContent({})).toBeNull();
    });

    it('returns null for number', () => {
      expect(extractBeadContent(42)).toBeNull();
    });

    it('returns null for array', () => {
      expect(extractBeadContent([])).toBeNull();
    });
  });
});
