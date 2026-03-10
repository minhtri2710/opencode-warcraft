import { describe, expect, it } from 'bun:test';
import type { FeatureService, TaskService, WorktreeService } from 'warcraft-core';
import { DoctorTools } from './doctor-tool.js';

interface DiagnosticCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  details?: unknown;
}

interface DiagnosticResult {
  success: boolean;
  data: {
    checks: DiagnosticCheck[];
    summary: string;
  };
}

function createMockFeatureService(overrides: Partial<Record<string, unknown>> = {}): FeatureService {
  return {
    list: () => ['test-feature'],
    get: () => ({
      name: 'test-feature',
      status: 'executing',
      createdAt: '2025-01-01T00:00:00Z',
    }),
    ...overrides,
  } as unknown as FeatureService;
}

function createMockTaskService(overrides: Partial<Record<string, unknown>> = {}): TaskService {
  return {
    list: () => [],
    getRawStatus: () => null,
    ...overrides,
  } as unknown as TaskService;
}

function createMockWorktreeService(overrides: Partial<Record<string, unknown>> = {}): WorktreeService {
  return {
    listAll: () => Promise.resolve([]),
    ...overrides,
  } as unknown as WorktreeService;
}

function createDoctorTools(overrides: Partial<Record<string, unknown>> = {}): DoctorTools {
  return new DoctorTools({
    featureService: createMockFeatureService(overrides.featureService as Partial<Record<string, unknown>>),
    taskService: createMockTaskService(overrides.taskService as Partial<Record<string, unknown>>),
    worktreeService: createMockWorktreeService(overrides.worktreeService as Partial<Record<string, unknown>>),
    checkBlocked: (overrides.checkBlocked as (feature: string) => { blocked: boolean }) ?? (() => ({ blocked: false })),
  });
}

async function runDoctor(overrides: Partial<Record<string, unknown>> = {}): Promise<DiagnosticResult> {
  const tools = createDoctorTools(overrides);
  const doctorTool = tools.doctorTool();
  const rawResult = await doctorTool.execute({});
  return JSON.parse(rawResult);
}

