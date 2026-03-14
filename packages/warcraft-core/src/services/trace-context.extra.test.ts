import { describe, expect, it } from 'bun:test';
import { createTraceContext, createChildSpan } from './trace-context.js';

describe('trace-context extra edge cases', () => {
  it('createTraceContext generates unique traceIds', () => {
    const ctx1 = createTraceContext();
    const ctx2 = createTraceContext();
    expect(ctx1.traceId).not.toBe(ctx2.traceId);
  });

  it('createTraceContext generates unique spanIds', () => {
    const ctx1 = createTraceContext();
    const ctx2 = createTraceContext();
    expect(ctx1.spanId).not.toBe(ctx2.spanId);
  });

  it('createTraceContext has no parentSpanId by default', () => {
    const ctx = createTraceContext();
    expect(ctx.parentSpanId).toBeUndefined();
  });

  it('createTraceContext uses provided traceId', () => {
    const ctx = createTraceContext('my-trace');
    expect(ctx.traceId).toBe('my-trace');
  });

  it('createTraceContext generates traceId of UUID format', () => {
    const ctx = createTraceContext();
    // UUID v4 format with dashes
    expect(ctx.traceId).toMatch(/^[a-f0-9-]+$/);
    expect(ctx.traceId.length).toBeGreaterThan(0);
  });

  it('createChildSpan preserves traceId', () => {
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

  it('chaining multiple children preserves traceId', () => {
    const root = createTraceContext();
    const child1 = createChildSpan(root);
    const child2 = createChildSpan(child1);
    const child3 = createChildSpan(child2);
    expect(child3.traceId).toBe(root.traceId);
    expect(child3.parentSpanId).toBe(child2.spanId);
  });

  it('sibling children have different spanIds', () => {
    const parent = createTraceContext();
    const sibling1 = createChildSpan(parent);
    const sibling2 = createChildSpan(parent);
    expect(sibling1.spanId).not.toBe(sibling2.spanId);
    expect(sibling1.parentSpanId).toBe(sibling2.parentSpanId);
  });
});
