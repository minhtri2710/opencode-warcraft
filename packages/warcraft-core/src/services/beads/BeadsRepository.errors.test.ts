import { describe, expect, it } from 'bun:test';
import {
  RepositoryError,
  getRepositoryInternalCode,
  isRepositoryInitFailure,
  throwIfInitFailure,
} from './BeadsRepository.js';
import { BeadGatewayError } from './BeadGateway.types.js';

describe('BeadsRepository error handling', () => {
  describe('RepositoryError', () => {
    it('has correct name', () => {
      const err = new RepositoryError('epic_not_found', 'Epic missing');
      expect(err.name).toBe('RepositoryError');
    });

    it('has code', () => {
      const err = new RepositoryError('sync_failed', 'Sync broke');
      expect(err.code).toBe('sync_failed');
    });

    it('has message', () => {
      const err = new RepositoryError('gateway_error', 'Gateway down');
      expect(err.message).toBe('Gateway down');
    });

    it('has optional cause', () => {
      const cause = new Error('root cause');
      const err = new RepositoryError('gateway_error', 'wrapper', cause);
      expect(err.cause).toBe(cause);
    });

    it('inherits from Error', () => {
      const err = new RepositoryError('beads_disabled', 'disabled');
      expect(err instanceof Error).toBe(true);
    });

    it('has stack trace', () => {
      const err = new RepositoryError('invalid_artifact', 'bad');
      expect(err.stack).toBeDefined();
    });

    const ALL_CODES = [
      'beads_disabled',
      'epic_not_found',
      'task_not_found',
      'sync_failed',
      'invalid_artifact',
      'gateway_error',
    ] as const;

    for (const code of ALL_CODES) {
      it(`code "${code}" accepted`, () => {
        expect(new RepositoryError(code, 'msg').code).toBe(code);
      });
    }
  });

  describe('getRepositoryInternalCode', () => {
    it('extracts from BeadGatewayError with internalCode', () => {
      const err = new BeadGatewayError('command_failed', '[BR_INIT_FAILED] init failed', 'BR_INIT_FAILED');
      expect(getRepositoryInternalCode(err)).toBe('BR_INIT_FAILED');
    });

    it('extracts from nested RepositoryError', () => {
      const cause = new BeadGatewayError('command_failed', '[BR_NOT_INITIALIZED] not init', 'BR_NOT_INITIALIZED');
      const err = new RepositoryError('gateway_error', 'wrapper', cause);
      expect(getRepositoryInternalCode(err)).toBe('BR_NOT_INITIALIZED');
    });

    it('extracts from plain Error message', () => {
      const err = new Error('[BR_INIT_FAILED] something');
      expect(getRepositoryInternalCode(err)).toBe('BR_INIT_FAILED');
    });

    it('returns null for no code', () => {
      expect(getRepositoryInternalCode(new Error('plain error'))).toBeNull();
    });

    it('returns null for non-Error', () => {
      expect(getRepositoryInternalCode('just a string')).toBeNull();
    });

    it('returns null for null', () => {
      expect(getRepositoryInternalCode(null)).toBeNull();
    });
  });

  describe('isRepositoryInitFailure', () => {
    it('true for BR_INIT_FAILED', () => {
      const err = new Error('[BR_INIT_FAILED] init failed');
      expect(isRepositoryInitFailure(err)).toBe(true);
    });

    it('true for BR_NOT_INITIALIZED', () => {
      const err = new Error('[BR_NOT_INITIALIZED] not init');
      expect(isRepositoryInitFailure(err)).toBe(true);
    });

    it('false for other codes', () => {
      const err = new Error('[BR_OTHER] something');
      expect(isRepositoryInitFailure(err)).toBe(false);
    });

    it('false for no code', () => {
      expect(isRepositoryInitFailure(new Error('plain'))).toBe(false);
    });
  });

  describe('throwIfInitFailure', () => {
    it('throws for init failure', () => {
      const err = new Error('[BR_INIT_FAILED] init failed');
      expect(() => throwIfInitFailure(err, 'context')).toThrow(/context/);
    });

    it('does not throw for non-init failure', () => {
      const err = new Error('regular error');
      expect(() => throwIfInitFailure(err, 'context')).not.toThrow();
    });

    it('does not throw for null', () => {
      expect(() => throwIfInitFailure(null, 'context')).not.toThrow();
    });
  });
});
