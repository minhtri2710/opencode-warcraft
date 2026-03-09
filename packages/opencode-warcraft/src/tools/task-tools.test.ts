import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as child_process from 'child_process';
import * as fs from 'fs';
import type { FeatureService, PlanService, TaskService, TaskStatusType } from 'warcraft-core';
import { createNoopEventLogger, InvalidTransitionError } from 'warcraft-core';
import { TaskTools } from './task-tools';

const TEST_DIR = `/tmp/opencode-warcraft-task-tools-test-${process.pid}`;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

class MockTaskService implements Partial<TaskService> {
  private createCalls: Array<{ feature: string; name: string; order?: number; priority?: number }> = [];

  create(featureName: string, name: string, order?: number, priority?: number): string {
    this.createCalls.push({ feature: featureName, name, order, priority });
    const orderStr = order !== undefined ? String(order).padStart(2, '0') : '01';
    return `${orderStr}-${name.toLowerCase().replace(/\s+/g, '-')}`;
  }

  getLastPriority(): number | undefined {
    const lastCall = this.createCalls[this.createCalls.length - 1];
    return lastCall?.priority;
  }

  getCreateCallCount(): number {
    return this.createCalls.length;
  }
}

class MockFeatureService implements Partial<FeatureService> {
  get(name: string) {
    return {
      name,
      epicBeadId: 'bd-epic-test',
      status: 'executing',
      createdAt: new Date().toISOString(),
    };
  }
}

class MockPlanService implements Partial<PlanService> {
  read() {
    return {
      content: '# Plan\n\n### 1. Test Task\n\nDescription.',
      approved: true,
    };
  }
}

const validateTaskStatus = (status: string): TaskStatusType => {
  const valid: TaskStatusType[] = ['pending', 'in_progress', 'done', 'blocked', 'failed', 'cancelled', 'partial'];
  if (valid.includes(status as TaskStatusType)) {
    return status as TaskStatusType;
  }
  throw new Error(`Invalid status: ${status}`);
};

describe('TaskTools', () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>;
  let mockTaskService: MockTaskService;
  let mockFeatureService: MockFeatureService;
  let mockPlanService: MockPlanService;
  let taskTools: TaskTools;

  const resolveFeature = (name?: string): string | null => {
    return name || 'test-feature';
  };

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    mockTaskService = new MockTaskService();
    mockFeatureService = new MockFeatureService();
    mockPlanService = new MockPlanService();
    taskTools = new TaskTools({
      featureService: mockFeatureService as unknown as FeatureService,
      planService: mockPlanService as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });
    execFileSyncSpy = spyOn(child_process, 'execFileSync').mockReturnValue('' as unknown as Buffer);
  });

  afterEach(() => {
    execFileSyncSpy.mockRestore();
    cleanup();
  });

  describe('createTaskTool', () => {
    it('accepts priority parameter and passes it to service', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 5,
      });

      expect(mockTaskService.getLastPriority()).toBe(5);
      expect(result).toContain('Manual task created');
    });

    it('defaults to priority 3 when not specified', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: undefined,
      });

      expect(mockTaskService.getLastPriority()).toBe(3);
      expect(result).toContain('Manual task created');
    });

    it('validates priority is within range 1-5', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);

      // Test priority 0 (invalid)
      const result0 = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 0,
      });
      const parsed0 = JSON.parse(result0);
      expect(parsed0.success).toBe(false);
      expect(parsed0.error).toContain('Priority must be an integer between 1 and 5');
      expect(result0).toContain('Priority must be an integer between 1 and 5');

      // Test priority 6 (invalid)
      const result6 = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 6,
      });
      const parsed6 = JSON.parse(result6);
      expect(parsed6.success).toBe(false);
      expect(parsed6.error).toContain('Priority must be an integer between 1 and 5');
      expect(result6).toContain('Priority must be an integer between 1 and 5');

      // Test non-integer priority (invalid)
      const resultDecimal = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 2.5,
      });
      const parsedDecimal = JSON.parse(resultDecimal);
      expect(parsedDecimal.success).toBe(false);
      expect(parsedDecimal.error).toContain('Priority must be an integer between 1 and 5');
      expect(resultDecimal).toContain('Priority must be an integer between 1 and 5');
    });

    it('accepts valid priorities 1-5', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);

      for (let p = 1; p <= 5; p++) {
        const result = await tool.execute({
          name: `Test Task ${p}`,
          order: undefined,
          feature: undefined,
          priority: p,
        });
        expect(result).not.toContain('Error');
        expect(result).toContain('Manual task created');
      }
    });

    it('includes priority value in error message', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Test Task',
        order: undefined,
        feature: undefined,
        priority: 0,
      });
      expect(result).toContain('0');
    });

    it('passes order parameter to service', async () => {
      const tool = taskTools.createTaskTool(resolveFeature);
      const result = await tool.execute({
        name: 'Test Task',
        order: 5,
        feature: undefined,
        priority: 3,
      });

      expect(result).toContain('05-test-task');
    });
  });
});

// ============================================================================
// updateTaskTool transition tests
// ============================================================================

