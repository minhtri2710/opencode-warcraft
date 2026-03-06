import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { WarcraftEvent } from './event-logger.js';
import { createEventLogger, WARCRAFT_EVENT_TYPES } from './event-logger.js';

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
    it('defines expected event types', () => {
      expect(WARCRAFT_EVENT_TYPES).toContain('dispatch');
      expect(WARCRAFT_EVENT_TYPES).toContain('commit');
      expect(WARCRAFT_EVENT_TYPES).toContain('merge');
      expect(WARCRAFT_EVENT_TYPES).toContain('blocked');
      expect(WARCRAFT_EVENT_TYPES).toContain('retry');
      expect(WARCRAFT_EVENT_TYPES).toContain('degraded');
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

    it('creates parent directory if it does not exist', () => {
      const freshDir = path.join(TEST_DIR, 'fresh-project');
      const logger = createEventLogger(freshDir);

      logger.emit({ type: 'dispatch', feature: 'f', task: 't' });

      const freshLogFile = path.join(freshDir, '.beads', 'events.jsonl');
      expect(fs.existsSync(freshLogFile)).toBe(true);
    });

    it('does not throw on write failure (best-effort)', () => {
      // Use a path that can't be written to (read-only dir)
      const logger = createEventLogger('/dev/null/impossible');

      expect(() =>
        logger.emit({ type: 'dispatch', feature: 'f', task: 't' }),
      ).not.toThrow();
    });
  });
});
