import { describe, expect, it } from 'bun:test';
import type { AgentModelConfig, SpecData, TaskStatus, WarcraftConfig } from './types.js';

describe('types advanced validation', () => {
  describe('AgentModelConfig', () => {
    it('accepts minimal config', () => {
      const config: AgentModelConfig = {};
      expect(config).toBeDefined();
    });

    it('accepts full config', () => {
      const config: AgentModelConfig = {
        model: 'openai/gpt-5.3-codex',
        temperature: 0.5,
        skills: ['planning', 'coding'],
        autoLoadSkills: ['test-driven'],
      };
      expect(config.model).toBe('openai/gpt-5.3-codex');
      expect(config.temperature).toBe(0.5);
      expect(config.skills).toHaveLength(2);
    });
  });

  describe('WarcraftConfig', () => {
    it('accepts minimal config', () => {
      const config: WarcraftConfig = {};
      expect(config).toBeDefined();
    });

    it('accepts config with agents', () => {
      const config: WarcraftConfig = {
        beadsMode: 'on',
        agents: {
          khadgar: { model: 'openai/gpt-5.3-codex' },
        },
      };
      expect(config.agents?.khadgar?.model).toBe('openai/gpt-5.3-codex');
    });
  });

  describe('SpecData completeness', () => {
    it('all fields present', () => {
      const spec: SpecData = {
        featureName: 'feat',
        task: { folder: '01-a', name: 'Task A', order: 1 },
        dependsOn: ['00-init'],
        allTasks: [
          { folder: '01-a', name: 'Task A', order: 1 },
          { folder: '02-b', name: 'Task B', order: 2 },
        ],
        planSection: '## Plan\n\nDo things',
        contextFiles: [
          { name: 'decisions', content: 'Use TS' },
          { name: 'learnings', content: 'Perf matters' },
        ],
        completedTasks: [{ name: 'Init', summary: 'Initialized' }],
      };
      expect(spec.featureName).toBe('feat');
      expect(spec.task.folder).toBe('01-a');
      expect(spec.dependsOn).toHaveLength(1);
      expect(spec.allTasks).toHaveLength(2);
      expect(spec.planSection).toContain('Plan');
      expect(spec.contextFiles).toHaveLength(2);
      expect(spec.completedTasks).toHaveLength(1);
    });
  });

  describe('TaskStatus advanced', () => {
    it('supports retryCount', () => {
      const status: TaskStatus = {
        status: 'failed',
        origin: 'plan',
        retryCount: 3,
      };
      expect(status.retryCount).toBe(3);
    });

    it('supports error field', () => {
      const status: TaskStatus = {
        status: 'failed',
        origin: 'plan',
        error: 'Something went wrong',
      };
      expect(status.error).toBe('Something went wrong');
    });

    it('supports completedAt', () => {
      const status: TaskStatus = {
        status: 'done',
        origin: 'plan',
        completedAt: '2024-01-15T10:30:00Z',
      };
      expect(status.completedAt).toBe('2024-01-15T10:30:00Z');
    });

    it('supports startedAt', () => {
      const status: TaskStatus = {
        status: 'in_progress',
        origin: 'plan',
        startedAt: '2024-01-15T10:00:00Z',
      };
      expect(status.startedAt).toBe('2024-01-15T10:00:00Z');
    });
  });
});
