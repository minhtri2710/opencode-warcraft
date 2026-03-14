/**
 * Tests for artifactSchemas module.
 */

import { describe, expect, it } from 'bun:test';
import type { TaskStatus } from '../../types.js';
import {
  decodeTaskReport,
  decodeTaskState,
  decodeWorkerPrompt,
  encodeTaskReport,
  encodeTaskState,
  encodeWorkerPrompt,
  taskStateFromTaskStatus,
  taskStateToTaskStatus,
} from './artifactSchemas.js';

describe('artifactSchemas', () => {
  describe('TaskStateArtifact', () => {
    it('should encode and decode task state', () => {
      const original = {
        schemaVersion: 1,
        status: 'in_progress' as const,
        origin: 'plan' as const,
        planTitle: 'Implement feature',
        summary: 'Working on it',
        startedAt: '2024-01-01T00:00:00.000Z',
        beadId: 'task-123',
        dependsOn: ['task-001', 'task-002'],
        blocker: {
          reason: 'Waiting for dependency',
          detail: 'Task 001 needs to complete first',
        },
      };

      const encoded = encodeTaskState(original);
      const decoded = decodeTaskState(encoded);

      expect(decoded).toEqual(original);
    });

    it('should migrate legacy task state', () => {
      const legacy = JSON.stringify({
        status: 'done',
        origin: 'manual',
        planTitle: 'Manual task',
        startedAt: '2024-01-01T00:00:00.000Z',
        completedAt: '2024-01-02T00:00:00.000Z',
      });

      const decoded = decodeTaskState(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded?.schemaVersion).toBe(1);
      expect(decoded?.status).toBe('done');
      expect(decoded?.origin).toBe('manual');
    });

    it('should return null for invalid task state', () => {
      expect(decodeTaskState(null)).toBeNull();
      expect(decodeTaskState('')).toBeNull();
      expect(decodeTaskState('invalid json')).toBeNull();
    });

    it('should return null for unknown schema version', () => {
      const future = JSON.stringify({ schemaVersion: 99, status: 'done', origin: 'plan' });
      expect(decodeTaskState(future)).toBeNull();
    });

    it('should default status to pending and origin to plan for legacy without them', () => {
      const minimal = JSON.stringify({ summary: 'minimal' });
      const decoded = decodeTaskState(minimal);
      expect(decoded?.status).toBe('pending');
      expect(decoded?.origin).toBe('plan');
    });

    it('should convert between TaskStatus and TaskStateArtifact', () => {
      const taskStatus: TaskStatus = {
        schemaVersion: 1,
        status: 'pending',
        origin: 'plan',
        planTitle: 'Test task',
        beadId: 'bead-456',
        dependsOn: ['task-001'],
      };

      const artifact = taskStateFromTaskStatus(taskStatus);
      expect(artifact.schemaVersion).toBe(1);
      expect(artifact.status).toBe(taskStatus.status);
      expect(artifact.origin).toBe(taskStatus.origin);

      const converted = taskStateToTaskStatus(artifact);
      expect(converted.status).toBe(taskStatus.status);
      expect(converted.origin).toBe(taskStatus.origin);
    });

    it('should round-trip learnings when present', () => {
      const original = {
        schemaVersion: 1,
        status: 'done' as const,
        origin: 'plan' as const,
        summary: 'Task completed successfully',
        learnings: ['Use bun:test for testing', 'ESM requires .js extensions'],
      };

      const encoded = encodeTaskState(original);
      const decoded = decodeTaskState(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded!.learnings).toEqual(['Use bun:test for testing', 'ESM requires .js extensions']);
    });

    it('should omit learnings when absent', () => {
      const original = {
        schemaVersion: 1,
        status: 'done' as const,
        origin: 'plan' as const,
        summary: 'Task completed',
      };

      const encoded = encodeTaskState(original);
      const decoded = decodeTaskState(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded!.learnings).toBeUndefined();
    });

    it('should preserve learnings in TaskStatus to TaskStateArtifact round-trip', () => {
      const taskStatus: TaskStatus = {
        schemaVersion: 1,
        status: 'done',
        origin: 'plan',
        summary: 'Completed with learnings',
        learnings: ['Pattern A works well', 'Avoid approach B'],
      };

      const artifact = taskStateFromTaskStatus(taskStatus);
      expect(artifact.learnings).toEqual(['Pattern A works well', 'Avoid approach B']);

      const converted = taskStateToTaskStatus(artifact);
      expect(converted.learnings).toEqual(['Pattern A works well', 'Avoid approach B']);
    });

    it('should omit learnings in TaskStatus conversion when not provided', () => {
      const taskStatus: TaskStatus = {
        schemaVersion: 1,
        status: 'pending',
        origin: 'plan',
      };

      const artifact = taskStateFromTaskStatus(taskStatus);
      expect(artifact.learnings).toBeUndefined();

      const converted = taskStateToTaskStatus(artifact);
      expect(converted.learnings).toBeUndefined();
    });

    it('should migrate legacy task state without learnings', () => {
      const legacy = JSON.stringify({
        status: 'done',
        origin: 'plan',
        summary: 'Old task without learnings',
      });

      const decoded = decodeTaskState(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded!.learnings).toBeUndefined();
    });
  });

  describe('WorkerPromptArtifact', () => {
    it('should encode and decode worker prompt', () => {
      const original = {
        schemaVersion: 1,
        content: 'You are a helpful assistant.',
        generatedAt: '2024-01-01T00:00:00.000Z',
      };

      const encoded = encodeWorkerPrompt(original);
      const decoded = decodeWorkerPrompt(encoded);

      expect(decoded).toEqual(original);
    });

    it('should migrate legacy string worker prompt', () => {
      const legacy = 'Legacy prompt content';

      const decoded = decodeWorkerPrompt(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded?.schemaVersion).toBe(1);
      expect(decoded?.content).toBe('Legacy prompt content');
    });

    it('should migrate legacy object worker prompt', () => {
      const legacy = JSON.stringify({
        content: 'Object prompt',
        generatedAt: '2024-01-01T00:00:00.000Z',
      });

      const decoded = decodeWorkerPrompt(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded?.schemaVersion).toBe(1);
      expect(decoded?.content).toBe('Object prompt');
    });

    it('should return null for invalid worker prompt', () => {
      expect(decodeWorkerPrompt(null)).toBeNull();
      expect(decodeWorkerPrompt('')).toBeNull();
      expect(decodeWorkerPrompt('{}')).toBeNull();
    });

    it('should return null for unknown schema version', () => {
      const future = JSON.stringify({ schemaVersion: 99, content: 'prompt', generatedAt: '2024-01-01T00:00:00Z' });
      expect(decodeWorkerPrompt(future)).toBeNull();
    });

    it('should handle raw non-JSON content as legacy string', () => {
      const raw = 'Execute: setup environment and run tests';
      const decoded = decodeWorkerPrompt(raw);
      expect(decoded).not.toBeNull();
      expect(decoded?.content).toBe(raw);
      expect(decoded?.schemaVersion).toBe(1);
    });
  });

  describe('TaskReportArtifact', () => {
    it('should encode and decode task report', () => {
      const original = {
        schemaVersion: 1,
        content: '# Task Report\n\nAll tests passed.',
        createdAt: '2024-01-01T00:00:00.000Z',
      };

      const encoded = encodeTaskReport(original);
      const decoded = decodeTaskReport(encoded);

      expect(decoded).toEqual(original);
    });

    it('should migrate legacy string task report', () => {
      const legacy = '# Legacy Report\n\nSome content';

      const decoded = decodeTaskReport(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded?.schemaVersion).toBe(1);
      expect(decoded?.content).toBe('# Legacy Report\n\nSome content');
    });

    it('should migrate legacy object task report', () => {
      const legacy = JSON.stringify({
        content: 'Object report',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      const decoded = decodeTaskReport(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded?.schemaVersion).toBe(1);
      expect(decoded?.content).toBe('Object report');
    });

    it('should return null for invalid task report', () => {
      expect(decodeTaskReport(null)).toBeNull();
      expect(decodeTaskReport('')).toBeNull();
      expect(decodeTaskReport('{}')).toBeNull();
    });

    it('should return null for unknown schema version', () => {
      const future = JSON.stringify({ schemaVersion: 99, content: 'report', createdAt: '2024-01-01T00:00:00Z' });
      expect(decodeTaskReport(future)).toBeNull();
    });

    it('should handle raw non-JSON content as legacy string', () => {
      const raw = '## Report\n\nAll tests passed. No issues found.';
      const decoded = decodeTaskReport(raw);
      expect(decoded).not.toBeNull();
      expect(decoded?.content).toBe(raw);
      expect(decoded?.schemaVersion).toBe(1);
    });
  });
});
