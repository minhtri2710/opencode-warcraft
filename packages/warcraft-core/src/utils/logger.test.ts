import { describe, expect, it } from 'bun:test';
import type { LogEntry, Logger, LogLevel } from './logger.js';
import { createConsoleLogger, createNoopLogger, LOG_LEVELS } from './logger.js';

describe('Logger', () => {
  describe('LOG_LEVELS', () => {
    it('defines correct severity ordering', () => {
      expect(LOG_LEVELS.debug).toBeLessThan(LOG_LEVELS.info);
      expect(LOG_LEVELS.info).toBeLessThan(LOG_LEVELS.warn);
      expect(LOG_LEVELS.warn).toBeLessThan(LOG_LEVELS.error);
    });
  });

  describe('createNoopLogger()', () => {
    it('returns a logger with all methods', () => {
      const logger = createNoopLogger();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('does not throw when called', () => {
      const logger = createNoopLogger();
      expect(() => logger.debug('test')).not.toThrow();
      expect(() => logger.info('test', { key: 'val' })).not.toThrow();
      expect(() => logger.warn('test')).not.toThrow();
      expect(() => logger.error('test')).not.toThrow();
    });
  });

  describe('createConsoleLogger()', () => {
    it('returns a logger with all methods', () => {
      const logger = createConsoleLogger();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('respects minimum log level', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({
        minLevel: 'warn',
        sink: (entry) => entries.push(entry),
      });

      logger.debug('debug msg');
      logger.info('info msg');
      logger.warn('warn msg');
      logger.error('error msg');

      expect(entries).toHaveLength(2);
      expect(entries[0].level).toBe('warn');
      expect(entries[1].level).toBe('error');
    });

    it('includes context in log entries', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({
        minLevel: 'debug',
        sink: (entry) => entries.push(entry),
      });

      logger.info('test message', { feature: 'my-feature', task: '01-setup' });

      expect(entries).toHaveLength(1);
      expect(entries[0].message).toBe('test message');
      expect(entries[0].context).toEqual({ feature: 'my-feature', task: '01-setup' });
    });

    it('includes timestamp in log entries', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({
        minLevel: 'debug',
        sink: (entry) => entries.push(entry),
      });

      logger.info('test');

      expect(entries).toHaveLength(1);
      expect(entries[0].timestamp).toBeDefined();
      // ISO 8601 format
      expect(() => new Date(entries[0].timestamp)).not.toThrow();
    });

    it('defaults to info level', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({
        sink: (entry) => entries.push(entry),
      });

      logger.debug('should be filtered');
      logger.info('should appear');

      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('info');
    });
  });
});
