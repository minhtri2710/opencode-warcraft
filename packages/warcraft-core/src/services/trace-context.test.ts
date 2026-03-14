import { describe, expect, it } from 'bun:test';
import { createChildSpan, createTraceContext } from './trace-context.js';

describe('createTraceContext', () => {
  it('creates a root trace context with generated ids', () => {
    const trace = createTraceContext();

    expect(trace.traceId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(trace.spanId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(trace.parentSpanId).toBeUndefined();
  });

  it('reuses a provided trace id', () => {
    const trace = createTraceContext('trace-root');

    expect(trace.traceId).toBe('trace-root');
    expect(trace.spanId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(trace.parentSpanId).toBeUndefined();
  });
});

describe('createChildSpan', () => {
  it('creates a child span on the same trace', () => {
    const parent = createTraceContext('trace-root');
    const child = createChildSpan(parent);

    expect(child.traceId).toBe('trace-root');
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.spanId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(child.spanId).not.toBe(parent.spanId);
  });

  it('chains multiple child spans', () => {
    const root = createTraceContext('trace-1');
    const child1 = createChildSpan(root);
    const child2 = createChildSpan(child1);

    expect(child2.traceId).toBe('trace-1');
    expect(child2.parentSpanId).toBe(child1.spanId);
    expect(child2.spanId).not.toBe(child1.spanId);
  });
});
