import { describe, expect, it } from 'bun:test';
import { createTraceContext, createChildSpan, type TraceContext } from './trace-context.js';

describe('trace-context deep validation', () => {
  describe('createTraceContext', () => {
    it('generates unique traceIds', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(createTraceContext().traceId);
      }
      expect(ids.size).toBe(100);
    });

    it('traceId has expected format', () => {
      const ctx = createTraceContext();
      expect(ctx.traceId).toMatch(/^[a-f0-9-]+$/);
    });

    it('spanId is defined', () => {
      const ctx = createTraceContext();
      expect(ctx.spanId).toBeDefined();
      expect(ctx.spanId.length).toBeGreaterThan(0);
    });

    it('spanId has expected format', () => {
      const ctx = createTraceContext();
      expect(ctx.spanId).toMatch(/^[a-f0-9-]+$/);
    });

    it('custom traceId is preserved', () => {
      const ctx = createTraceContext('custom-trace-id');
      expect(ctx.traceId).toBe('custom-trace-id');
    });

    it('parentSpanId is undefined for root', () => {
      const ctx = createTraceContext();
      expect(ctx.parentSpanId).toBeUndefined();
    });
  });

  describe('createChildSpan', () => {
    it('inherits traceId from parent', () => {
      const parent = createTraceContext();
      const child = createChildSpan(parent);
      expect(child.traceId).toBe(parent.traceId);
    });

    it('has different spanId from parent', () => {
      const parent = createTraceContext();
      const child = createChildSpan(parent);
      expect(child.spanId).not.toBe(parent.spanId);
    });

    it('parentSpanId equals parent spanId', () => {
      const parent = createTraceContext();
      const child = createChildSpan(parent);
      expect(child.parentSpanId).toBe(parent.spanId);
    });

    it('grandchild inherits same traceId', () => {
      const root = createTraceContext();
      const child = createChildSpan(root);
      const grandchild = createChildSpan(child);
      expect(grandchild.traceId).toBe(root.traceId);
    });

    it('grandchild parentSpanId is child spanId', () => {
      const root = createTraceContext();
      const child = createChildSpan(root);
      const grandchild = createChildSpan(child);
      expect(grandchild.parentSpanId).toBe(child.spanId);
    });

    it('all spans have unique spanIds', () => {
      const root = createTraceContext();
      const children = Array.from({ length: 10 }, () => createChildSpan(root));
      const ids = new Set(children.map((c) => c.spanId));
      expect(ids.size).toBe(10);
    });
  });
});
