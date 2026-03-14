import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { computeTrustMetrics, createEventLogger } from './event-logger.js';

const TEST_DIR = path.join(os.tmpdir(), `event-logger-extra-${process.pid}`);

beforeEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
  fs.mkdirSync(path.join(TEST_DIR, '.beads'), { recursive: true });
});

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true });
});

describe('EventLogger extra edge cases', () => {
  it('preserves custom timestamp when provided', () => {
    const logger = createEventLogger(TEST_DIR);
    const customTs = '2020-01-01T00:00:00Z';
    logger.emit({ type: 'dispatch', feature: 'f', task: 't', timestamp: customTs });

    const logFile = path.join(TEST_DIR, '.beads', 'events.jsonl');
    const line = JSON.parse(fs.readFileSync(logFile, 'utf-8').trim());
    expect(line.timestamp).toBe(customTs);
  });

  it('getLatestTraceContext returns null for different task', () => {
    const logger = createEventLogger(TEST_DIR);
    logger.emit({ type: 'dispatch', feature: 'f', task: 't1', traceId: 'tr', spanId: 'sp' });
    expect(logger.getLatestTraceContext?.('f', 't2')).toBeNull();
  });

  it('getLatestTraceContext returns null for different feature', () => {
    const logger = createEventLogger(TEST_DIR);
    logger.emit({ type: 'dispatch', feature: 'f1', task: 't', traceId: 'tr', spanId: 'sp' });
    expect(logger.getLatestTraceContext?.('f2', 't')).toBeNull();
  });

  it('getLatestTraceContext returns null when log file does not exist', () => {
    const freshDir = path.join(TEST_DIR, 'fresh');
    const logger = createEventLogger(freshDir);
    expect(logger.getLatestTraceContext?.('f', 't')).toBeNull();
  });

  it('getLatestTraceContext skips events without traceId', () => {
    const logger = createEventLogger(TEST_DIR);
    logger.emit({ type: 'dispatch', feature: 'f', task: 't' });
    logger.emit({ type: 'dispatch', feature: 'f', task: 't', traceId: 'tr', spanId: 'sp' });
    logger.emit({ type: 'commit', feature: 'f', task: 't' }); // no trace

    const ctx = logger.getLatestTraceContext?.('f', 't');
    // Should find the second event (last one with trace context)
    expect(ctx).not.toBeNull();
    expect(ctx!.traceId).toBe('tr');
    expect(ctx!.spanId).toBe('sp');
  });

  it('getLatestTraceContext omits parentSpanId when not present', () => {
    const logger = createEventLogger(TEST_DIR);
    logger.emit({ type: 'dispatch', feature: 'f', task: 't', traceId: 'tr', spanId: 'sp' });
    const ctx = logger.getLatestTraceContext?.('f', 't');
    expect(ctx).not.toBeNull();
    expect(ctx!.parentSpanId).toBeUndefined();
  });
});

describe('computeTrustMetrics extra edge cases', () => {
  it('handles only dispatch events (no commits)', () => {
    const logger = createEventLogger(TEST_DIR);
    logger.emit({ type: 'dispatch', feature: 'f', task: 't1' });
    logger.emit({ type: 'dispatch', feature: 'f', task: 't2' });

    const metrics = computeTrustMetrics(TEST_DIR);
    expect(metrics.totalCompleted).toBe(0);
    expect(metrics.reopenCount).toBe(0);
    expect(metrics.blockedMttrMs).toBeNull();
  });

  it('does not count non-completed commits', () => {
    const logger = createEventLogger(TEST_DIR);
    logger.emit({ type: 'commit', feature: 'f', task: 't1', details: { status: 'in_progress' } });
    logger.emit({ type: 'commit', feature: 'f', task: 't2', details: {} });

    const metrics = computeTrustMetrics(TEST_DIR);
    expect(metrics.totalCompleted).toBe(0);
  });

  it('handles blocked task resolved by non-completed commit', () => {
    const logger = createEventLogger(TEST_DIR);
    logger.emit({ type: 'blocked', feature: 'f', task: 't1', timestamp: '2026-01-01T10:00:00Z' });
    logger.emit({ type: 'commit', feature: 'f', task: 't1', timestamp: '2026-01-01T10:30:00Z', details: { status: 'in_progress' } });

    const metrics = computeTrustMetrics(TEST_DIR);
    // Should still count MTTR even if commit is not "completed"
    expect(metrics.blockedMttrMs).toBe(1800000);
  });

  it('handles multiple reopen events', () => {
    const logger = createEventLogger(TEST_DIR);
    logger.emit({ type: 'commit', feature: 'f', task: 't1', details: { status: 'completed' } });
    logger.emit({ type: 'reopen', feature: 'f', task: 't1' });
    logger.emit({ type: 'reopen', feature: 'f', task: 't1' });

    const metrics = computeTrustMetrics(TEST_DIR);
    expect(metrics.reopenCount).toBe(2);
    expect(metrics.reopenRate).toBe(2);
  });
});
