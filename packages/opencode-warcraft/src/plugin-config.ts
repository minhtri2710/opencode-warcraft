import * as os from 'os';
import type { ConfigService } from 'warcraft-core';
import { ALGALON_PROMPT } from './agents/algalon.js';
import { BRANN_PROMPT } from './agents/brann.js';
import { KHADGAR_PROMPT } from './agents/khadgar.js';
import { MEKKATORQUE_PROMPT } from './agents/mekkatorque.js';
import { MIMIRON_PROMPT } from './agents/mimiron.js';
import { SAURFANG_PROMPT } from './agents/saurfang.js';
import { loadFileSkill } from './skills/file-loader.js';
import { BUILTIN_SKILLS } from './skills/registry.generated.js';

// ============================================================================
// Agent Configuration Builder
// Builds per-agent config objects for the OpenCode config hook.
// ============================================================================

type WarcraftAgentName = 'khadgar' | 'mimiron' | 'saurfang' | 'brann' | 'mekkatorque' | 'algalon';

const WARCRAFT_AGENT_NAMES = new Set<WarcraftAgentName>([
  'khadgar',
  'mimiron',
  'saurfang',
  'brann',
  'mekkatorque',
  'algalon',
]);

const WARCRAFT_TOOL_IDS = [
  'warcraft_skill',
  'warcraft_feature_create',
  'warcraft_feature_complete',
  'warcraft_plan_write',
  'warcraft_plan_read',
  'warcraft_plan_approve',
  'warcraft_tasks_sync',
  'warcraft_task_create',
  'warcraft_task_update',
  'warcraft_worktree_create',
  'warcraft_worktree_commit',
  'warcraft_worktree_discard',
  'warcraft_merge',
  'warcraft_batch_execute',
  'warcraft_context_write',
  'warcraft_status',
  'warcraft_agents_md',
] as const;

type PermissionValue = 'allow' | 'deny';

function withWarcraftToolPermissions(
  basePermissions: Record<string, string>,
  access: PermissionValue,
): Record<string, string> {
  const nextPermissions: Record<string, string> = { ...basePermissions };
  for (const toolId of WARCRAFT_TOOL_IDS) {
    nextPermissions[toolId] = access;
  }
  return nextPermissions;
}

/**
 * Build auto-loaded skill templates for an agent.
 * Returns a string containing all skill templates to append to the agent's prompt.
 *
 * Resolution order for each skill ID:
 * 1. Builtin skill (wins if exists)
 * 2. File-based skill (project OpenCode -> global OpenCode -> project Claude -> global Claude)
 * 3. Warn and skip if not found
 */
async function buildAutoLoadedSkillsContent(
  agentName: WarcraftAgentName,
  configService: ConfigService,
  projectRoot: string,
): Promise<string> {
  const agentConfig = configService.getAgentConfig(agentName);
  const autoLoadSkills = agentConfig.autoLoadSkills ?? [];

  if (autoLoadSkills.length === 0) {
    return '';
  }

  // Use process.env.HOME for testability, fallback to os.homedir()
  const homeDir = process.env.HOME || os.homedir();
  const skillTemplates: string[] = [];

  for (const skillId of autoLoadSkills) {
    // 1. Try builtin skill first (builtin wins)
    const builtinSkill = BUILTIN_SKILLS.find((entry) => entry.name === skillId);
    if (builtinSkill) {
      skillTemplates.push(builtinSkill.template);
      continue;
    }

    // 2. Fallback to file-based skill
    const fileResult = await loadFileSkill(skillId, projectRoot, homeDir);
    if (fileResult.found && fileResult.skill) {
      skillTemplates.push(fileResult.skill.template);
      continue;
    }

    // 3. Not found - warn and skip
    console.warn(`[warcraft] Unknown skill id "${skillId}" for agent "${agentName}"`);
  }

  if (skillTemplates.length === 0) {
    return '';
  }

  return `\n\n${skillTemplates.join('\n\n')}`;
}

interface AgentSpec {
  name: WarcraftAgentName;
  prompt: string;
  description: string;
  temperature: number;
  mode?: 'subagent';
  permission: Record<string, string>;
}

async function buildAgentConfig(spec: AgentSpec, configService: ConfigService, directory: string) {
  const userConfig = configService.getAgentConfig(spec.name);
  const autoLoadedSkills = await buildAutoLoadedSkillsContent(spec.name, configService, directory);
  return {
    model: userConfig.model,
    variant: userConfig.variant,
    temperature: userConfig.temperature ?? spec.temperature,
    ...(spec.mode ? { mode: spec.mode } : {}),
    description: spec.description,
    prompt: spec.prompt + autoLoadedSkills,
    permission: withWarcraftToolPermissions(spec.permission, 'allow'),
  };
}

/**
 * Apply the config hook: build agent configs and merge into opencodeConfig.
 */
