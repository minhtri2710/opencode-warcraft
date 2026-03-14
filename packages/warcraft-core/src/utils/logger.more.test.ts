import { describe, expect, it } from 'bun:test';
import { createConsoleLogger, createNoopLogger, type Logger } from './logger.js';

describe('logger more edge cases', () => {
  describe('createNoopLogger', () => {
    const logger = createNoopLogger();

    it('has info method', () => {
      expect(typeof logger.info).toBe('function');
    });

    it('has warn method', () => {
      expect(typeof logger.warn).toBe('function');
    });

    it('has error method', () => {
      expect(typeof logger.error).toBe('function');
    });

    it('has debug method', () => {
      expect(typeof logger.debug).toBe('function');
    });

    it('info does not throw', () => {
      expect(() => logger.info('test')).not.toThrow();
    });

    it('warn does not throw', () => {
      expect(() => logger.warn('test')).not.toThrow();
    });

    it('error does not throw', () => {
      expect(() => logger.error('test')).not.toThrow();
    });

    it('debug does not throw', () => {
      expect(() => logger.debug('test')).not.toThrow();
    });

    it('methods accept extra args', () => {
      expect(() => logger.info('msg', { key: 'val' })).not.toThrow();
      expect(() => logger.warn('msg', { key: 'val' })).not.toThrow();
      expect(() => logger.error('msg', { key: 'val' })).not.toThrow();
      expect(() => logger.debug('msg', { key: 'val' })).not.toThrow();
    });
  });

  describe('createConsoleLogger', () => {
    it('returns logger with all methods', () => {
      const logger = createConsoleLogger({ prefix: 'test' });
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('logger methods do not throw', () => {
      const logger = createConsoleLogger({ prefix: 'test' });
      expect(() => logger.info('info msg')).not.toThrow();
      expect(() => logger.warn('warn msg')).not.toThrow();
      expect(() => logger.error('error msg')).not.toThrow();
      expect(() => logger.debug('debug msg')).not.toThrow();
    });

    it('logger with context does not throw', () => {
      const logger = createConsoleLogger({ prefix: 'test' });
      expect(() => logger.info('msg', { extra: 'data' })).not.toThrow();
    });
  });
});
