import { describe, expect, it } from 'bun:test';
import type { FeatureService, TaskService, WorktreeService } from 'warcraft-core';
import { DoctorTools } from '../packages/opencode-warcraft/src/tools/doctor-tool.js';

function createDoctorTools(): DoctorTools {
  return new DoctorTools({
    featureService: {
      list: () => ['test-feature'],
      get: () => ({
        name: 'test-feature',
        status: 'executing',
        createdAt: '2025-01-01T00:00:00Z',
      }),
    } as unknown as FeatureService,
    taskService: {
      list: () => [],
      getRawStatus: () => null,
    } as unknown as TaskService,
    worktreeService: {
      listAll: () => Promise.reject(new Error('worktree index unavailable')),
    } as unknown as WorktreeService,
    checkBlocked: () => ({ blocked: false }),
  });
}

describe('DoctorTools audit', () => {
  it('degrades gracefully when worktree inspection fails for a feature', async () => {
    const tool = createDoctorTools().doctorTool();
    const rawResult = await tool.execute({});
    const result = JSON.parse(rawResult) as {
      success: boolean;
      data: { checks: Array<{ name: string; status: string; message: string }>; summary: string };
    };

    expect(result.success).toBe(true);
    const check = result.data.checks.find((entry) => entry.name === 'stale_worktrees');
    expect(check).toBeDefined();
    expect(check?.status).toBe('warning');
    expect(check?.message).toContain('Failed to inspect worktrees');
    expect(result.data.summary).toContain('1 issue');
  });
});