/**
 * Extended mock TaskService for updateTaskTool tests that supports get(), update(), and transition().
 */
class MockUpdateTaskService {
  private _status: TaskStatusType;
  public transitionCalls: Array<{
    feature: string;
    task: string;
    toStatus: TaskStatusType;
    extras?: Record<string, unknown>;
  }> = [];
  public updateCalls: Array<{ feature: string; task: string; patch: Record<string, unknown> }> = [];
  public shouldThrowOnTransition: Error | null = null;

  constructor(initialStatus: TaskStatusType = 'pending') {
    this._status = initialStatus;
  }

  get(_feature: string, task: string) {
    return {
      folder: task,
      name: 'Test Task',
      status: this._status,
      origin: 'plan' as const,
    };
  }

  transition(feature: string, task: string, toStatus: TaskStatusType, extras?: Record<string, unknown>) {
    if (this.shouldThrowOnTransition) {
      throw this.shouldThrowOnTransition;
    }
    this.transitionCalls.push({ feature, task, toStatus, extras });
    this._status = toStatus;
    return { folder: task, name: 'Test Task', status: toStatus, origin: 'plan' as const };
  }

  update(feature: string, task: string, patch: Record<string, unknown>) {
    this.updateCalls.push({ feature, task, patch });
    return { folder: task, name: 'Test Task', status: this._status, origin: 'plan' as const };
  }
}

describe('updateTaskTool transitions', () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>;
  const resolveFeature = (name?: string): string | null => name || 'test-feature';
  const validateTaskStatus = (status: string): TaskStatusType => {
    const valid: TaskStatusType[] = ['pending', 'in_progress', 'done', 'blocked', 'failed', 'cancelled', 'partial'];
    if (valid.includes(status as TaskStatusType)) return status as TaskStatusType;
    throw new Error(`Invalid status: ${status}`);
  };

  beforeEach(() => {
    execFileSyncSpy = spyOn(child_process, 'execFileSync').mockReturnValue('' as unknown as Buffer);
  });

  afterEach(() => {
    execFileSyncSpy.mockRestore();
  });

  it('rejects done → in_progress with explicit error', async () => {
    const mockTaskService = new MockUpdateTaskService('done');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    const result = await tool.execute(
      { task: '01-task', status: 'in_progress', summary: undefined, feature: undefined },
      {} as never,
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Cannot reopen completed task');
    expect(parsed.error).toContain('done → in_progress is not allowed');
    // Should NOT have called transition
    expect(mockTaskService.transitionCalls).toHaveLength(0);
  });

  it('catches InvalidTransitionError and returns tool error', async () => {
    const mockTaskService = new MockUpdateTaskService('done');
    mockTaskService.shouldThrowOnTransition = new InvalidTransitionError('done', 'pending');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    // done → cancelled IS allowed in the state machine, but let's simulate the service throwing
    // by forcing the mock to throw on any transition
    const result = await tool.execute(
      { task: '01-task', status: 'cancelled', summary: undefined, feature: undefined },
      {} as never,
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain('Cannot update task');
    expect(parsed.error).toContain('Invalid task status transition');
  });

  it('uses transition() for status changes', async () => {
    const mockTaskService = new MockUpdateTaskService('pending');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    const result = await tool.execute(
      { task: '01-task', status: 'in_progress', summary: 'Starting work', feature: undefined },
      {} as never,
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(true);
    // Should have called transition, not update
    expect(mockTaskService.transitionCalls).toHaveLength(1);
    expect(mockTaskService.transitionCalls[0].toStatus).toBe('in_progress');
    expect(mockTaskService.transitionCalls[0].extras).toEqual({ summary: 'Starting work' });
    expect(mockTaskService.updateCalls).toHaveLength(0);
  });

  it('uses update() for summary-only changes (no status)', async () => {
    const mockTaskService = new MockUpdateTaskService('in_progress');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    const result = await tool.execute(
      { task: '01-task', status: undefined, summary: 'Updated summary', feature: undefined },
      {} as never,
    );

    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(true);
    // Should have called update, not transition
    expect(mockTaskService.updateCalls).toHaveLength(1);
    expect(mockTaskService.updateCalls[0].patch).toEqual({ summary: 'Updated summary' });
    expect(mockTaskService.transitionCalls).toHaveLength(0);
  });

  it('rethrows non-InvalidTransitionError exceptions', async () => {
    const mockTaskService = new MockUpdateTaskService('pending');
    mockTaskService.shouldThrowOnTransition = new Error('Unexpected DB error');
    const taskTools = new TaskTools({
      featureService: { get: () => ({ name: 'test-feature', status: 'executing' }) } as unknown as FeatureService,
      planService: {} as unknown as PlanService,
      taskService: mockTaskService as unknown as TaskService,
      workflowGatesMode: 'warn',
      validateTaskStatus,
      eventLogger: createNoopEventLogger(),
    });

    const tool = taskTools.updateTaskTool(resolveFeature);
    expect(
      tool.execute({ task: '01-task', status: 'in_progress', summary: undefined, feature: undefined }, {} as never),
    ).rejects.toThrow('Unexpected DB error');
  });
});
