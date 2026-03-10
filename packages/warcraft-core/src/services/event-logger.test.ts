import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WarcraftEvent } from './event-logger.js';
import { computeTrustMetrics, createEventLogger, createNoopEventLogger, WARCRAFT_EVENT_TYPES } from './event-logger.js';

const TEST_DIR = path.join(os.tmpdir(), `warcraft-event-logger-test-${process.pid}`);
const LOG_FILE = path.join(TEST_DIR, '.beads', 'events.jsonl');

describe('EventLogger', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(TEST_DIR, '.beads'), { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe('WARCRAFT_EVENT_TYPES', () => {
    it('defines expected event types including trust metric types', () => {
      expect(WARCRAFT_EVENT_TYPES).toContain('dispatch');
      expect(WARCRAFT_EVENT_TYPES).toContain('commit');
      expect(WARCRAFT_EVENT_TYPES).toContain('merge');
      expect(WARCRAFT_EVENT_TYPES).toContain('blocked');
      expect(WARCRAFT_EVENT_TYPES).toContain('prompt_prepared');
      expect(WARCRAFT_EVENT_TYPES).toContain('worktree_created');
      expect(WARCRAFT_EVENT_TYPES).toContain('worktree_removed');
      expect(WARCRAFT_EVENT_TYPES).toContain('verification_run');
      expect(WARCRAFT_EVENT_TYPES).toContain('retry');
      expect(WARCRAFT_EVENT_TYPES).toContain('degraded');
      // Trust metric event types
      expect(WARCRAFT_EVENT_TYPES).toContain('reopen');
      expect(WARCRAFT_EVENT_TYPES).toContain('prune');
      expect(WARCRAFT_EVENT_TYPES).toContain('duplicate_dispatch_prevented');
    });
  });

  describe('createEventLogger()', () => {
    it('writes a JSONL line for each event', () => {
      const logger = createEventLogger(TEST_DIR);

      logger.emit({
        type: 'dispatch',
        feature: 'my-feature',
        task: '01-setup',
      });

      expect(fs.existsSync(LOG_FILE)).toBe(true);
      const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]) as WarcraftEvent;
      expect(parsed.type).toBe('dispatch');
      expect(parsed.feature).toBe('my-feature');
      expect(parsed.task).toBe('01-setup');
      expect(parsed.timestamp).toBeDefined();
    });

    it('appends multiple events to the same file', () => {
      const logger = createEventLogger(TEST_DIR);

      logger.emit({ type: 'dispatch', feature: 'f', task: 't1' });
      logger.emit({ type: 'commit', feature: 'f', task: 't1' });
      logger.emit({ type: 'merge', feature: 'f', task: 't1' });

      const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).type).toBe('dispatch');
      expect(JSON.parse(lines[1]).type).toBe('commit');
      expect(JSON.parse(lines[2]).type).toBe('merge');
    });

    it('includes optional details in event', () => {
      const logger = createEventLogger(TEST_DIR);

      logger.emit({
        type: 'blocked',
        feature: 'f',
        task: 't1',
        details: { reason: 'dependency not met', blocker: '01-base' },
      });

      const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
      const parsed = JSON.parse(lines[0]);
      expect(parsed.details.reason).toBe('dependency not met');
      expect(parsed.details.blocker).toBe('01-base');
    });

    it('persists trace context fields with the event', () => {
      const logger = createEventLogger(TEST_DIR);

      logger.emit({
        type: 'dispatch',
        feature: 'f',
        task: 't1',
        traceId: 'trace-1',
        spanId: 'span-1',
        parentSpanId: 'span-0',
      });

      const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
      const parsed = JSON.parse(lines[0]) as WarcraftEvent;
      expect(parsed.traceId).toBe('trace-1');
      expect(parsed.spanId).toBe('span-1');
      expect(parsed.parentSpanId).toBe('span-0');
    });

    it('can emit reopen events', () => {
      const logger = createEventLogger(TEST_DIR);

      logger.emit({
        type: 'reopen',
        feature: 'f',
        task: 't1',
        details: { previousStatus: 'done', newStatus: 'in_progress' },
      });

      const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe('reopen');
      expect(parsed.details.previousStatus).toBe('done');
    });

    it('can emit duplicate_dispatch_prevented events', () => {
      const logger = createEventLogger(TEST_DIR);

      logger.emit({
        type: 'duplicate_dispatch_prevented',
        feature: 'f',
        task: 't1',
        details: { existingStatus: 'in_progress' },
      });

      const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe('duplicate_dispatch_prevented');
    });

    it('can emit prune events', () => {
      const logger = createEventLogger(TEST_DIR);

      logger.emit({
        type: 'prune',
        feature: 'f',
        task: '',
        details: { dryRun: true, staleCount: 3 },
      });

      const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe('prune');
      expect(parsed.details.dryRun).toBe(true);
    });

    it('creates parent directory if it does not exist', () => {
      const freshDir = path.join(TEST_DIR, 'fresh-project');
      const logger = createEventLogger(freshDir);

      logger.emit({ type: 'dispatch', feature: 'f', task: 't' });

      const freshLogFile = path.join(freshDir, '.beads', 'events.jsonl');
      expect(fs.existsSync(freshLogFile)).toBe(true);
    });

    it('does not throw on write failure (best-effort)', () => {
      const logger = createEventLogger('/dev/null/impossible');

      expect(() => logger.emit({ type: 'dispatch', feature: 'f', task: 't' })).not.toThrow();
    });
  });

  describe('createNoopEventLogger()', () => {
    it('does nothing on emit', () => {
      const logger = createNoopEventLogger();
      expect(() => logger.emit({ type: 'dispatch', feature: 'f', task: 't' })).not.toThrow();
      // No file should be created
      expect(fs.existsSync(LOG_FILE)).toBe(false);
    });

    it('returns null when trace context is requested', () => {
      const logger = createNoopEventLogger();

      expect(logger.getLatestTraceContext?.('f', 't')).toBeNull();
    });
  });

  describe('getLatestTraceContext()', () => {
    it('returns the most recent trace context for a task', () => {
      const logger = createEventLogger(TEST_DIR);

      logger.emit({ type: 'dispatch', feature: 'f', task: 't1', traceId: 'trace-1', spanId: 'span-1' });
      logger.emit({
        type: 'commit',
        feature: 'f',
        task: 't1',
        traceId: 'trace-1',
        spanId: 'span-2',
        parentSpanId: 'span-1',
      });
      logger.emit({ type: 'dispatch', feature: 'f', task: 't2', traceId: 'trace-2', spanId: 'span-3' });

      expect(logger.getLatestTraceContext?.('f', 't1')).toEqual({
        traceId: 'trace-1',
        spanId: 'span-2',
        parentSpanId: 'span-1',
      });
    });

    it('returns null when the task has no trace context yet', () => {
      const logger = createEventLogger(TEST_DIR);

      logger.emit({ type: 'dispatch', feature: 'f', task: 't1' });

      expect(logger.getLatestTraceContext?.('f', 't1')).toBeNull();
    });
  });

  describe('computeTrustMetrics()', () => {
    it('returns zero defaults when no log file exists', () => {
      const freshDir = path.join(TEST_DIR, 'empty-project');
      const metrics = computeTrustMetrics(freshDir);

      expect(metrics.reopenCount).toBe(0);
      expect(metrics.totalCompleted).toBe(0);
      expect(metrics.reopenRate).toBe(0);
      expect(metrics.blockedMttrMs).toBeNull();
      expect(metrics.duplicateDispatchPreventedCount).toBe(0);
      expect(metrics.pruneDryRunCount).toBe(0);
      expect(metrics.pruneConfirmedCount).toBe(0);
      expect(metrics.pruneAcceptanceRate).toBe(0);
    });

    it('counts reopen events and calculates reopen rate', () => {
      const logger = createEventLogger(TEST_DIR);

      // 3 completed tasks
      logger.emit({ type: 'commit', feature: 'f', task: 't1', details: { status: 'completed' } });
      logger.emit({ type: 'commit', feature: 'f', task: 't2', details: { status: 'completed' } });
      logger.emit({ type: 'commit', feature: 'f', task: 't3', details: { status: 'completed' } });

      // 1 reopen
      logger.emit({ type: 'reopen', feature: 'f', task: 't1', details: { previousStatus: 'done' } });

      const metrics = computeTrustMetrics(TEST_DIR);
      expect(metrics.reopenCount).toBe(1);
      expect(metrics.totalCompleted).toBe(3);
      expect(metrics.reopenRate).toBeCloseTo(1 / 3);
    });

    it('calculates blocked-task MTTR from blocked/commit pairs', () => {
      const logger = createEventLogger(TEST_DIR);

      const blockedTime = '2026-03-06T10:00:00.000Z';
      const resolvedTime = '2026-03-06T10:30:00.000Z';

      logger.emit({
        type: 'blocked',
        feature: 'f',
        task: 't1',
        timestamp: blockedTime,
      });
      logger.emit({
        type: 'commit',
        feature: 'f',
        task: 't1',
        timestamp: resolvedTime,
        details: { status: 'completed' },
      });

      const metrics = computeTrustMetrics(TEST_DIR);
      // 30 minutes = 1800000ms
      expect(metrics.blockedMttrMs).toBe(1800000);
    });

    it('averages MTTR across multiple blocked tasks', () => {
      const logger = createEventLogger(TEST_DIR);

      // Task 1: blocked for 10 minutes
      logger.emit({
        type: 'blocked',
        feature: 'f',
        task: 't1',
        timestamp: '2026-03-06T10:00:00.000Z',
      });
      logger.emit({
        type: 'commit',
        feature: 'f',
        task: 't1',
        timestamp: '2026-03-06T10:10:00.000Z',
        details: { status: 'completed' },
      });

      // Task 2: blocked for 20 minutes
      logger.emit({
        type: 'blocked',
        feature: 'f',
        task: 't2',
        timestamp: '2026-03-06T11:00:00.000Z',
      });
      logger.emit({
        type: 'commit',
        feature: 'f',
        task: 't2',
        timestamp: '2026-03-06T11:20:00.000Z',
        details: { status: 'completed' },
      });

      const metrics = computeTrustMetrics(TEST_DIR);
      // Average of 600000ms (10min) and 1200000ms (20min) = 900000ms (15min)
      expect(metrics.blockedMttrMs).toBe(900000);
    });

    it('counts duplicate dispatch prevented events', () => {
      const logger = createEventLogger(TEST_DIR);

      logger.emit({ type: 'duplicate_dispatch_prevented', feature: 'f', task: 't1' });
      logger.emit({ type: 'duplicate_dispatch_prevented', feature: 'f', task: 't2' });
      logger.emit({ type: 'duplicate_dispatch_prevented', feature: 'f', task: 't1' });

      const metrics = computeTrustMetrics(TEST_DIR);
      expect(metrics.duplicateDispatchPreventedCount).toBe(3);
    });

    it('calculates prune acceptance rate', () => {
      const logger = createEventLogger(TEST_DIR);

      // 4 dry-runs, 2 confirmed
      logger.emit({ type: 'prune', feature: 'f', task: '', details: { dryRun: true } });
      logger.emit({ type: 'prune', feature: 'f', task: '', details: { dryRun: true } });
      logger.emit({ type: 'prune', feature: 'f', task: '', details: { confirmed: true } });
      logger.emit({ type: 'prune', feature: 'f', task: '', details: { dryRun: true } });
      logger.emit({ type: 'prune', feature: 'f', task: '', details: { confirmed: true } });
      logger.emit({ type: 'prune', feature: 'f', task: '', details: { dryRun: true } });

      const metrics = computeTrustMetrics(TEST_DIR);
      expect(metrics.pruneDryRunCount).toBe(4);
      expect(metrics.pruneConfirmedCount).toBe(2);
      expect(metrics.pruneAcceptanceRate).toBeCloseTo(0.5);
    });

    it('handles malformed JSONL lines gracefully', () => {
      // Write valid + invalid lines
      const logFile = path.join(TEST_DIR, '.beads', 'events.jsonl');
      fs.appendFileSync(
        logFile,
        '{"type":"commit","feature":"f","task":"t1","timestamp":"2026-01-01T00:00:00Z","details":{"status":"completed"}}\n',
      );
      fs.appendFileSync(logFile, 'NOT VALID JSON\n');
      fs.appendFileSync(logFile, '{"type":"reopen","feature":"f","task":"t1","timestamp":"2026-01-02T00:00:00Z"}\n');

      const metrics = computeTrustMetrics(TEST_DIR);
      expect(metrics.totalCompleted).toBe(1);
      expect(metrics.reopenCount).toBe(1);
    });

    it('returns zero reopen rate when no completions exist', () => {
      const logger = createEventLogger(TEST_DIR);
      logger.emit({ type: 'reopen', feature: 'f', task: 't1' });

      const metrics = computeTrustMetrics(TEST_DIR);
      expect(metrics.reopenRate).toBe(0);
    });

    it('returns zero prune acceptance rate when no dry-runs exist', () => {
      const logger = createEventLogger(TEST_DIR);
      logger.emit({ type: 'prune', feature: 'f', task: '', details: { confirmed: true } });

      const metrics = computeTrustMetrics(TEST_DIR);
      expect(metrics.pruneAcceptanceRate).toBe(0);
    });
  });
});
