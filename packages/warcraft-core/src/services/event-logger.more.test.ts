import { describe, expect, it } from 'bun:test';
import {
  WARCRAFT_EVENT_TYPES,
  createNoopEventLogger,
  createEventLogger,
  computeTrustMetrics,
} from './event-logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('event-logger comprehensive', () => {
  describe('WARCRAFT_EVENT_TYPES', () => {
    it('is a non-empty array', () => {
      expect(WARCRAFT_EVENT_TYPES.length).toBeGreaterThan(0);
    });

    it('contains string elements', () => {
      for (const t of WARCRAFT_EVENT_TYPES) {
        expect(typeof t).toBe('string');
      }
    });

    it('contains dispatch', () => {
      expect(WARCRAFT_EVENT_TYPES).toContain('dispatch');
    });

    it('contains commit', () => {
      expect(WARCRAFT_EVENT_TYPES).toContain('commit');
    });

    it('contains merge', () => {
      expect(WARCRAFT_EVENT_TYPES).toContain('merge');
    });

    it('contains worktree_created', () => {
      expect(WARCRAFT_EVENT_TYPES).toContain('worktree_created');
    });

    it('contains blocked', () => {
      expect(WARCRAFT_EVENT_TYPES).toContain('blocked');
    });

    it('contains retry', () => {
      expect(WARCRAFT_EVENT_TYPES).toContain('retry');
    });
  });

  describe('createNoopEventLogger', () => {
    const logger = createNoopEventLogger();

    it('has emit method', () => {
      expect(typeof logger.emit).toBe('function');
    });

    it('has getLatestTraceContext method', () => {
      expect(typeof logger.getLatestTraceContext).toBe('function');
    });

    it('emit does not throw', () => {
      expect(() => logger.emit('dispatch', { featureName: 'test', taskFolder: '01-a' })).not.toThrow();
    });

    it('getLatestTraceContext does not throw', () => {
      expect(() => logger.getLatestTraceContext()).not.toThrow();
    });
  });

  describe('createEventLogger', () => {
    it('creates logger for valid path', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evlog-'));
      try {
        const logger = createEventLogger(tempDir);
        expect(logger).toBeDefined();
        expect(typeof logger.emit).toBe('function');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('computeTrustMetrics', () => {
    it('returns metrics for empty project', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-'));
      try {
        const metrics = computeTrustMetrics(tempDir);
        expect(metrics).toBeDefined();
        expect(metrics.reopenCount).toBe(0);
        expect(metrics.totalCompleted).toBe(0);
        expect(metrics.reopenRate).toBe(0);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('returns blockedMttrMs as null for empty project', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trust2-'));
      try {
        const metrics = computeTrustMetrics(tempDir);
        expect(metrics.blockedMttrMs).toBeNull();
        expect(metrics.duplicateDispatchPreventedCount).toBe(0);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
