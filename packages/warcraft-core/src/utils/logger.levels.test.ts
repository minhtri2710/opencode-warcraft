import { describe, expect, it } from 'bun:test';
import { createConsoleLogger, LOG_LEVELS, type LogEntry } from './logger.js';

describe('logger LOG_LEVELS', () => {
  it('has 4 levels', () => {
    expect(Object.keys(LOG_LEVELS)).toHaveLength(4);
  });

  it('debug < info < warn < error', () => {
    expect(LOG_LEVELS.debug).toBeLessThan(LOG_LEVELS.info);
    expect(LOG_LEVELS.info).toBeLessThan(LOG_LEVELS.warn);
    expect(LOG_LEVELS.warn).toBeLessThan(LOG_LEVELS.error);
  });

  it('all levels are non-negative', () => {
    for (const level of Object.values(LOG_LEVELS)) {
      expect(level).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('createConsoleLogger options', () => {
  it('accepts minLevel option', () => {
    const logger = createConsoleLogger({ minLevel: 'warn' });
    expect(logger).toBeDefined();
  });

  it('accepts prefix option', () => {
    const logger = createConsoleLogger({ prefix: '[test]' });
    expect(logger).toBeDefined();
  });

  it('accepts no options', () => {
    const logger = createConsoleLogger();
    expect(logger).toBeDefined();
  });

  it('accepts sink option', () => {
    const entries: LogEntry[] = [];
    const logger = createConsoleLogger({ sink: (entry) => entries.push(entry) });
    logger.info('test message');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toBe('test message');
  });

  it('sink receives context', () => {
    const entries: LogEntry[] = [];
    const logger = createConsoleLogger({ sink: (entry) => entries.push(entry) });
    logger.warn('warning', { key: 'val' });
    expect(entries[0].context?.key).toBe('val');
  });

  it('minLevel filters lower-priority messages', () => {
    const entries: LogEntry[] = [];
    const logger = createConsoleLogger({ minLevel: 'error', sink: (entry) => entries.push(entry) });
    logger.debug('should not appear');
    logger.info('should not appear');
    logger.warn('should not appear');
    logger.error('should appear');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
  });
});
