import { describe, expect, it } from 'bun:test';
import {
  BeadGatewayError,
  type BeadArtifactKind,
  type BeadComment,
  type AuditEntry,
  type BeadGatewayErrorCode,
} from './BeadGateway.types.js';

describe('BeadGateway types comprehensive', () => {
  describe('BeadArtifactKind', () => {
    it('includes spec', () => {
      const kind: BeadArtifactKind = 'spec';
      expect(kind).toBe('spec');
    });

    it('includes worker_prompt', () => {
      const kind: BeadArtifactKind = 'worker_prompt';
      expect(kind).toBe('worker_prompt');
    });

    it('includes report', () => {
      const kind: BeadArtifactKind = 'report';
      expect(kind).toBe('report');
    });

    it('includes task_state', () => {
      const kind: BeadArtifactKind = 'task_state';
      expect(kind).toBe('task_state');
    });
  });

  describe('BeadGatewayError', () => {
    it('is an Error', () => {
      const err = new BeadGatewayError('parse_error', 'test', {});
      expect(err).toBeInstanceOf(Error);
    });

    it('has code property', () => {
      const err = new BeadGatewayError('parse_error', 'test message', {});
      expect(err.code).toBe('parse_error');
    });

    it('has message', () => {
      const err = new BeadGatewayError('parse_error', 'detailed error', {});
      expect(err.message).toContain('detailed error');
    });

    it('can be caught as Error', () => {
      try {
        throw new BeadGatewayError('parse_error', 'test', {});
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });

    it('different codes work', () => {
      const codes: BeadGatewayErrorCode[] = ['parse_error', 'not_found', 'command_failed'];
      for (const code of codes) {
        const err = new BeadGatewayError(code, 'test', {});
        expect(err.code).toBe(code);
      }
    });
  });

  describe('BeadComment type', () => {
    it('accepts valid comment', () => {
      const comment: BeadComment = {
        id: 'c-1',
        author: 'user',
        body: 'comment text',
        createdAt: '2024-01-01',
      };
      expect(comment.id).toBe('c-1');
      expect(comment.body).toBe('comment text');
    });
  });

  describe('AuditEntry type', () => {
    it('accepts valid entry', () => {
      const entry: AuditEntry = {
        timestamp: '2024-01-01T00:00:00Z',
        action: 'status_change',
        actor: 'agent',
        details: 'changed to done',
      };
      expect(entry.action).toBe('status_change');
    });
  });
});
