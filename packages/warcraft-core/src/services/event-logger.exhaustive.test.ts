import { describe, expect, it } from 'bun:test';
import {
  WARCRAFT_EVENT_TYPES,
  createNoopEventLogger,
  createEventLogger,
  computeTrustMetrics,
  type WarcraftEventType,
} from './event-logger.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('event-logger exhaustive', () => {
  describe('all event types are valid strings', () => {
    for (const type of WARCRAFT_EVENT_TYPES) {
      it(`event type "${type}" is non-empty string`, () => {
        expect(typeof type).toBe('string');
        expect(type.length).toBeGreaterThan(0);
      });
    }
  });

  describe('noop logger event emission', () => {
    const logger = createNoopEventLogger();

    for (const type of WARCRAFT_EVENT_TYPES) {
      it(`emitting "${type}" does not throw`, () => {
        expect(() => logger.emit(type as WarcraftEventType, {
          featureName: 'test',
          taskFolder: '01-a',
        })).not.toThrow();
      });
    }
  });

  describe('trust metrics shape', () => {
    it('has all expected fields', () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-shape-'));
      try {
        const metrics = computeTrustMetrics(tempDir);
        expect(typeof metrics.reopenCount).toBe('number');
        expect(typeof metrics.totalCompleted).toBe('number');
        expect(typeof metrics.reopenRate).toBe('number');
        expect(typeof metrics.duplicateDispatchPreventedCount).toBe('number');
        expect(typeof metrics.pruneDryRunCount).toBe('number');
        expect(typeof metrics.pruneConfirmedCount).toBe('number');
        expect(typeof metrics.pruneAcceptanceRate).toBe('number');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
