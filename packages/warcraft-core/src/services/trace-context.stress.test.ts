import { describe, expect, it } from 'bun:test';
import { createTraceContext, createChildSpan } from './trace-context.js';

describe('trace-context stress', () => {
  it('deep nesting preserves root traceId', () => {
    let ctx = createTraceContext();
    const rootTraceId = ctx.traceId;
    for (let i = 0; i < 50; i++) {
      ctx = createChildSpan(ctx);
    }
    expect(ctx.traceId).toBe(rootTraceId);
  });

  it('parallel children all have unique spanIds', () => {
    const root = createTraceContext();
    const children = Array.from({ length: 100 }, () => createChildSpan(root));
    const ids = new Set(children.map((c) => c.spanId));
    expect(ids.size).toBe(100);
  });

  it('traceId format is consistent', () => {
    for (let i = 0; i < 20; i++) {
      const ctx = createTraceContext();
      expect(ctx.traceId.length).toBeGreaterThan(0);
      expect(ctx.spanId.length).toBeGreaterThan(0);
    }
  });

  it('child parentSpanId chain is correct', () => {
    const root = createTraceContext();
    const child1 = createChildSpan(root);
    const child2 = createChildSpan(child1);
    const child3 = createChildSpan(child2);
    expect(child1.parentSpanId).toBe(root.spanId);
    expect(child2.parentSpanId).toBe(child1.spanId);
    expect(child3.parentSpanId).toBe(child2.spanId);
  });

  it('sibling children have same parentSpanId', () => {
    const parent = createTraceContext();
    const a = createChildSpan(parent);
    const b = createChildSpan(parent);
    const c = createChildSpan(parent);
    expect(a.parentSpanId).toBe(parent.spanId);
    expect(b.parentSpanId).toBe(parent.spanId);
    expect(c.parentSpanId).toBe(parent.spanId);
  });

  it('custom traceId propagates to children', () => {
    const root = createTraceContext('my-custom-id');
    const child = createChildSpan(root);
    expect(child.traceId).toBe('my-custom-id');
  });

  it('100 roots all have different traceIds', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createTraceContext().traceId));
    expect(ids.size).toBe(100);
  });
});
