import { describe, expect, it } from 'bun:test';
import { createConsoleLogger, createNoopLogger, LOG_LEVELS, type LogEntry } from './logger.js';

describe('logger comprehensive validation', () => {
  describe('LOG_LEVELS ordering', () => {
    it('debug is 0', () => expect(LOG_LEVELS.debug).toBe(0));
    it('info is 1', () => expect(LOG_LEVELS.info).toBe(1));
    it('warn is 2', () => expect(LOG_LEVELS.warn).toBe(2));
    it('error is 3', () => expect(LOG_LEVELS.error).toBe(3));
  });

  describe('createConsoleLogger with sink captures all levels', () => {
    it('captures info', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ sink: (e) => entries.push(e) });
      logger.info('test');
      expect(entries.some((e) => e.level === 'info')).toBe(true);
    });

    it('captures warn', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ sink: (e) => entries.push(e) });
      logger.warn('test');
      expect(entries.some((e) => e.level === 'warn')).toBe(true);
    });

    it('captures error', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ sink: (e) => entries.push(e) });
      logger.error('test');
      expect(entries.some((e) => e.level === 'error')).toBe(true);
    });

    it('captures debug', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ sink: (e) => entries.push(e), minLevel: 'debug' });
      logger.debug('test');
      expect(entries.some((e) => e.level === 'debug')).toBe(true);
    });

    it('entry has timestamp', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ sink: (e) => entries.push(e) });
      logger.info('test');
      expect(entries[0].timestamp).toBeDefined();
    });

    it('entry has message', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ sink: (e) => entries.push(e) });
      logger.info('hello world');
      expect(entries[0].message).toBe('hello world');
    });

    it('entry context passed through', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ sink: (e) => entries.push(e) });
      logger.info('msg', { key: 'val', num: 42 });
      expect(entries[0].context?.key).toBe('val');
      expect(entries[0].context?.num).toBe(42);
    });

    it('prefix option accepted', () => {
      const entries: LogEntry[] = [];
      const logger = createConsoleLogger({ sink: (e) => entries.push(e), prefix: '[test]' });
      logger.info('msg');
      expect(entries).toHaveLength(1);
    });
  });

  describe('noop logger methods', () => {
    const logger = createNoopLogger();
    it('info returns void', () => expect(logger.info('x')).toBeUndefined());
    it('warn returns void', () => expect(logger.warn('x')).toBeUndefined());
    it('error returns void', () => expect(logger.error('x')).toBeUndefined());
    it('debug returns void', () => expect(logger.debug('x')).toBeUndefined());
  });
});
