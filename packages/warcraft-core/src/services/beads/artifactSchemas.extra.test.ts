import { describe, expect, it } from 'bun:test';
import {
  CURRENT_SCHEMA_VERSION,
  decodeTaskReport,
  decodeTaskState,
  decodeWorkerPrompt,
  encodeTaskReport,
  encodeTaskSpec,
  encodeTaskState,
  encodeWorkerPrompt,
  taskStateFromTaskStatus,
  taskStateToTaskStatus,
} from './artifactSchemas.js';

describe('artifactSchemas round-trip', () => {
  describe('TaskState', () => {
    it('encode→decode round-trip preserves all fields', () => {
      const original = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        status: 'in_progress' as const,
        origin: 'plan' as const,
        planTitle: 'Setup',
        summary: 'Done',
        startedAt: '2024-01-01',
        completedAt: '2024-02-01',
        baseCommit: 'abc123',
        idempotencyKey: 'key-1',
        beadId: 'bd-1',
        dependsOn: ['01-a'],
        preparedAt: '2024-01-15',
        folder: '02-setup',
        learnings: ['learned1'],
      };
      const encoded = encodeTaskState(original);
      const decoded = decodeTaskState(encoded);
      expect(decoded).toEqual(original);
    });

    it('decode migrates legacy format without schemaVersion', () => {
      const legacy = JSON.stringify({ status: 'done', origin: 'manual', planTitle: 'Build' });
      const decoded = decodeTaskState(legacy);
      expect(decoded?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(decoded?.status).toBe('done');
      expect(decoded?.origin).toBe('manual');
      expect(decoded?.planTitle).toBe('Build');
    });

    it('decode returns null for null input', () => {
      expect(decodeTaskState(null)).toBeNull();
    });

    it('decode returns null for invalid JSON', () => {
      expect(decodeTaskState('not json')).toBeNull();
    });

    it('decode defaults missing status to pending', () => {
      const decoded = decodeTaskState(JSON.stringify({ origin: 'plan' }));
      expect(decoded?.status).toBe('pending');
    });

    it('decode defaults missing origin to plan', () => {
      const decoded = decodeTaskState(JSON.stringify({ status: 'done' }));
      expect(decoded?.origin).toBe('plan');
    });

    it('decode preserves workerSession', () => {
      const ws = { sessionId: 'sess-1', workerId: 'w-1', agent: 'saurfang' };
      const decoded = decodeTaskState(JSON.stringify({ status: 'in_progress', origin: 'plan', workerSession: ws }));
      expect(decoded?.workerSession?.sessionId).toBe('sess-1');
    });

    it('decode preserves blocker', () => {
      const blocker = { reason: 'dep not done', detail: 'waiting on 01-a' };
      const decoded = decodeTaskState(JSON.stringify({ status: 'blocked', origin: 'plan', blocker }));
      expect(decoded?.blocker?.reason).toBe('dep not done');
    });
  });

  describe('WorkerPrompt', () => {
    it('encode→decode round-trip', () => {
      const original = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        content: 'Do this task',
        generatedAt: '2024-01-01T00:00:00Z',
      };
      const encoded = encodeWorkerPrompt(original);
      const decoded = decodeWorkerPrompt(encoded);
      expect(decoded).toEqual(original);
    });

    it('decode migrates legacy string format', () => {
      const decoded = decodeWorkerPrompt(JSON.stringify('raw prompt'));
      expect(decoded?.content).toBe('raw prompt');
      expect(decoded?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('decode migrates legacy object with content', () => {
      const decoded = decodeWorkerPrompt(JSON.stringify({ content: 'prompt text' }));
      expect(decoded?.content).toBe('prompt text');
    });

    it('decode returns null for null input', () => {
      expect(decodeWorkerPrompt(null)).toBeNull();
    });

    it('decode returns null for wrong schemaVersion', () => {
      const decoded = decodeWorkerPrompt(JSON.stringify({ schemaVersion: 999, content: 'x', generatedAt: 'y' }));
      expect(decoded).toBeNull();
    });

    it('decode treats invalid JSON as legacy string', () => {
      const decoded = decodeWorkerPrompt('not json at all');
      expect(decoded?.content).toBe('not json at all');
    });

    it('decode returns null for empty string', () => {
      expect(decodeWorkerPrompt('')).toBeNull();
    });
  });

  describe('TaskReport', () => {
    it('encode→decode round-trip', () => {
      const original = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        content: 'Report content',
        createdAt: '2024-01-01T00:00:00Z',
      };
      const encoded = encodeTaskReport(original);
      const decoded = decodeTaskReport(encoded);
      expect(decoded).toEqual(original);
    });

    it('decode migrates legacy string format', () => {
      const decoded = decodeTaskReport(JSON.stringify('report text'));
      expect(decoded?.content).toBe('report text');
    });

    it('decode migrates legacy object with content', () => {
      const decoded = decodeTaskReport(JSON.stringify({ content: 'report' }));
      expect(decoded?.content).toBe('report');
    });

    it('decode returns null for null', () => {
      expect(decodeTaskReport(null)).toBeNull();
    });

    it('decode returns null for wrong schemaVersion', () => {
      expect(decodeTaskReport(JSON.stringify({ schemaVersion: 42, content: 'x', createdAt: 'y' }))).toBeNull();
    });

    it('decode treats invalid JSON as legacy string', () => {
      const decoded = decodeTaskReport('raw report');
      expect(decoded?.content).toBe('raw report');
    });

    it('decode returns null for empty string', () => {
      expect(decodeTaskReport('')).toBeNull();
    });
  });

  describe('TaskSpec', () => {
    it('encodeTaskSpec produces markdown with all sections', () => {
      const md = encodeTaskSpec({
        taskFolder: '01-setup',
        featureName: 'my-feature',
        planSection: 'Do the setup',
        context: 'Some context here',
        priorTasks: [{ folder: '00-init', summary: 'Initialized' }, { folder: '00-pre' }],
      });
      expect(md).toContain('# Task: 01-setup');
      expect(md).toContain('**Feature:** my-feature');
      expect(md).toContain('## Plan Section');
      expect(md).toContain('Do the setup');
      expect(md).toContain('## Prior Tasks');
      expect(md).toContain('`00-init`: Initialized');
      expect(md).toContain('`00-pre`');
      expect(md).not.toContain('`00-pre`:');
      expect(md).toContain('## Context');
    });

    it('encodeTaskSpec with no prior tasks omits section', () => {
      const md = encodeTaskSpec({
        taskFolder: '01-t',
        featureName: 'f',
        planSection: 'p',
        context: 'c',
        priorTasks: [],
      });
      expect(md).not.toContain('## Prior Tasks');
    });
  });

  describe('taskStateFromTaskStatus / taskStateToTaskStatus', () => {
    it('round-trips TaskStatus through artifact and back', () => {
      const original = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        status: 'done' as const,
        origin: 'plan' as const,
        planTitle: 'Build',
        summary: 'Built successfully',
        startedAt: '2024-01-01',
        completedAt: '2024-01-02',
        baseCommit: 'def456',
        folder: '03-build',
        learnings: ['lesson1'],
      };
      const artifact = taskStateFromTaskStatus(original);
      const backToStatus = taskStateToTaskStatus(artifact);
      expect(backToStatus.status).toBe('done');
      expect(backToStatus.summary).toBe('Built successfully');
      expect(backToStatus.learnings).toEqual(['lesson1']);
    });
  });
});
