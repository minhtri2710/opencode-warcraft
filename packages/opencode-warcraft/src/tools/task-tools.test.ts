import { describe, expect, it, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { TaskTools } from './task-tools';
import type { FeatureService, PlanService, TaskService, TaskStatusType } from 'warcraft-core';

const TEST_DIR = '/tmp/opencode-warcraft-task-tools-test-' + process.pid;

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