describe('DoctorTools', () => {
  describe('doctorTool', () => {
    it('returns all-ok when no issues found', async () => {
      const result = await runDoctor();

      expect(result.success).toBe(true);
      expect(result.data.checks.length).toBeGreaterThan(0);
      expect(result.data.checks.every((c) => c.status === 'ok')).toBe(true);
      expect(result.data.summary).toContain('0 issues');
    });

    it('detects stuck dispatch_prepared tasks', async () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 120_000).toISOString();

      const result = await runDoctor({
        taskService: {
          list: () => [{ folder: '01-setup', name: 'Setup', status: 'dispatch_prepared', origin: 'plan' }],
          getRawStatus: () => ({
            status: 'dispatch_prepared',
            origin: 'plan',
            startedAt: twoMinutesAgo,
          }),
        },
      });

      expect(result.success).toBe(true);
      const check = result.data.checks.find((c) => c.name === 'stuck_dispatch_prepared');
      expect(check).toBeDefined();
      expect(check!.status).toBe('warning');
      expect(check!.message).toContain('dispatch_prepared');
      expect(check!.details).toBeDefined();
    });

    it('detects stuck in_progress tasks without recent activity', async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();

      const result = await runDoctor({
        taskService: {
          list: () => [{ folder: '01-setup', name: 'Setup', status: 'in_progress', origin: 'plan' }],
          getRawStatus: () => ({
            status: 'in_progress',
            origin: 'plan',
            startedAt: twoHoursAgo,
            workerSession: { lastHeartbeatAt: twoHoursAgo },
          }),
        },
      });

      expect(result.success).toBe(true);
      const check = result.data.checks.find((c) => c.name === 'stuck_in_progress');
      expect(check).toBeDefined();
      expect(check!.status).toBe('warning');
      expect(check!.message).toContain('in_progress');
    });

    it('detects checkBlocked failures (fail-closed)', async () => {
      const result = await runDoctor({
        checkBlocked: () => ({
          blocked: true,
          reason: 'File read error',
          message: 'Blocked due to read failure',
        }),
      });

      expect(result.success).toBe(true);
      const check = result.data.checks.find((c) => c.name === 'check_blocked_failures');
      expect(check).toBeDefined();
      expect(check!.status).toBe('warning');
      expect(check!.message).toContain('blocked');
    });

    it('detects direct-mode degradation', async () => {
      const result = await runDoctor({
        taskService: {
          list: () => [{ folder: '01-setup', name: 'Setup', status: 'in_progress', origin: 'plan' }],
          getRawStatus: () => ({
            status: 'in_progress',
            origin: 'plan',
            startedAt: new Date().toISOString(),
            workerSession: {
              workspaceMode: 'direct',
              workspacePath: '/repo/root',
              lastHeartbeatAt: new Date().toISOString(),
            },
          }),
        },
      });

      expect(result.success).toBe(true);
      const check = result.data.checks.find((c) => c.name === 'direct_mode_degradation');
      expect(check).toBeDefined();
      expect(check!.status).toBe('warning');
      expect(check!.message).toContain('direct');
    });

    it('detects stale worktrees', async () => {
      const result = await runDoctor({
        worktreeService: {
          listAll: () =>
            Promise.resolve([
              {
                mode: 'worktree',
                path: '/tmp/wt/test-feature/01-setup',
                feature: 'test-feature',
                step: '01-setup',
                isStale: true,
                lastCommitAge: 7 * 86_400_000,
              },
            ]),
        },
      });

      expect(result.success).toBe(true);
      const check = result.data.checks.find((c) => c.name === 'stale_worktrees');
      expect(check).toBeDefined();
      expect(check!.status).toBe('warning');
      expect(check!.message).toContain('stale');
    });

    it('detects orphaned branches (worktree for completed task)', async () => {
      const result = await runDoctor({
        taskService: {
          list: () => [{ folder: '01-setup', name: 'Setup', status: 'done', origin: 'plan' }],
          getRawStatus: () => ({
            status: 'done',
            origin: 'plan',
          }),
        },
        worktreeService: {
          listAll: () =>
            Promise.resolve([
              {
                mode: 'worktree',
                path: '/tmp/wt/test-feature/01-setup',
                branch: 'test-feature/01-setup',
                feature: 'test-feature',
                step: '01-setup',
                isStale: false,
                lastCommitAge: 1000,
              },
            ]),
        },
      });

      expect(result.success).toBe(true);
      const check = result.data.checks.find((c) => c.name === 'orphaned_branches');
      expect(check).toBeDefined();
      expect(check!.status).toBe('warning');
      expect(check!.message).toContain('orphan');
    });

    it('reports summary with correct issue count', async () => {
      const now = new Date();
      const twoMinutesAgo = new Date(now.getTime() - 120_000).toISOString();

      const result = await runDoctor({
        taskService: {
          list: () => [{ folder: '01-setup', name: 'Setup', status: 'dispatch_prepared', origin: 'plan' }],
          getRawStatus: () => ({
            status: 'dispatch_prepared',
            origin: 'plan',
            startedAt: twoMinutesAgo,
          }),
        },
        checkBlocked: () => ({
          blocked: true,
          reason: 'File read error',
          message: 'Blocked due to read failure',
        }),
      });

      expect(result.success).toBe(true);
      const issueCount = result.data.checks.filter((c) => c.status !== 'ok').length;
      expect(issueCount).toBeGreaterThanOrEqual(2);
      expect(result.data.summary).toContain(`${issueCount} issue`);
    });

    it('handles features with no tasks gracefully', async () => {
      const result = await runDoctor({
        featureService: {
          list: () => ['empty-feature'],
          get: () => ({
            name: 'empty-feature',
            status: 'planning',
            createdAt: '2025-01-01T00:00:00Z',
          }),
        },
      });

      expect(result.success).toBe(true);
      expect(result.data.checks.every((c) => c.status === 'ok')).toBe(true);
    });

    it('handles no features gracefully', async () => {
      const result = await runDoctor({
        featureService: {
          list: () => [],
          get: () => null,
        },
      });

      expect(result.success).toBe(true);
      expect(result.data.checks.every((c) => c.status === 'ok')).toBe(true);
    });
  });
});
