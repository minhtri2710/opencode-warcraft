/**
 * Tests for BeadsRepository module.
 */

import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { TaskStatus } from '../../types.js';
import type { AuditEntry, AuditRecordParams } from './BeadGateway.types.js';
import { BeadGatewayError } from './BeadGateway.types.js';
import { BeadsRepository } from './BeadsRepository.js';

// Mock BeadGateway
class MockBeadGateway {
  public artifacts = new Map<string, Record<string, string>>();
  public descriptions = new Map<string, string>();
  public comments: string[] = [];
  public labels = new Map<string, string[]>();
  public throwOn: string | null = null;
  public auditRecords: AuditRecordParams[] = [];
  public auditLogEntries: AuditEntry[] = [];

  checkAvailable(): string {
    if (this.throwOn === 'checkAvailable') {
      throw new Error('br not found');
    }
    return '1.0.0';
  }

  createEpic(name: string, _priority: number): string {
    if (this.throwOn === 'createEpic') {
      throw new Error('Failed to create epic');
    }
    return `epic-${name}`;
  }

  createTask(title: string, _epicBeadId: string, _priority: number): string {
    if (this.throwOn === 'createTask') {
      throw new Error('Failed to create task');
    }
    return `task-${title}`;
  }

  syncTaskStatus(_beadId: string, _status: string): void {
    if (this.throwOn === 'syncTaskStatus') {
      throw new Error('Failed to sync status');
    }
  }

  closeBead(_beadId: string): void {
    if (this.throwOn === 'closeBead') {
      throw new Error('Failed to close bead');
    }
  }

