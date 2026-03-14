import { describe, expect, it, spyOn } from 'bun:test';
import type { LogEntry } from './logger.js';
import { createConsoleLogger, createNoopLogger, LOG_LEVELS } from './logger.js';

describe('Logger extra edge cases', () => {
  describe('LOG_LEVELS', () => {
    it('has exactly 4 levels', () => {
      expect(Object.keys(LOG_LEVELS)).toHaveLength(4);
    });

    it('debug is 0', () => {
      expect(LOG_LEVELS.debug).toBe(0);
    });

    it('error is the highest', () => {
      expect(LOG_LEVELS.error).toBeGreaterThan(LOG_LEVELS.warn);
    });
  });

  describe('createConsoleLogger with debug level', () => {
    it('emits all levels when minLevel is debug', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ minLevel: 'debug', sink: (e) => entries.push(e) });
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      expect(entries).toHaveLength(4);
    });
  });

  describe('createConsoleLogger with error level', () => {
    it('only emits error when minLevel is error', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ minLevel: 'error', sink: (e) => entries.push(e) });
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe('error');
    });
  });

  describe('default console sink', () => {
    it('uses console.error for error level', () => {
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
      try {
        const logger = createConsoleLogger({ minLevel: 'error' });
        logger.error('test error');
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('uses console.warn for warn level', () => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const logger = createConsoleLogger({ minLevel: 'warn' });
        logger.warn('test warn');
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('uses console.log for info level', () => {
      const logSpy = spyOn(console, 'log').mockImplementation(() => {});
      try {
        const logger = createConsoleLogger({ minLevel: 'info' });
        logger.info('test info');
        expect(logSpy).toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe('createNoopLogger', () => {
    it('returns same-shaped logger as createConsoleLogger', () => {
      const noop = createNoopLogger();
      const console = createConsoleLogger();
      expect(Object.keys(noop).sort()).toEqual(Object.keys(console).sort());
    });
  });

  describe('log entry structure', () => {
    it('includes all required fields', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ minLevel: 'debug', sink: (e) => entries.push(e) });
      logger.debug('test');
      expect(entries[0]).toHaveProperty('level');
      expect(entries[0]).toHaveProperty('message');
      expect(entries[0]).toHaveProperty('timestamp');
    });

    it('omits context when not provided', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ minLevel: 'debug', sink: (e) => entries.push(e) });
      logger.info('no context');
      expect(entries[0].context).toBeUndefined();
    });
  });
});
