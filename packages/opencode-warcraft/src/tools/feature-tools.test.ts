import { describe, expect, it, beforeEach, afterEach, spyOn } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { FeatureTools } from './feature-tools';
import type { FeatureService } from 'warcraft-core';

const TEST_DIR = '/tmp/opencode-warcraft-feature-tools-test-' + process.pid;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

class MockFeatureService implements Partial<FeatureService> {
  private features: Map<string, { name: string; epicBeadId: string; priority?: number }> = new Map();
  private createCallCount = 0;

  create(name: string, ticket?: string, priority?: number) {
    this.createCallCount++;
    const epicBeadId = `epic-${this.createCallCount}`;
    this.features.set(name, { name, epicBeadId, priority });
    return {
      name,
      epicBeadId,
      status: 'planning',
      ticket,
      createdAt: new Date().toISOString(),
    };
  }

  getCreateCallCount() {
    return this.createCallCount;
  }

  getLastPriority() {
    const lastFeature = Array.from(this.features.values()).pop();
    return lastFeature?.priority;
  }
}

describe('FeatureTools', () => {
  let execFileSyncSpy: ReturnType<typeof spyOn>;
  let mockFeatureService: MockFeatureService;
  let featureTools: FeatureTools;

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    mockFeatureService = new MockFeatureService();
    featureTools = new FeatureTools({
      featureService: mockFeatureService as unknown as FeatureService,
    });
    execFileSyncSpy = spyOn(child_process, 'execFileSync').mockReturnValue('' as unknown as Buffer);
  });

  afterEach(() => {
    execFileSyncSpy.mockRestore();
    cleanup();
  });

  describe('createFeatureTool', () => {
    it('accepts priority parameter and passes it to service', async () => {
      const tool = featureTools.createFeatureTool();
      const result = await tool.execute({
        name: 'test-feature',
        ticket: undefined,
        priority: 5,
      });

      expect(mockFeatureService.getLastPriority()).toBe(5);
      expect(result).toContain('test-feature');
      expect(result).toContain('created');
    });

    it('defaults to priority 3 when not specified', async () => {
      const tool = featureTools.createFeatureTool();
      const result = await tool.execute({
        name: 'test-feature',
        ticket: undefined,
        priority: undefined,
      });

      expect(mockFeatureService.getLastPriority()).toBe(3);
      expect(result).toContain('test-feature');
    });

    it('validates priority is within range 1-5', async () => {
      const tool = featureTools.createFeatureTool();

      // Test priority 0 (invalid)
      const result0 = await tool.execute({
        name: 'test-feature',
        ticket: undefined,
        priority: 0,
      });
      const parsed0 = JSON.parse(result0);
      expect(parsed0.success).toBe(false);
      expect(parsed0.error).toContain('Priority must be an integer between 1 and 5');

      // Test priority 6 (invalid)
      const result6 = await tool.execute({
        name: 'test-feature',
        ticket: undefined,
        priority: 6,
      });
      const parsed6 = JSON.parse(result6);
      expect(parsed6.success).toBe(false);
      expect(parsed6.error).toContain('Priority must be an integer between 1 and 5');

      // Test non-integer priority (invalid)
      const resultDecimal = await tool.execute({
        name: 'test-feature',
        ticket: undefined,
        priority: 2.5,
      });
      const parsedDecimal = JSON.parse(resultDecimal);
      expect(parsedDecimal.success).toBe(false);
      expect(parsedDecimal.error).toContain('Priority must be an integer between 1 and 5');
    });

    it('accepts valid priorities 1-5', async () => {
      const tool = featureTools.createFeatureTool();

      for (let p = 1; p <= 5; p++) {
        const result = await tool.execute({
          name: `test-feature-${p}`,
          ticket: undefined,
          priority: p,
        });
        expect(result).not.toContain('Error');
        expect(result).toContain(`test-feature-${p}`);
      }
    });

    it('includes priority value in error message', async () => {
      const tool = featureTools.createFeatureTool();
      const result = await tool.execute({
        name: 'test-feature',
        ticket: undefined,
        priority: 0,
      });
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('0');
    });
  });
});
