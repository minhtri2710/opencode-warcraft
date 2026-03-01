/**
 * Warcraft Agents
 *
 * The Warcraft Character Model:
 * - Khadgar (Hybrid): Plans AND orchestrates based on phase
 * - Mimiron (Planner): Plans features, interviews, writes plans
 * - Saurfang (Orchestrator): Delegates, spawns workers, verifies, merges
 * - Brann (Research/Collector): Explores codebase and external docs
 * - Mekkatorque (Worker/Coder): Executes tasks in isolation
 * - Algalon (Consultant/Reviewer): Reviews plan quality
 */

export { ALGALON_PROMPT, algalonAgent } from './algalon.js';
export { BRANN_PROMPT, brannAgent } from './brann.js';
// Specialist agents (lean, focused)
export { KHADGAR_PROMPT, khadgarAgent } from './khadgar.js';
export { MEKKATORQUE_PROMPT, mekkatorqueAgent } from './mekkatorque.js';
export { MIMIRON_PROMPT, mimironAgent } from './mimiron.js';
export { SAURFANG_PROMPT, saurfangAgent } from './saurfang.js';

/**
 * Agent registry for OpenCode plugin
 *
 * Specialist Agents (recommended):
 * - khadgar: Hybrid planner + orchestrator (detects phase, loads skills)
 * - mimiron: Discovery/planning (requirements, plan writing)
 * - saurfang: Orchestration (delegates, verifies, merges)
 * - brann: Research/collection (codebase + external docs/data)
 * - mekkatorque: Worker/coder (executes tasks in worktrees)
 * - algalon: Consultant/reviewer (plan quality)
 */
export const warcraftAgents = {
  // Specialist Agents (lean, focused - recommended)
  khadgar: {
    name: 'Khadgar (Hybrid)',
    description: 'Hybrid planner + orchestrator. Detects phase, loads skills on-demand.',
    mode: 'primary' as const,
  },
  mimiron: {
    name: 'Mimiron (Planner)',
    description: 'Plans features, interviews, writes plans. NEVER executes.',
    mode: 'primary' as const,
  },
  saurfang: {
    name: 'Saurfang (Orchestrator)',
    description: 'Orchestrates execution. Delegates, spawns workers, verifies, merges.',
    mode: 'primary' as const,
  },
  brann: {
    name: 'Brann (Explorer/Researcher/Retrieval)',
    description: 'Explores codebase, external docs, and retrieves external data.',
    mode: 'subagent' as const,
  },
  mekkatorque: {
    name: 'Mekkatorque (Worker/Coder)',
    description: 'Executes tasks directly in isolated worktrees. Never delegates.',
    mode: 'subagent' as const,
  },
  algalon: {
    name: 'Algalon (Consultant/Reviewer/Debugger)',
    description: 'Reviews plan documentation quality. OKAY/REJECT verdict.',
    mode: 'subagent' as const,
  },
};
