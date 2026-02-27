/**
 * Tests for BeadsRepository module.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { BeadsRepository, RepositoryError } from './BeadsRepository.js';
import { BeadGateway } from './BeadGateway.js';
import { BeadsViewerGateway } from './BeadsViewerGateway.js';
import type { FeatureJson, TaskStatus, PlanComment } from '../../types.js';
import { BeadGatewayError } from './BeadGateway.types.js';

// Mock BeadGateway
class MockBeadGateway {
  public artifacts = new Map<string, Record<string, string>>();
  public descriptions = new Map<string, string>();
  public comments: string[] = [];
  public labels = new Map<string, string[]>();
  public throwOn: string | null = null;

  checkAvailable(): string {
    if (this.throwOn === 'checkAvailable') {
      throw new Error('br not found');
    }
    return '1.0.0';
  }

  createEpic(name: string, priority: number): string {
    if (this.throwOn === 'createEpic') {
      throw new Error('Failed to create epic');
    }
    return `epic-${name}`;
  }

  createTask(title: string, epicBeadId: string, priority: number): string {
    if (this.throwOn === 'createTask') {
      throw new Error('Failed to create task');
    }
    return `task-${title}`;
  }

  syncTaskStatus(beadId: string, status: string): void {
    if (this.throwOn === 'syncTaskStatus') {
      throw new Error('Failed to sync status');
    }
  }

  closeBead(beadId: string): void {
    if (this.throwOn === 'closeBead') {
      throw new Error('Failed to close bead');
    }
  }

  flushArtifacts(): void {
    if (this.throwOn === 'flushArtifacts') {
      throw new Error('Failed to flush');
    }
  }

  importArtifacts(): void {
    if (this.throwOn === 'importArtifacts') {
      throw new Error('Failed to import');
    }
  }

  addLabel(beadId: string, label: string): void {
    if (this.throwOn === 'addLabel') {
      throw new Error('Failed to add label');
    }
    const existing = this.labels.get(beadId) || [];
    existing.push(label);
    this.labels.set(beadId, existing);
  }

  addComment(beadId: string, comment: string): void {
    if (this.throwOn === 'addComment') {
      throw new Error('Failed to add comment');
    }
    this.comments.push(comment);
  }

  show(beadId: string): unknown {
    if (this.throwOn === 'show') {
      throw new Error('Failed to show bead');
    }
    return { id: beadId, title: 'Test Bead', description: this.descriptions.get(beadId) || '' };
  }

  readDescription(beadId: string): string | null {
    if (this.throwOn === 'readDescription') {
      throw new Error('Failed to read description');
    }
    return this.descriptions.get(beadId) || null;
  }

  list(options?: {
    type?: string;
    parent?: string;
    status?: string;
  }): Array<{ id: string; title: string; status: string; type?: string }> {
    if (this.throwOn === 'list') {
      throw new Error('Failed to list beads');
    }
    // Return mock beads
    return [
      { id: 'epic-1', title: 'feature-one', status: 'open', type: 'epic' },
      { id: 'epic-2', title: 'feature-two', status: 'open', type: 'epic' },
      { id: 'task-1', title: 'Task 1', status: 'open', type: 'task' },
    ];
  }

  updateStatus(beadId: string, status: string): void {
    if (this.throwOn === 'updateStatus') {
      throw new Error('Failed to update status');
    }
  }

  updateDescription(beadId: string, content: string): void {
    if (this.throwOn === 'updateDescription') {
      throw new Error('Failed to update description');
    }
    this.descriptions.set(beadId, content);
  }

  upsertArtifact(beadId: string, kind: string, content: string): void {
    if (this.throwOn === 'upsertArtifact') {
      throw new Error('Failed to upsert artifact');
    }
    const beadArtifacts = this.artifacts.get(beadId) || {};
    beadArtifacts[kind] = content;
    this.artifacts.set(beadId, beadArtifacts);
  }

  readArtifact(beadId: string, kind: string): string | null {
    if (this.throwOn === 'readArtifact') {
      throw new Error('Failed to read artifact');
    }
    const beadArtifacts = this.artifacts.get(beadId);
    return beadArtifacts?.[kind] || null;
  }
}

// Mock BeadsViewerGateway
class MockBeadsViewerGateway {
  public enabled = true;
  public robotPlanResult: import('./BeadsViewerGateway.js').RobotPlanResult | null = null;
  public shouldThrow = false;

  getHealth() {
    return {
      enabled: this.enabled,
      available: this.enabled && !this.shouldThrow,
      lastError: this.shouldThrow ? 'Simulated error' : null,
      lastErrorAt: this.shouldThrow ? Date.now() : null,
      lastSuccessAt: this.shouldThrow ? null : Date.now(),
    };
  }

  getRobotPlan() {
    if (this.shouldThrow || !this.enabled) {
      return null;
    }
    return this.robotPlanResult;
  }
}

describe('BeadsRepository', () => {
  let mockGateway: MockBeadGateway;
  let mockViewer: MockBeadsViewerGateway;
  let repository: BeadsRepository;

  beforeEach(() => {
    mockGateway = new MockBeadGateway();
    mockViewer = new MockBeadsViewerGateway();
    // Create repository with mocks by injecting them
    repository = new BeadsRepository('/test/project', {}, 'on');
    // Replace the internal gateways with mocks
    (repository as any).gateway = mockGateway;
    (repository as any).viewerGateway = mockViewer;
  });

  describe('Constructor', () => {
    it('should create repository with default sync policy', () => {
      const repo = new BeadsRepository('/test', {}, 'on');
      expect(repo).toBeDefined();
    });

    it('should create repository with custom sync policy', () => {
      const repo = new BeadsRepository('/test', { autoImport: true, autoFlush: false }, 'on');
      expect(repo).toBeDefined();
    });
  });

  describe('Sync Operations', () => {
    it('should import artifacts successfully', () => {
      const result = repository.importArtifacts();
      expect(result.success).toBe(true);
    });

    it('should handle import failures', () => {
      mockGateway.throwOn = 'importArtifacts';
      const result = repository.importArtifacts();
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error.code).toBe('sync_failed');
      }
    });

    it('should flush artifacts successfully', () => {
      const result = repository.flushArtifacts();
      expect(result.success).toBe(true);
    });

    it('should handle flush failures', () => {
      mockGateway.throwOn = 'flushArtifacts';
      const result = repository.flushArtifacts();
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error.code).toBe('sync_failed');
      }
    });
  });

  describe('Epic Resolution', () => {
    it('should get epic by feature name', () => {
      const result = repository.getEpicByFeatureName('feature-one');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBe('epic-1');
    });

    it('should return null for non-existent feature when not strict', () => {
      const result = repository.getEpicByFeatureName('non-existent', false);
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBeNull();
    });

    it('should return error for non-existent feature when strict', () => {
      const result = repository.getEpicByFeatureName('non-existent', true);
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error.code).toBe('epic_not_found');
      }
    });
  });

  describe('Feature State Operations', () => {
    const mockFeatureJson: FeatureJson = {
      name: 'test-feature',
      epicBeadId: 'epic-123',
      status: 'planning',
      createdAt: '2024-01-01T00:00:00.000Z',
    };

    it('should get feature state', () => {
      const artifact = {
        schemaVersion: 1,
        name: 'test-feature',
        status: 'planning' as const,
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      mockGateway.artifacts.set('epic-123', {
        feature_state: JSON.stringify(artifact),
      });

      const result = repository.getFeatureState('epic-123');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).not.toBeNull();
    // @ts-expect-error - type narrowing in test
      expect(result.value?.name).toBe('test-feature');
    });

    it('should return null when feature state not found', () => {
      const result = repository.getFeatureState('epic-999');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBeNull();
    });

    it('should set feature state', () => {
      const result = repository.setFeatureState('epic-123', mockFeatureJson);
      expect(result.success).toBe(true);
    });

    it('should handle feature state read failures', () => {
      mockGateway.throwOn = 'readArtifact';
      const result = repository.getFeatureState('epic-123');
      expect(result.success).toBe(false);
    });
  });

  describe('Task State Operations', () => {
    const mockTaskStatus: TaskStatus = {
      schemaVersion: 1,
      status: 'pending',
      origin: 'plan',
      planTitle: 'Test task',
      beadId: 'task-123',
    };

    it('should get task state', () => {
      const artifact = {
        schemaVersion: 1,
        status: 'pending' as const,
        origin: 'plan' as const,
        planTitle: 'Test task',
        beadId: 'task-123',
      };
      mockGateway.artifacts.set('task-123', {
        task_state: JSON.stringify(artifact),
      });

      const result = repository.getTaskState('task-123');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).not.toBeNull();
    // @ts-expect-error - type narrowing in test
      expect(result.value?.status).toBe('pending');
    });

    it('should return null when task state not found', () => {
      const result = repository.getTaskState('task-999');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBeNull();
    });

    it('should set task state', () => {
      const result = repository.setTaskState('task-123', mockTaskStatus);
      expect(result.success).toBe(true);
    });
  });

  describe('Plan Operations', () => {
    it('should set plan description', () => {
      const result = repository.setPlanDescription('epic-123', '# Plan\n\nContent');
      expect(result.success).toBe(true);
      expect(mockGateway.descriptions.get('epic-123')).toBe('# Plan\n\nContent');
    });

    it('should get plan description', () => {
      mockGateway.descriptions.set('epic-123', '# Test Plan');
      const result = repository.getPlanDescription('epic-123');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBe('# Test Plan');
    });

    it('should get plan approval', () => {
      const approval = {
        schemaVersion: 1,
        hash: 'abc123',
        approvedAt: '2024-01-01T00:00:00.000Z',
      };
      mockGateway.artifacts.set('epic-123', {
        plan_approval: JSON.stringify(approval),
      });

      const result = repository.getPlanApproval('epic-123');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).not.toBeNull();
    // @ts-expect-error - type narrowing in test
      expect(result.value?.hash).toBe('abc123');
    });

    it('should set plan approval', () => {
      const result = repository.setPlanApproval('epic-123', 'hash-456', '2024-01-01T00:00:00.000Z');
      expect(result.success).toBe(true);
    });

    it('should get approved plan', () => {
      const approvedPlan = {
        schemaVersion: 1,
        content: '# Approved Plan',
        snapshotAt: '2024-01-01T00:00:00.000Z',
        contentHash: 'sha-256',
      };
      mockGateway.artifacts.set('epic-123', {
        approved_plan: JSON.stringify(approvedPlan),
      });

      const result = repository.getApprovedPlan('epic-123');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBe('# Approved Plan');
    });

    it('should set approved plan', () => {
      const result = repository.setApprovedPlan('epic-123', '# Plan', 'sha-256');
      expect(result.success).toBe(true);
    });

    it('should append plan comment', () => {
      const result = repository.appendPlanComment('epic-123', 'Test comment');
      expect(result.success).toBe(true);
      expect(mockGateway.comments).toContain('Test comment');
    });

    it('should get plan comments', () => {
      const comments: PlanComment[] = [
        {
          id: '1',
          line: 10,
          body: 'Test comment',
          author: 'user',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      ];
      mockGateway.artifacts.set('epic-123', {
        plan_comments: JSON.stringify({ schemaVersion: 1, comments }),
      });

      const result = repository.getPlanComments('epic-123');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toEqual(comments);
    });

    it('should set plan comments', () => {
      const comments: PlanComment[] = [
        {
          id: '1',
          line: 10,
          body: 'New comment',
          author: 'user',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      ];
      const result = repository.setPlanComments('epic-123', comments);
      expect(result.success).toBe(true);
    });
  });

  describe('Task Artifact Operations', () => {
    it('should upsert task artifact', () => {
      const result = repository.upsertTaskArtifact('task-123', 'spec', '# Spec content');
      expect(result.success).toBe(true);
    });

    it('should read task artifact', () => {
      mockGateway.artifacts.set('task-123', {
        spec: '# Test Spec',
      });

      const result = repository.readTaskArtifact('task-123', 'spec');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBe('# Test Spec');
    });

    it('should return null for missing artifact', () => {
      const result = repository.readTaskArtifact('task-123', 'spec');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBeNull();
    });

    it('should decode worker_prompt artifact', () => {
      const artifact = {
        schemaVersion: 1,
        content: 'Worker prompt content',
        generatedAt: '2024-01-01T00:00:00.000Z',
      };
      mockGateway.artifacts.set('task-123', {
        worker_prompt: JSON.stringify(artifact),
      });

      const result = repository.readTaskArtifact('task-123', 'worker_prompt');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBe('Worker prompt content');
    });

    it('should decode report artifact', () => {
      const artifact = {
        schemaVersion: 1,
        content: '# Report',
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      mockGateway.artifacts.set('task-123', {
        report: JSON.stringify(artifact),
      });

      const result = repository.readTaskArtifact('task-123', 'report');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBe('# Report');
    });
  });

  describe('Task Bead Listing', () => {
    it('should list task beads for epic', () => {
      const result = repository.listTaskBeadsForEpic('epic-1');
      expect(result.success).toBe(true);
    // @ts-expect-error - type narrowing in test
      expect(result.value).toBeDefined();
    // @ts-expect-error - type narrowing in test
      expect(Array.isArray(result.value)).toBe(true);
    });
  });

  describe('Workflow Labels', () => {
    it('should add workflow label', () => {
      const result = repository.addWorkflowLabel('epic-123', 'approved');
      expect(result.success).toBe(true);
      const labels = mockGateway.labels.get('epic-123') || [];
      expect(labels).toContain('approved');
    });
  });

  describe('Robot Plan', () => {
    it('should get robot plan', () => {
      mockViewer.robotPlanResult = {
        summary: { totalTracks: 2, totalTasks: 5 },
        tracks: [
          { trackId: 'track-1', tasks: ['task-1', 'task-2'] },
          { trackId: 'track-2', tasks: ['task-3', 'task-4', 'task-5'] },
        ],
      };

      const result = repository.getRobotPlan();
      expect(result).not.toBeNull();
      expect(result?.summary.totalTracks).toBe(2);
    });

    it('should return null when robot plan unavailable', () => {
      mockViewer.robotPlanResult = null;
      const result = repository.getRobotPlan();
      expect(result).toBeNull();
    });

    it('should get viewer health', () => {
      const health = repository.getViewerHealth();
      expect(health).toBeDefined();
      expect(health.enabled).toBe(true);
    });
  });

  describe('Error Normalization', () => {
    it('should normalize gateway errors', () => {
      mockGateway.throwOn = 'readArtifact';
      const result = repository.getFeatureState('epic-123');
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error.code).toBe('gateway_error');
        expect(result.error.message).toContain('Bead gateway error');
      }
    });

    it('should include internal gateway codes in normalized errors', () => {
      mockGateway.readArtifact = () => {
        throw new BeadGatewayError(
          'command_error',
          'Failed to initialize beads repository [BR_INIT_FAILED]: br command failed',
          'BR_INIT_FAILED',
        );
      };

      const result = repository.getFeatureState('epic-123');
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error.code).toBe('gateway_error');
        expect(result.error.message).toContain('[BR_INIT_FAILED]');
        expect(result.error.message).toContain('Failed to initialize beads repository');
      }
    });
  });

  describe('Direct Gateway Access', () => {
    it('should provide access to underlying gateway', () => {
      const gateway = repository.getGateway();
      expect(gateway).toBeDefined();
    });

    it('should provide access to underlying viewer gateway', () => {
      const viewer = repository.getViewerGateway();
      expect(viewer).toBeDefined();
    });
  });
});
