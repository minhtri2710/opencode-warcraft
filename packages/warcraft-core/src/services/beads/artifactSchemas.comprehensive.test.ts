import { describe, expect, it } from 'bun:test';
import {
  CURRENT_SCHEMA_VERSION,
  encodeTaskState,
  decodeTaskState,
  taskStateFromTaskStatus,
  taskStateToTaskStatus,
  encodeWorkerPrompt,
  decodeWorkerPrompt,
  encodeTaskReport,
  decodeTaskReport,
  encodeTaskSpec,
  type TaskStateArtifact,
  type WorkerPromptArtifact,
  type TaskReportArtifact,
  type TaskSpecArtifact,
} from './artifactSchemas.js';
import type { TaskStatus } from '../../types.js';

describe('artifactSchemas comprehensive', () => {
  describe('CURRENT_SCHEMA_VERSION', () => {
    it('is 1', () => expect(CURRENT_SCHEMA_VERSION).toBe(1));
  });

  describe('TaskState encode/decode', () => {
    const ALL_STATUSES = ['pending', 'in_progress', 'dispatch_prepared', 'done', 'cancelled', 'blocked', 'failed', 'partial'] as const;

    for (const status of ALL_STATUSES) {
      it(`round-trips ${status}`, () => {
        const artifact: TaskStateArtifact = {
          schemaVersion: 1,
          status,
          origin: 'plan',
        };
        const encoded = encodeTaskState(artifact);
        const decoded = decodeTaskState(encoded);
        expect(decoded).not.toBeNull();
        expect(decoded!.status).toBe(status);
      });
    }

    it('preserves all optional fields', () => {
      const artifact: TaskStateArtifact = {
        schemaVersion: 1,
        status: 'done',
        origin: 'manual',
        planTitle: 'My Task',
        summary: 'Completed',
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-02T00:00:00Z',
        baseCommit: 'abc123',
        idempotencyKey: 'key-1',
        beadId: 'bead-1',
        dependsOn: ['01-a', '02-b'],
        folder: '03-my-task',
        learnings: ['Learned something'],
        preparedAt: '2024-01-01T12:00:00Z',
        blocker: { reason: 'Waiting', detail: 'On review' },
        workerSession: {
          sessionId: 'sess-1',
          workerId: 'worker-1',
          agent: 'saurfang',
          mode: 'delegate',
          attempt: 2,
          messageCount: 15,
        },
      };
      const decoded = decodeTaskState(encodeTaskState(artifact))!;
      expect(decoded.planTitle).toBe('My Task');
      expect(decoded.summary).toBe('Completed');
      expect(decoded.dependsOn).toEqual(['01-a', '02-b']);
      expect(decoded.learnings).toEqual(['Learned something']);
      expect(decoded.blocker!.reason).toBe('Waiting');
      expect(decoded.workerSession!.sessionId).toBe('sess-1');
      expect(decoded.workerSession!.attempt).toBe(2);
    });

    it('decodes legacy format (no schemaVersion)', () => {
      const legacy = JSON.stringify({ status: 'done', origin: 'plan', summary: 'Legacy' });
      const decoded = decodeTaskState(legacy);
      expect(decoded).not.toBeNull();
      expect(decoded!.schemaVersion).toBe(1);
      expect(decoded!.status).toBe('done');
      expect(decoded!.summary).toBe('Legacy');
    });

    it('returns null for invalid JSON', () => {
      expect(decodeTaskState('not-json')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(decodeTaskState(null)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(decodeTaskState('')).toBeNull();
    });
  });

  describe('taskState ↔ TaskStatus conversion', () => {
    it('round-trips through conversion', () => {
      const status: TaskStatus = {
        schemaVersion: 1,
        status: 'in_progress',
        origin: 'plan',
        planTitle: 'Setup',
        startedAt: '2024-01-01T00:00:00Z',
        dependsOn: ['01-init'],
      };
      const artifact = taskStateFromTaskStatus(status);
      const back = taskStateToTaskStatus(artifact);
      expect(back.status).toBe('in_progress');
      expect(back.planTitle).toBe('Setup');
      expect(back.dependsOn).toEqual(['01-init']);
    });
  });

  describe('WorkerPrompt encode/decode', () => {
    it('round-trips versioned artifact', () => {
      const artifact: WorkerPromptArtifact = {
        schemaVersion: 1,
        content: 'Do the work',
        generatedAt: '2024-01-01T00:00:00Z',
      };
      const decoded = decodeWorkerPrompt(encodeWorkerPrompt(artifact));
      expect(decoded).not.toBeNull();
      expect(decoded!.content).toBe('Do the work');
    });

    it('decodes legacy string content', () => {
      const raw = JSON.stringify('Just a prompt string');
      const decoded = decodeWorkerPrompt(raw);
      expect(decoded).not.toBeNull();
      expect(decoded!.content).toBe('Just a prompt string');
    });

    it('decodes legacy object with content', () => {
      const raw = JSON.stringify({ content: 'Legacy prompt' });
      const decoded = decodeWorkerPrompt(raw);
      expect(decoded).not.toBeNull();
      expect(decoded!.content).toBe('Legacy prompt');
    });

    it('decodes raw non-JSON content as legacy', () => {
      const decoded = decodeWorkerPrompt('raw prompt text');
      expect(decoded).not.toBeNull();
      expect(decoded!.content).toBe('raw prompt text');
    });

    it('returns null for null', () => {
      expect(decodeWorkerPrompt(null)).toBeNull();
    });

    it('returns null for empty', () => {
      expect(decodeWorkerPrompt('')).toBeNull();
    });
  });

  describe('TaskReport encode/decode', () => {
    it('round-trips versioned artifact', () => {
      const artifact: TaskReportArtifact = {
        schemaVersion: 1,
        content: '# Report\nAll done',
        createdAt: '2024-01-01T00:00:00Z',
      };
      const decoded = decodeTaskReport(encodeTaskReport(artifact));
      expect(decoded).not.toBeNull();
      expect(decoded!.content).toBe('# Report\nAll done');
    });

    it('decodes legacy string', () => {
      const decoded = decodeTaskReport(JSON.stringify('Legacy report'));
      expect(decoded!.content).toBe('Legacy report');
    });

    it('decodes legacy object', () => {
      const decoded = decodeTaskReport(JSON.stringify({ content: 'Report body' }));
      expect(decoded!.content).toBe('Report body');
    });

    it('decodes raw text as legacy', () => {
      const decoded = decodeTaskReport('# Raw markdown report');
      expect(decoded!.content).toBe('# Raw markdown report');
    });

    it('returns null for null', () => {
      expect(decodeTaskReport(null)).toBeNull();
    });
  });

  describe('TaskSpec encoding', () => {
    it('produces markdown with task header', () => {
      const spec: TaskSpecArtifact = {
        taskFolder: '01-setup',
        featureName: 'my-feature',
        planSection: 'Set up the project',
        context: 'Use TypeScript',
        priorTasks: [],
      };
      const md = encodeTaskSpec(spec);
      expect(md).toContain('# Task: 01-setup');
      expect(md).toContain('**Feature:** my-feature');
      expect(md).toContain('Set up the project');
    });

    it('includes prior tasks when present', () => {
      const spec: TaskSpecArtifact = {
        taskFolder: '02-build',
        featureName: 'feat',
        planSection: 'Build it',
        context: '',
        priorTasks: [
          { folder: '01-setup', summary: 'Setup completed' },
        ],
      };
      const md = encodeTaskSpec(spec);
      expect(md).toContain('## Prior Tasks');
      expect(md).toContain('01-setup');
      expect(md).toContain('Setup completed');
    });
  });
});