  reopenBead(_beadId: string): void {
    if (this.throwOn === 'reopenBead') {
      throw new Error('Failed to reopen bead');
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

  addComment(_beadId: string, comment: string): void {
    if (this.throwOn === 'addComment') {
      throw new Error('Failed to add comment');
    }
    this.comments.push(comment);
  }

  show(beadId: string): unknown {
    if (this.throwOn === 'show') {
      throw new Error('Failed to show bead');
    }
    return {
      id: beadId,
      title: 'Test Bead',
      description: this.descriptions.get(beadId) || '',
      labels: this.labels.get(beadId) || [],
    };
  }

  showToon(beadId: string): string {
    if (this.throwOn === 'showToon') {
      throw new Error('Failed to show toon format');
    }
    return `${beadId} | Test Bead | open | priority:2`;
  }

  readDescription(beadId: string): string | null {
    if (this.throwOn === 'readDescription') {
      throw new Error('Failed to read description');
    }
    return this.descriptions.get(beadId) || null;
  }

  list(_options?: {
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

  updateStatus(_beadId: string, _status: string): void {
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

  auditRecord(params: AuditRecordParams): void {
    if (this.throwOn === 'auditRecord') {
      throw new Error('Failed to record audit event');
    }
    this.auditRecords.push(params);
  }

  auditLog(_beadId: string): AuditEntry[] {
    if (this.throwOn === 'auditLog') {
      throw new Error('Failed to retrieve audit log');
    }
    return this.auditLogEntries;
  }

  removeLabel(beadId: string, label: string): void {
    if (this.throwOn === 'removeLabel') {
      throw new Error('Failed to remove label');
    }
    const existing = this.labels.get(beadId) || [];
    this.labels.set(
      beadId,
      existing.filter((l) => l !== label),
    );
  }
}

// Mock BeadsViewerGateway
class MockBeadsViewerGateway {
  public enabled = true;
  public robotPlanResult: import('./BeadsViewerGateway.js').RobotPlanResult | null = null;
  public robotInsightsResult: import('./BeadsViewerGateway.js').RobotInsightsResult | null = null;
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

  getRobotInsights() {
    if (this.shouldThrow || !this.enabled) {
      return null;
    }
    return this.robotInsightsResult;
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

  describe('Bead lifecycle', () => {
    it('should reopen a bead successfully', () => {
      const result = repository.reopenBead('epic-123');

      expect(result.success).toBe(true);
    });

    it('should normalize reopen failures', () => {
      mockGateway.throwOn = 'reopenBead';
      const result = repository.reopenBead('epic-123');

      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error.code).toBe('gateway_error');
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

    it('requests all task beads so closed tasks stay visible', () => {
      const listSpy = spyOn(mockGateway, 'list').mockReturnValue([
        { id: 'task-1', title: 'Task 1', status: 'open', type: 'task' },
        { id: 'task-2', title: 'Task 2', status: 'closed', type: 'task' },
      ]);

      const result = repository.listTaskBeadsForEpic('epic-1');

      expect(listSpy).toHaveBeenCalledWith({ type: 'task', parent: 'epic-1', status: 'all' });
      expect(result.success).toBe(true);
      // @ts-expect-error - type narrowing in test
      expect(result.value?.map((task) => task.id)).toEqual(['task-1', 'task-2']);
    });
  });

  describe('Workflow Labels', () => {
    it('should add workflow label', () => {
      const result = repository.addWorkflowLabel('epic-123', 'approved');
      expect(result.success).toBe(true);
      const labels = mockGateway.labels.get('epic-123') || [];
      expect(labels).toContain('approved');
    });

    it('should return true when label exists via hasWorkflowLabel', () => {
      mockGateway.labels.set('epic-123', ['approved', 'in_progress']);
      const result = repository.hasWorkflowLabel('epic-123', 'approved');
      expect(result.success).toBe(true);
      // @ts-expect-error - type narrowing in test
      expect(result.value).toBe(true);
    });

    it('should return false when label does not exist via hasWorkflowLabel', () => {
      mockGateway.labels.set('epic-123', ['in_progress']);
      const result = repository.hasWorkflowLabel('epic-123', 'approved');
      expect(result.success).toBe(true);
      // @ts-expect-error - type narrowing in test
      expect(result.value).toBe(false);
    });

    it('should return false when bead has no labels via hasWorkflowLabel', () => {
      const result = repository.hasWorkflowLabel('epic-123', 'approved');
      expect(result.success).toBe(true);
      // @ts-expect-error - type narrowing in test
      expect(result.value).toBe(false);
    });

    it('should remove workflow label via removeWorkflowLabel', () => {
      mockGateway.labels.set('epic-123', ['approved', 'in_progress']);
      const result = repository.removeWorkflowLabel('epic-123', 'approved');
      expect(result.success).toBe(true);
      const labels = mockGateway.labels.get('epic-123') || [];
      expect(labels).not.toContain('approved');
      expect(labels).toContain('in_progress');
    });

    it('should swallow errors on removeWorkflowLabel (best-effort)', () => {
      mockGateway.throwOn = 'removeLabel';
      const result = repository.removeWorkflowLabel('epic-123', 'approved');
      // Best-effort: returns success even on failure
      expect(result.success).toBe(true);
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

    it('should get robot insights', () => {
      mockViewer.robotInsightsResult = {
        cycles: [{ beadIds: ['task-1', 'task-2', 'task-1'] }],
      };

      const result = repository.getRobotInsights();
      expect(result).not.toBeNull();
      expect(result?.cycles).toHaveLength(1);
    });

    it('should return null when robot insights unavailable', () => {
      mockViewer.robotInsightsResult = null;
      const result = repository.getRobotInsights();
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
      const result = repository.getTaskState('task-123');
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

      const result = repository.getTaskState('task-123');
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

  describe('Audit Operations', () => {
    it('should record audit event via gateway', () => {
      repository.recordAuditEvent('bd-1', {
        kind: 'llm_call',
        issueId: 'will-be-overridden',
        model: 'claude-opus-4',
      });

      expect(mockGateway.auditRecords).toHaveLength(1);
      expect(mockGateway.auditRecords[0].kind).toBe('llm_call');
      expect(mockGateway.auditRecords[0].issueId).toBe('bd-1');
      expect(mockGateway.auditRecords[0].model).toBe('claude-opus-4');
    });

    it('should swallow audit record errors (non-blocking sidecar)', () => {
      mockGateway.throwOn = 'auditRecord';

      // Must NOT throw — sidecar policy
      expect(() => {
        repository.recordAuditEvent('bd-1', { kind: 'tool_call', issueId: 'bd-1' });
      }).not.toThrow();
    });

    it('should retrieve audit log entries', () => {
      mockGateway.auditLogEntries = [
        { id: 'audit-1', kind: 'llm_call', issueId: 'bd-1', model: 'claude-opus-4' },
        { id: 'audit-2', kind: 'tool_call', issueId: 'bd-1', toolName: 'warcraft_status' },
      ];

      const entries = repository.getAuditLog('bd-1');

      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('audit-1');
      expect(entries[1].toolName).toBe('warcraft_status');
    });

    it('should return empty array on audit log failure (non-blocking sidecar)', () => {
      mockGateway.throwOn = 'auditLog';

      // Must NOT throw — sidecar policy
      const entries = repository.getAuditLog('bd-1');
      expect(entries).toEqual([]);
    });
  });

  describe('getBeadToon', () => {
    it('should return raw toon output from gateway', () => {
      const result = repository.getBeadToon('bd-1');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toBe('bd-1 | Test Bead | open | priority:2');
      }
    });

    it('should fall back to JSON show on toon failure and log warning', () => {
      mockGateway.throwOn = 'showToon';
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      const result = repository.getBeadToon('bd-1');

      expect(result.success).toBe(true);
      if (result.success) {
        // Falls back to JSON show() result
        expect(result.value).toBeDefined();
        expect(typeof result.value).toBe('string');
      }
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('[BeadsRepository]');
      expect(warnSpy.mock.calls[0][0]).toContain('toon');

      warnSpy.mockRestore();
    });

    it('should return error when both toon and JSON show fail', () => {
      mockGateway.throwOn = 'showToon';
      // Also make show() fail
      const originalShow = mockGateway.show.bind(mockGateway);
      mockGateway.show = () => {
        throw new Error('Both failed');
      };
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      const result = repository.getBeadToon('bd-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('gateway_error');
      }

      warnSpy.mockRestore();
      mockGateway.show = originalShow;
    });
  });
});