export async function applyWarcraftConfig(
  opencodeConfig: Record<string, unknown>,
  configService: ConfigService,
  directory: string,
  builtinMcps: Record<string, unknown>,
): Promise<void> {
  // Auto-generate config file with defaults if it doesn't exist
  configService.init();

  const [khadgarConfig, mimironConfig, saurfangConfig, brannConfig, mekkatorqueConfig, algalonConfig] =
    await Promise.all([
      buildAgentConfig(
        {
          name: 'khadgar',
          prompt: KHADGAR_PROMPT,
          description: 'Khadgar (Hybrid) - Plans + orchestrates. Detects phase, loads skills on-demand.',
          temperature: 0.5,
          permission: { question: 'allow', skill: 'allow', todowrite: 'allow', todoread: 'allow' },
        },
        configService,
        directory,
      ),
      buildAgentConfig(
        {
          name: 'mimiron',
          prompt: MIMIRON_PROMPT,
          description: 'Mimiron (Planner) - Plans features, interviews, writes plans. NEVER executes.',
          temperature: 0.7,
          permission: {
            edit: 'deny',
            task: 'allow',
            question: 'allow',
            skill: 'allow',
            todowrite: 'allow',
            todoread: 'allow',
            webfetch: 'allow',
            warcraft_plan_read: 'allow',
          },
        },
        configService,
        directory,
      ),
      buildAgentConfig(
        {
          name: 'saurfang',
          prompt: SAURFANG_PROMPT,
          description: 'Saurfang (Orchestrator) - Orchestrates execution. Delegates, spawns workers, verifies, merges.',
          temperature: 0.5,
          permission: { question: 'allow', skill: 'allow', todowrite: 'allow', todoread: 'allow' },
        },
        configService,
        directory,
      ),
      buildAgentConfig(
        {
          name: 'brann',
          prompt: BRANN_PROMPT,
          description: 'Brann (Explorer/Researcher/Retrieval) - Researches codebase + external docs/data.',
          temperature: 0.5,
          mode: 'subagent',
          permission: { edit: 'deny', task: 'deny', delegate: 'deny', skill: 'allow', webfetch: 'allow' },
        },
        configService,
        directory,
      ),
      buildAgentConfig(
        {
          name: 'mekkatorque',
          prompt: MEKKATORQUE_PROMPT,
          description: 'Mekkatorque (Worker/Coder) - Executes tasks directly in isolated worktrees. Never delegates.',
          temperature: 0.3,
          mode: 'subagent',
          permission: { task: 'deny', delegate: 'deny', skill: 'allow' },
        },
        configService,
        directory,
      ),
      buildAgentConfig(
        {
          name: 'algalon',
          prompt: ALGALON_PROMPT,
          description:
            'Algalon (Consultant/Reviewer/Debugger) - Reviews plan documentation quality. OKAY/REJECT verdict.',
          temperature: 0.3,
          mode: 'subagent',
          permission: { edit: 'deny', task: 'deny', delegate: 'deny', skill: 'allow' },
        },
        configService,
        directory,
      ),
    ]);

  // Build agents map based on agentMode
  const warcraftConfigData = configService.get();
  const agentMode = warcraftConfigData.agentMode ?? 'unified';

  const allAgents: Record<string, unknown> = {};

  if (agentMode === 'unified') {
    allAgents.khadgar = khadgarConfig;
    allAgents.brann = brannConfig;
    allAgents.mekkatorque = mekkatorqueConfig;
    allAgents.algalon = algalonConfig;
  } else {
    allAgents.mimiron = mimironConfig;
    allAgents.saurfang = saurfangConfig;
    allAgents.brann = brannConfig;
    allAgents.mekkatorque = mekkatorqueConfig;
    allAgents.algalon = algalonConfig;
  }

  // Merge agents into opencodeConfig.agent
  const configAgent = opencodeConfig.agent as Record<string, unknown> | undefined;
  if (!configAgent) {
    opencodeConfig.agent = allAgents;
  } else {
    Object.assign(configAgent, allAgents);
  }

  // Deny warcraft tools for non-warcraft agents
  const configuredAgents = opencodeConfig.agent as Record<string, unknown> | undefined;
  if (configuredAgents) {
    for (const [agentName, agentConfig] of Object.entries(configuredAgents)) {
      if (WARCRAFT_AGENT_NAMES.has(agentName as WarcraftAgentName)) {
        continue;
      }
      if (!agentConfig || typeof agentConfig !== 'object') {
        continue;
      }
      const currentPermission = (agentConfig as { permission?: Record<string, string> }).permission ?? {};
      (agentConfig as { permission: Record<string, string> }).permission = withWarcraftToolPermissions(
        currentPermission,
        'deny',
      );
    }
  }

  // Set default agent based on mode
  (opencodeConfig as Record<string, unknown>).default_agent = agentMode === 'unified' ? 'khadgar' : 'mimiron';

  // Merge built-in MCP servers
  const configMcp = opencodeConfig.mcp as Record<string, unknown> | undefined;
  if (!configMcp) {
    opencodeConfig.mcp = builtinMcps;
  } else {
    Object.assign(configMcp, builtinMcps);
  }
}
