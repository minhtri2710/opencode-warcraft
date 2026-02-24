/**
 * Tests for plugin tool registration parity
 * Ensures tools are properly registered after modularization
 */
import { describe, it, expect, beforeAll } from 'bun:test';
import type { Plugin } from '@opencode-ai/plugin';
import plugin from './index.js';

describe('Warcraft Plugin Tool Registration', () => {
  let pluginInstance: Awaited<ReturnType<Plugin>>;

  beforeAll(async () => {
    pluginInstance = await plugin({
      directory: '/tmp/test-warcraft',
      client: {} as any,
    });
  });

  it('should export a valid plugin', () => {
    expect(plugin).toBeDefined();
    expect(typeof plugin).toBe('function');
  });

  it('should have all 17 warcraft tools registered', () => {
    const tools = pluginInstance.tool;
    expect(tools).toBeDefined();

    // Feature tools
    expect(tools.warcraft_feature_create).toBeDefined();
    expect(tools.warcraft_feature_complete).toBeDefined();

    // Plan tools
    expect(tools.warcraft_plan_write).toBeDefined();
    expect(tools.warcraft_plan_read).toBeDefined();
    expect(tools.warcraft_plan_approve).toBeDefined();

    // Task tools
    expect(tools.warcraft_tasks_sync).toBeDefined();
    expect(tools.warcraft_task_create).toBeDefined();
    expect(tools.warcraft_task_update).toBeDefined();

    // Worktree tools
    expect(tools.warcraft_worktree_create).toBeDefined();
    expect(tools.warcraft_worktree_commit).toBeDefined();
    expect(tools.warcraft_worktree_discard).toBeDefined();
    expect(tools.warcraft_merge).toBeDefined();
    expect(tools.warcraft_batch_execute).toBeDefined();

    // Context tools
    expect(tools.warcraft_context_write).toBeDefined();
    expect(tools.warcraft_status).toBeDefined();
    expect(tools.warcraft_agents_md).toBeDefined();

    // Skill tools
    expect(tools.warcraft_skill).toBeDefined();
  });

  it('should have feature tool with correct description', () => {
    const tool = pluginInstance.tool.warcraft_feature_create;
    expect(tool.description).toContain('Create a new feature');
  });

  it('should have plan write tool with correct description', () => {
    const tool = pluginInstance.tool.warcraft_plan_write;
    expect(tool.description).toContain('Write plan.md');
  });

  it('should have task sync tool with correct description', () => {
    const tool = pluginInstance.tool.warcraft_tasks_sync;
    expect(tool.description).toContain('Generate tasks');
  });

  it('should have worktree create tool with correct description', () => {
    const tool = pluginInstance.tool.warcraft_worktree_create;
    expect(tool.description).toContain('Create worktree');
  });

  it('should have context write tool with correct description', () => {
    const tool = pluginInstance.tool.warcraft_context_write;
    expect(tool.description).toContain('context file');
  });

  it('should have skill tool with correct description', () => {
    const tool = pluginInstance.tool.warcraft_skill;
    expect(tool.description).toContain('Load a Warcraft skill');
  });
});

describe('Domain Tool Modules', () => {
  it('should export all tool classes from tools/index', async () => {
    const {
      FeatureTools,
      PlanTools,
      TaskTools,
      WorktreeTools,
      BatchTools,
      ContextTools,
      SkillTools,
    } = await import('./tools/index.js');

    expect(FeatureTools).toBeDefined();
    expect(PlanTools).toBeDefined();
    expect(TaskTools).toBeDefined();
    expect(WorktreeTools).toBeDefined();
    expect(BatchTools).toBeDefined();
    expect(ContextTools).toBeDefined();
    expect(SkillTools).toBeDefined();
  });
});
