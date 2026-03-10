import { randomUUID } from 'crypto';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export function createTraceContext(traceId?: string): TraceContext {
  return {
    traceId: traceId ?? randomUUID(),
    spanId: randomUUID(),
  };
}

export function createChildSpan(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: randomUUID(),
    parentSpanId: parent.spanId,
  };
}
