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
  });
});
