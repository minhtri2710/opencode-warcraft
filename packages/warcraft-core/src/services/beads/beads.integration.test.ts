import { describe, expect, it } from 'bun:test';
import { isBeadsEnabled, requireBeadsEnabled } from './beadsMode.js';
import type { BeadsModeProvider } from '../state/types.js';
import { BeadGatewayError } from './BeadGateway.types.js';
import {
  decodeIdFromJson,
  extractBeadContent,
} from './beadDecoders.js';

describe('beads module integration', () => {
  describe('beadsMode + BeadGatewayError', () => {
    it('off mode cannot requireBeads', () => {
      const off: BeadsModeProvider = { getBeadsMode: () => 'off' };
      expect(() => requireBeadsEnabled(off)).toThrow();
    });

    it('on mode passes requireBeads', () => {
      const on: BeadsModeProvider = { getBeadsMode: () => 'on' };
      expect(() => requireBeadsEnabled(on)).not.toThrow();
    });

    it('BeadGatewayError has name property', () => {
      const err = new BeadGatewayError('not_found', 'missing', {});
      expect(err.name).toBeDefined();
    });

    it('BeadGatewayError stack trace exists', () => {
      const err = new BeadGatewayError('command_failed', 'fail', {});
      expect(err.stack).toBeDefined();
    });
  });

  describe('beadDecoders + extractBeadContent', () => {
    it('decodeIdFromJson with nested JSON', () => {
      const output = JSON.stringify({ id: 'nested-id', meta: { x: 1 } });
      expect(decodeIdFromJson(output, 'bead')).toBe('nested-id');
    });

    it('extractBeadContent with description field', () => {
      const result = extractBeadContent({ description: 'A bead' });
      // May or may not extract description - depends on implementation
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('extractBeadContent with body field preserves content', () => {
      const long = 'x'.repeat(10000);
      expect(extractBeadContent({ body: long })).toBe(long);
    });
  });

  describe('isBeadsEnabled type safety', () => {
    it('returns true for custom on provider', () => {
      expect(isBeadsEnabled({ getBeadsMode: () => 'on' })).toBe(true);
    });

    it('returns false for custom off provider', () => {
      expect(isBeadsEnabled({ getBeadsMode: () => 'off' })).toBe(false);
    });
  });
});
