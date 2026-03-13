/**
 * Tests for plugin tool registration parity
 * Ensures tools are properly registered after modularization
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import type { Plugin } from '@opencode-ai/plugin';
import { readFileSync } from 'fs';
import * as path from 'path';
import { warcraftAgents } from './agents/index.js';
import { mekkatorqueAgent } from './agents/mekkatorque.js';
import { saurfangAgent } from './agents/saurfang.js';
import { createTestOpencodeClient } from './e2e/helpers/opencode-client.js';
import plugin from './index.js';

const { client: OPENCODE_CLIENT } = createTestOpencodeClient();

describe('Warcraft Plugin Tool Registration', () => {
  let pluginInstance: Awaited<ReturnType<Plugin>>;

  beforeAll(async () => {
    pluginInstance = await plugin({
      directory: '/tmp/test-warcraft',
      client: OPENCODE_CLIENT,
    });
  });

  it('should export a valid plugin', () => {
    expect(plugin).toBeDefined();
    expect(typeof plugin).toBe('function');
  });

  it('should have all 18 warcraft tools registered', () => {
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
    expect(tools.warcraft_worktree_prune).toBeDefined();
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
    expect(tool.description).toContain('task workspace');
    expect(tool.description).toContain('task() payload');
  });

  it('should document worktree delegation as returning a task() payload, not auto-spawning a worker', async () => {
    const output = { system: [] as string[] };
    await pluginInstance['experimental.chat.system.transform']?.({ agent: 'khadgar' }, output);
    const joined = output.system.join('\n');

    expect(joined).toContain('returns the `task()` payload needed to launch the worker');
    expect(joined).toContain('Issue the returned `task()` call');
    expect(joined).toContain('warcraft_worktree_create(task)` → issue returned `task()` call');
    expect(joined).not.toContain('creates worktree and spawns worker automatically');
    expect(joined).not.toContain('warcraft_worktree_create(task)` → work in worktree → `warcraft_worktree_commit');
  });

  it('should keep Saurfang metadata aligned with returned-task orchestration semantics', () => {
    expect(saurfangAgent.description.toLowerCase()).not.toContain('spawns workers');
    expect(warcraftAgents.saurfang.description.toLowerCase()).not.toContain('spawns workers');

    const pluginConfigPath = path.resolve(import.meta.dir, 'plugin-config.ts');
    const pluginConfigSource = readFileSync(pluginConfigPath, 'utf-8').toLowerCase();

    expect(pluginConfigSource).not.toContain('delegates, spawns workers, verifies, merges');
    expect(pluginConfigSource).toContain('launches returned task() payloads');
  });

  it('should keep Mekkatorque metadata aligned with direct-mode support', () => {
    expect(warcraftAgents.mekkatorque.description.toLowerCase()).not.toContain('isolated worktrees');
    expect(warcraftAgents.mekkatorque.description).toContain('assigned workspace');

    // Exported mekkatorqueAgent from mekkatorque.ts must also not claim worktrees unconditionally
    expect(mekkatorqueAgent.description.toLowerCase()).not.toContain('isolated worktree');

    const pluginConfigPath = path.resolve(import.meta.dir, 'plugin-config.ts');
    const pluginConfigSource = readFileSync(pluginConfigPath, 'utf-8').toLowerCase();

    expect(pluginConfigSource).not.toContain('executes tasks directly in isolated worktrees');
    expect(pluginConfigSource).toContain('assigned workspace (worktree or direct mode)');
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
    const { FeatureTools, PlanTools, TaskTools, WorktreeTools, BatchTools, ContextTools, SkillTools } = await import(
      './tools/index.js'
    );

    expect(FeatureTools).toBeDefined();
    expect(PlanTools).toBeDefined();
    expect(TaskTools).toBeDefined();
    expect(WorktreeTools).toBeDefined();
    expect(BatchTools).toBeDefined();
    expect(ContextTools).toBeDefined();
    expect(SkillTools).toBeDefined();
  });
});
