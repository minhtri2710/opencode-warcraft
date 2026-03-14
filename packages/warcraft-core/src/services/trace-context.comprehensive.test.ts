import { describe, expect, it } from 'bun:test';
import { createChildSpan, createTraceContext } from './trace-context.js';

describe('trace-context comprehensive', () => {
  describe('createTraceContext properties', () => {
    it('has traceId', () => {
      const ctx = createTraceContext();
      expect(ctx.traceId.length).toBeGreaterThan(0);
    });

    it('has spanId', () => {
      const ctx = createTraceContext();
      expect(ctx.spanId.length).toBeGreaterThan(0);
    });

    it('traceId is unique per call', () => {
      const ids = new Set(Array.from({ length: 100 }, () => createTraceContext().traceId));
      expect(ids.size).toBe(100);
    });

    it('spanId is unique per call', () => {
      const ids = new Set(Array.from({ length: 100 }, () => createTraceContext().spanId));
      expect(ids.size).toBe(100);
    });

    it('accepts explicit traceId', () => {
      const ctx = createTraceContext('my-trace-id');
      expect(ctx.traceId).toBe('my-trace-id');
    });

    it('generates traceId when not provided', () => {
      const ctx = createTraceContext();
      expect(ctx.traceId).toBeDefined();
      expect(ctx.traceId.length).toBeGreaterThan(0);
    });
  });

  describe('createChildSpan', () => {
    it('child has same traceId as parent', () => {
      const parent = createTraceContext();
      const child = createChildSpan(parent);
      expect(child.traceId).toBe(parent.traceId);
    });

    it('child has different spanId', () => {
      const parent = createTraceContext();
      const child = createChildSpan(parent);
      expect(child.spanId).not.toBe(parent.spanId);
    });

    it('child has parentSpanId set to parent spanId', () => {
      const parent = createTraceContext();
      const child = createChildSpan(parent);
      expect(child.parentSpanId).toBe(parent.spanId);
    });

    it('grandchild has correct trace chain', () => {
      const root = createTraceContext();
      const child = createChildSpan(root);
      const grandchild = createChildSpan(child);
      expect(grandchild.traceId).toBe(root.traceId);
      expect(grandchild.parentSpanId).toBe(child.spanId);
    });

    it('100 children have unique spanIds', () => {
      const parent = createTraceContext();
      const ids = new Set(Array.from({ length: 100 }, () => createChildSpan(parent).spanId));
      expect(ids.size).toBe(100);
    });

    it('deep nesting preserves traceId', () => {
      let ctx = createTraceContext();
      const originalTraceId = ctx.traceId;
      for (let i = 0; i < 10; i++) {
        ctx = createChildSpan(ctx);
      }
      expect(ctx.traceId).toBe(originalTraceId);
    });
  });
});
