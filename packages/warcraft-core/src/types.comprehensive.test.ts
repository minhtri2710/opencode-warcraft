import { describe, expect, it } from 'bun:test';
import type {
  AgentModelConfig,
  BeadsMode,
  FeatureInfo,
  FeatureJson,
  FeatureStatusType,
  PlanReadResult,
  SpecData,
  TaskInfo,
  TaskStatus,
  TaskStatusType,
  WarcraftConfig,
  WorkerSession,
} from './types.js';

describe('types runtime validation', () => {
  describe('TaskStatusType values', () => {
    const VALID_STATUSES: TaskStatusType[] = [
      'pending',
      'in_progress',
      'dispatch_prepared',
      'done',
      'cancelled',
      'blocked',
      'failed',
      'partial',
    ];

    for (const status of VALID_STATUSES) {
      it(`"${status}" is assignable`, () => {
        const s: TaskStatusType = status;
        expect(s).toBe(status);
      });
    }
  });

  describe('FeatureStatusType values', () => {
    const VALID_STATUSES: FeatureStatusType[] = ['planning', 'approved', 'executing', 'completed'];

    for (const status of VALID_STATUSES) {
      it(`"${status}" is assignable`, () => {
        const s: FeatureStatusType = status;
        expect(s).toBe(status);
      });
    }
  });

  describe('BeadsMode values', () => {
    const VALID_MODES: BeadsMode[] = ['on', 'off'];
    for (const mode of VALID_MODES) {
      it(`"${mode}" is assignable`, () => {
        const m: BeadsMode = mode;
        expect(m).toBe(mode);
      });
    }
  });

  describe('TaskStatus structure', () => {
    it('minimal TaskStatus', () => {
      const status: TaskStatus = { status: 'pending', origin: 'plan' };
      expect(status.status).toBe('pending');
    });

    it('full TaskStatus', () => {
      const status: TaskStatus = {
        schemaVersion: 1,
        status: 'done',
        origin: 'manual',
        planTitle: 'Test',
        summary: 'Completed',
        startedAt: '2024-01-01',
        completedAt: '2024-01-02',
        dependsOn: ['01-a'],
        folder: '02-b',
        learnings: ['Learned X'],
      };
      expect(status.status).toBe('done');
      expect(status.learnings!.length).toBe(1);
    });
  });

  describe('FeatureJson structure', () => {
    it('minimal feature', () => {
      const f: FeatureJson = { name: 'feat', status: 'planning', createdAt: '2024-01-01' };
      expect(f.name).toBe('feat');
    });

    it('full feature', () => {
      const f: FeatureJson = {
        name: 'feat',
        status: 'completed',
        createdAt: '2024-01-01',
        completedAt: '2024-01-02',
        approvedAt: '2024-01-01',
        ticket: 'JIRA-1',
        sessionId: 'sess-1',
      };
      expect(f.completedAt).toBeDefined();
    });
  });

  describe('WorkerSession structure', () => {
    it('minimal session', () => {
      const ws: WorkerSession = { sessionId: 'sess-1' };
      expect(ws.sessionId).toBe('sess-1');
    });

    it('full session', () => {
      const ws: WorkerSession = {
        sessionId: 'sess-1',
        taskId: 'task-1',
        workerId: 'w-1',
        agent: 'saurfang',
        mode: 'delegate',
        workspaceMode: 'worktree',
        workspacePath: '/tmp/wt',
        workspaceBranch: 'warcraft/feat/01-a',
        lastHeartbeatAt: '2024-01-01',
        attempt: 1,
        messageCount: 5,
      };
      expect(ws.mode).toBe('delegate');
    });
  });

  describe('PlanReadResult structure', () => {
    it('planning status', () => {
      const pr: PlanReadResult = { content: '# Plan', status: 'planning' };
      expect(pr.status).toBe('planning');
    });

    it('approved status', () => {
      const pr: PlanReadResult = { content: '# Plan', status: 'approved' };
      expect(pr.status).toBe('approved');
    });
  });
});
