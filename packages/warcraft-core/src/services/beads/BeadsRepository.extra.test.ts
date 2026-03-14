import { describe, expect, it } from 'bun:test';
import {
  RepositoryError,
  getRepositoryInternalCode,
  isRepositoryInitFailure,
  throwIfInitFailure,
} from './BeadsRepository.js';
import { BeadGatewayError } from './BeadGateway.types.js';

describe('BeadsRepository error utilities extra', () => {
  describe('RepositoryError', () => {
    it('has correct name', () => {
      const err = new RepositoryError('gateway_error', 'test');
      expect(err.name).toBe('RepositoryError');
    });

    it('stores code and message', () => {
      const err = new RepositoryError('epic_not_found', 'Epic missing');
      expect(err.code).toBe('epic_not_found');
      expect(err.message).toBe('Epic missing');
    });

    it('stores optional cause', () => {
      const cause = new Error('underlying');
      const err = new RepositoryError('gateway_error', 'wrap', cause);
      expect(err.cause).toBe(cause);
    });

    it('is instanceof Error', () => {
      const err = new RepositoryError('sync_failed', 'sync');
      expect(err instanceof Error).toBe(true);
    });

    it('has undefined cause when not provided', () => {
      const err = new RepositoryError('beads_disabled', 'disabled');
      expect(err.cause).toBeUndefined();
    });

    it('all error codes can be used', () => {
      const codes = ['beads_disabled', 'epic_not_found', 'task_not_found', 'sync_failed', 'invalid_artifact', 'gateway_error'] as const;
      for (const code of codes) {
        const err = new RepositoryError(code, `msg for ${code}`);
        expect(err.code).toBe(code);
      }
    });
  });

  describe('getRepositoryInternalCode', () => {
    it('extracts internalCode from BeadGatewayError', () => {
      const err = new BeadGatewayError('command_error', 'msg', 'BR_NOT_FOUND');
      expect(getRepositoryInternalCode(err)).toBe('BR_NOT_FOUND');
    });

    it('extracts code from message when internalCode undefined', () => {
      const err = new BeadGatewayError('command_error', 'Failed [BR_INIT_FAILED]: reason');
      expect(getRepositoryInternalCode(err)).toBe('BR_INIT_FAILED');
    });

    it('extracts code from RepositoryError cause chain', () => {
      const gateway = new BeadGatewayError('command_error', 'msg', 'BR_COMMAND_FAILED');
      const repo = new RepositoryError('gateway_error', 'wrap', gateway);
      expect(getRepositoryInternalCode(repo)).toBe('BR_COMMAND_FAILED');
    });

    it('extracts code from plain Error message', () => {
      expect(getRepositoryInternalCode(new Error('[BR_NOT_INITIALIZED] fail'))).toBe('BR_NOT_INITIALIZED');
    });

    it('returns null for non-Error values', () => {
      expect(getRepositoryInternalCode('str')).toBeNull();
      expect(getRepositoryInternalCode(42)).toBeNull();
      expect(getRepositoryInternalCode(null)).toBeNull();
      expect(getRepositoryInternalCode(undefined)).toBeNull();
    });

    it('returns null when no BR_ code in message', () => {
      expect(getRepositoryInternalCode(new Error('no code'))).toBeNull();
    });
  });

  describe('isRepositoryInitFailure', () => {
    it('true for BR_INIT_FAILED', () => {
      expect(isRepositoryInitFailure(new BeadGatewayError('command_error', 'x', 'BR_INIT_FAILED'))).toBe(true);
    });

    it('true for BR_NOT_INITIALIZED', () => {
      expect(isRepositoryInitFailure(new BeadGatewayError('command_error', 'x', 'BR_NOT_INITIALIZED'))).toBe(true);
    });

    it('false for BR_COMMAND_FAILED', () => {
      expect(isRepositoryInitFailure(new BeadGatewayError('command_error', 'x', 'BR_COMMAND_FAILED'))).toBe(false);
    });

    it('false for null/undefined', () => {
      expect(isRepositoryInitFailure(null)).toBe(false);
      expect(isRepositoryInitFailure(undefined)).toBe(false);
    });
  });

  describe('throwIfInitFailure', () => {
    it('throws for init failure with context in message', () => {
      const err = new BeadGatewayError('command_error', 'init failed', 'BR_INIT_FAILED');
      expect(() => throwIfInitFailure(err, 'my-context')).toThrow('my-context');
    });

    it('does not throw for non-init failure', () => {
      expect(() => throwIfInitFailure(new BeadGatewayError('command_error', 'x', 'BR_COMMAND_FAILED'), 'ctx')).not.toThrow();
    });

    it('does not throw for plain errors without BR codes', () => {
      expect(() => throwIfInitFailure(new Error('random'), 'ctx')).not.toThrow();
    });
  });
});
