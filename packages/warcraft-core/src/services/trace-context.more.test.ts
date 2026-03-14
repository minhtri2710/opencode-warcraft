import { describe, expect, it } from 'bun:test';
import { createChildSpan, createTraceContext } from './trace-context.js';

describe('trace-context more scenarios', () => {
  it('createTraceContext generates unique traceIds', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(createTraceContext().traceId);
    }
    expect(ids.size).toBe(100);
  });

  it('createTraceContext generates unique spanIds', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(createTraceContext().spanId);
    }
    expect(ids.size).toBe(50);
  });

  it('createTraceContext with explicit traceId uses it', () => {
    const ctx = createTraceContext('my-trace-id');
    expect(ctx.traceId).toBe('my-trace-id');
  });

  it('createTraceContext without traceId generates UUID', () => {
    const ctx = createTraceContext();
    expect(ctx.traceId).toMatch(/^[0-9a-f-]+$/);
  });

  it('createTraceContext has no parentSpanId', () => {
    const ctx = createTraceContext();
    expect(ctx.parentSpanId).toBeUndefined();
  });

  it('createChildSpan preserves parent traceId', () => {
    const parent = createTraceContext();
    const child = createChildSpan(parent);
    expect(child.traceId).toBe(parent.traceId);
  });

  it('createChildSpan sets parentSpanId to parent spanId', () => {
    const parent = createTraceContext();
    const child = createChildSpan(parent);
    expect(child.parentSpanId).toBe(parent.spanId);
  });

  it('createChildSpan generates new spanId', () => {
    const parent = createTraceContext();
    const child = createChildSpan(parent);
    expect(child.spanId).not.toBe(parent.spanId);
  });

  it('chain of child spans preserves root traceId', () => {
    const root = createTraceContext();
    const child1 = createChildSpan(root);
    const child2 = createChildSpan(child1);
    const child3 = createChildSpan(child2);
    expect(child3.traceId).toBe(root.traceId);
    expect(child3.parentSpanId).toBe(child2.spanId);
  });

  it('sibling spans share traceId but differ in spanId', () => {
    const parent = createTraceContext();
    const a = createChildSpan(parent);
    const b = createChildSpan(parent);
    expect(a.traceId).toBe(b.traceId);
    expect(a.spanId).not.toBe(b.spanId);
    expect(a.parentSpanId).toBe(b.parentSpanId);
  });
});
