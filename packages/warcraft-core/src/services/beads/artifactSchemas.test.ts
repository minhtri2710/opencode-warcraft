/**
 * Tests for artifactSchemas module.
 */

import { describe, it, expect } from 'bun:test';
import {
  encodeFeatureState,
  decodeFeatureState,
  encodeTaskState,
  decodeTaskState,
  encodePlanApproval,
  decodePlanApproval,
  encodeApprovedPlan,
  decodeApprovedPlan,
  encodePlanComments,
  decodePlanComments,
  encodeWorkerPrompt,
  decodeWorkerPrompt,
  encodeTaskReport,
  decodeTaskReport,
  featureStateFromFeatureJson,
  featureStateToFeatureJson,
  taskStateFromTaskStatus,
  taskStateToTaskStatus,
} from './artifactSchemas.js';
import type { FeatureJson, TaskStatus, PlanComment } from '../../types.js';

describe('artifactSchemas', () => {
  describe('FeatureStateArtifact', () => {
    it('should encode and decode feature state', () => {
      const original = {
        schemaVersion: 1,
        name: 'test-feature',
        status: 'planning' as const,
        createdAt: '2024-01-01T00:00:00.000Z',
        approvedAt: '2024-01-02T00:00:00.000Z',
        workflowPath: 'standard' as const,
        ticket: 'TICKET-123',
      };

      const encoded = encodeFeatureState(original);
      const decoded = decodeFeatureState(encoded);

      expect(decoded).toEqual(original);
    });

    it('should migrate legacy feature state', () => {
      const legacy = JSON.stringify({
        name: 'legacy-feature',
        status: 'executing',
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      const decoded = decodeFeatureState(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded?.schemaVersion).toBe(1);
      expect(decoded?.name).toBe('legacy-feature');
      expect(decoded?.status).toBe('executing');
    });

    it('should return null for invalid feature state', () => {
      expect(decodeFeatureState(null)).toBeNull();
      expect(decodeFeatureState('')).toBeNull();
      expect(decodeFeatureState('invalid json')).toBeNull();
    });

    it('should convert between FeatureJson and FeatureStateArtifact', () => {
      const featureJson: FeatureJson = {
        name: 'test-feature',
        epicBeadId: 'epic-123',
        status: 'approved',
        createdAt: '2024-01-01T00:00:00.000Z',
        approvedAt: '2024-01-02T00:00:00.000Z',
      };

      const artifact = featureStateFromFeatureJson(featureJson);
      expect(artifact.schemaVersion).toBe(1);
      expect(artifact.name).toBe(featureJson.name);
      expect(artifact.status).toBe(featureJson.status);

      const partial = featureStateToFeatureJson(artifact);
      expect(partial.name).toBe(featureJson.name);
      expect(partial.status).toBe(featureJson.status);
    });
  });

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

  describe('PlanApprovalArtifact', () => {
    it('should encode and decode plan approval', () => {
      const original = {
        schemaVersion: 1,
        hash: 'abc123def456',
        approvedAt: '2024-01-01T00:00:00.000Z',
        approvedBySession: 'session-789',
      };

      const encoded = encodePlanApproval(original);
      const decoded = decodePlanApproval(encoded);

      expect(decoded).toEqual(original);
    });

    it('should migrate legacy plan approval', () => {
      const legacy = JSON.stringify({
        hash: 'legacy-hash',
        approvedAt: '2024-01-01T00:00:00.000Z',
      });

      const decoded = decodePlanApproval(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded?.schemaVersion).toBe(1);
      expect(decoded?.hash).toBe('legacy-hash');
    });

    it('should return null for invalid plan approval', () => {
      expect(decodePlanApproval(null)).toBeNull();
      expect(decodePlanApproval('')).toBeNull();
      expect(decodePlanApproval('{}')).toBeNull(); // Missing required fields
    });
  });

  describe('ApprovedPlanArtifact', () => {
    it('should encode and decode approved plan', () => {
      const original = {
        schemaVersion: 1,
        content: '# Plan\n\nThis is the plan content.',
        snapshotAt: '2024-01-01T00:00:00.000Z',
        contentHash: 'sha256-123',
      };

      const encoded = encodeApprovedPlan(original);
      const decoded = decodeApprovedPlan(encoded);

      expect(decoded).toEqual(original);
    });

    it('should migrate legacy approved plan', () => {
      const legacy = JSON.stringify({
        content: '# Legacy Plan\n\nContent here',
      });

      const decoded = decodeApprovedPlan(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded?.schemaVersion).toBe(1);
      expect(decoded?.content).toBe('# Legacy Plan\n\nContent here');
    });

    it('should return null for invalid approved plan', () => {
      expect(decodeApprovedPlan(null)).toBeNull();
      expect(decodeApprovedPlan('')).toBeNull();
      expect(decodeApprovedPlan('{}')).toBeNull();
    });
  });

  describe('PlanCommentsArtifact', () => {
    const comments: PlanComment[] = [
      {
        id: '1',
        line: 10,
        body: 'First comment',
        author: 'user1',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
      {
        id: '2',
        line: 20,
        body: 'Second comment',
        author: 'user2',
        timestamp: '2024-01-02T00:00:00.000Z',
      },
    ];

    it('should encode and decode plan comments', () => {
      const original = {
        schemaVersion: 1,
        comments,
      };

      const encoded = encodePlanComments(original);
      const decoded = decodePlanComments(encoded);

      expect(decoded).toEqual(original);
    });

    it('should migrate legacy plan comments with threads key', () => {
      const legacy = JSON.stringify({
        threads: comments,
      });

      const decoded = decodePlanComments(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded?.schemaVersion).toBe(1);
      expect(decoded?.comments).toEqual(comments);
    });

    it('should migrate legacy plan comments with comments key', () => {
      const legacy = JSON.stringify({
        comments,
      });

      const decoded = decodePlanComments(legacy);

      expect(decoded).not.toBeNull();
      expect(decoded?.schemaVersion).toBe(1);
      expect(decoded?.comments).toEqual(comments);
    });

    it('should return null for invalid plan comments', () => {
      expect(decodePlanComments(null)).toBeNull();
      expect(decodePlanComments('')).toBeNull();
      expect(decodePlanComments('{}')).toBeNull();
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
