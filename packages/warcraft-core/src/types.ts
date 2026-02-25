export type FeatureStatusType =
  | "planning"
  | "approved"
  | "executing"
  | "completed";

export interface FeatureJson {
  name: string;
  epicBeadId: string;
  status: FeatureStatusType;
  workflowPath?: "standard" | "lightweight";
  reviewChecklistVersion?: "v1";
  reviewChecklistCompletedAt?: string;
  ticket?: string;
  sessionId?: string;
  createdAt: string;
  approvedAt?: string;
  completedAt?: string;
}

export type TaskStatusType =
  | "pending"
  | "in_progress"
  | "done"
  | "cancelled"
  | "blocked"
  | "failed"
  | "partial";
export type TaskOrigin = "plan" | "manual";
/** Worker session information for background task execution */
export interface WorkerSession {
  /** Background task ID from OMO-Slim */
  taskId?: string;
  /** Unique session identifier */
  sessionId: string;
  /** Worker instance identifier */
  workerId?: string;
  /** Agent type handling this task */
  agent?: string;
  /** Execution mode: inline (same session) or delegate (background) */
  mode?: "inline" | "delegate";
  /** ISO timestamp of last heartbeat */
  lastHeartbeatAt?: string;
  /** Current attempt number (1-based) */
  attempt?: number;
  /** Number of messages exchanged in session */
  messageCount?: number;
}

export interface TaskBlocker {
  reason: string;
  detail?: string;
}

export interface TaskStatus {
  /** Schema version for forward compatibility (default: 1) */
  schemaVersion?: number;
  status: TaskStatusType;
  origin: TaskOrigin;
  planTitle?: string;
  summary?: string;
  startedAt?: string;
  completedAt?: string;
  baseCommit?: string;
  /** Idempotency key for safe retries */
  idempotencyKey?: string;
  /** Worker session info for background execution */
  workerSession?: WorkerSession;
  /** Child bead ID for this task. */
  beadId?: string;
  /**
   * Task dependencies expressed as task folder names (e.g., '01-setup', '02-core-api').
   * A task cannot start until all its dependencies have status 'done'.
   * Resolved from plan.md dependency annotations during warcraft_tasks_sync.
   */
  dependsOn?: string[];
  /** Blocker details when status is 'blocked'. */
  blocker?: TaskBlocker;
  /** Task folder name (e.g., '01-setup'). Persisted for stable identity across reordering. */
  folder?: string;
}

export interface PlanComment {
  id: string;
  line: number;
  body: string;
  author: string;
  timestamp: string;
}

export interface CommentsJson {
  threads: PlanComment[];
}

export interface PlanReadResult {
  content: string;
  status: FeatureStatusType;
  comments: PlanComment[];
}

export interface TasksSyncResult {
  created: string[];
  removed: string[];
  kept: string[];
  manual: string[];
}

export interface TaskInfo {
  folder: string;
  name: string;
  beadId?: string;
  status: TaskStatusType;
  origin: TaskOrigin;
  planTitle?: string;
  summary?: string;
}

export interface FeatureInfo {
  name: string;
  status: FeatureStatusType;
  tasks: TaskInfo[];
  hasPlan: boolean;
  commentCount: number;
}

export interface ContextFile {
  name: string;
  content: string;
  updatedAt: string;
}

export interface TaskSpec {
  taskFolder: string;
  featureName: string;
  planSection: string;
  context: string;
  priorTasks: Array<{ folder: string; summary?: string }>;
}

/** Structured data for task spec content generation */
export interface SpecData {
  featureName: string;
  task: { folder: string; name: string; order: number };
  dependsOn: string[];
  allTasks: Array<{ folder: string; name: string; order: number }>;
  planSection: string | null;
  contextFiles: Array<{ name: string; content: string }>;
  completedTasks: Array<{ name: string; summary: string }>;
}

/** Agent model/temperature configuration */
export interface AgentModelConfig {
  /** Model to use - format: "provider/model-id" (e.g., 'anthropic/claude-sonnet-4-20250514') */
  model?: string;
  /** Temperature for generation (0-2) */
  temperature?: number;
  /** Skills to enable for this agent */
  skills?: string[];
  /** Skills to auto-load for this agent */
  autoLoadSkills?: string[];
  /** Variant key for model reasoning/effort level (e.g., 'low', 'medium', 'high', 'max') */
  variant?: string;
}

export type BeadsMode = "on" | "off";

export interface ParallelExecutionConfig {
  /** Dispatch strategy: unbounded preserves current Promise.all behavior, bounded enforces maxConcurrency. */
  strategy?: 'unbounded' | 'bounded';
  /** Maximum parallel workers when strategy is bounded. */
  maxConcurrency?: number;
}

export interface BeadsModeProvider {
  getBeadsMode(): BeadsMode;
}

export interface WarcraftConfig {
  /** Schema reference for config file */
  $schema?: string;
  /** Enable warcraft tools for specific features */
  enableToolsFor?: string[];
  /** Globally disable specific skills (won't appear in warcraft_skill tool) */
  disableSkills?: string[];
  /** Globally disable specific MCP servers. Available: websearch, context7, grep_app */
  disableMcps?: string[];
  /** Enable OMO-Slim delegation (optional integration) */
  omoSlimEnabled?: boolean;
  /** Choose between unified or dedicated agent modes */
  agentMode?: "unified" | "dedicated";
  /** Agent configuration */
  agents?: {
    /** Khadgar (hybrid planner + orchestrator) */
    khadgar?: AgentModelConfig;
    /** Mimiron (planning-only) */
    mimiron?: AgentModelConfig;
    /** Saurfang (orchestrator) */
    saurfang?: AgentModelConfig;
    /** Brann (explorer/researcher) */
    brann?: AgentModelConfig;
    /** Mekkatorque (worker/coder) */
    mekkatorque?: AgentModelConfig;
    /** Algalon (reviewer) */
    algalon?: AgentModelConfig;
  };
  /** Sandbox mode for worker isolation */
  sandbox?: "none" | "docker";
  /** Docker image to use when sandbox is 'docker' (optional explicit override) */
  dockerImage?: string;
  /** Reuse Docker containers per worktree (default: true when sandbox is 'docker') */
  persistentContainers?: boolean;
  /** Beads rollout mode (supports boolean for on/off shorthand) */
  beadsMode?: BeadsMode | boolean;
  /** Parallel worker dispatch controls for batch execution. */
  parallelExecution?: ParallelExecutionConfig;
}

/** Default models for Warcraft agents */
export const DEFAULT_AGENT_MODELS = {
  khadgar: "openai/gpt-5.3-codex",
  mimiron: "openai/gpt-5.3-codex",
  saurfang: "openai/gpt-5.3-codex",
  brann: "google/gemini-3-flash-preview",
  mekkatorque: "kimi-for-coding/k2p5",
  algalon: "zai-coding-plan/glm-4.7",
} as const;

export const DEFAULT_WARCRAFT_CONFIG: WarcraftConfig = {
  $schema:
    "https://raw.githubusercontent.com/minhtri2710/opencode-warcraft/main/packages/opencode-warcraft/schema/opencode_warcraft.schema.json",
  enableToolsFor: [],
  disableSkills: [],
  disableMcps: [],
  agentMode: "unified",
  sandbox: "none",
  beadsMode: "on",
  parallelExecution: {
    strategy: 'unbounded',
    maxConcurrency: 4,
  },
  agents: {
    khadgar: {
      model: DEFAULT_AGENT_MODELS["khadgar"],
      temperature: 0.3,
      skills: [
        "brainstorming",
        "writing-plans",
        "dispatching-parallel-agents",
        "executing-plans",
      ],
      autoLoadSkills: ["parallel-exploration"],
    },
    mimiron: {
      model: DEFAULT_AGENT_MODELS["mimiron"],
      temperature: 0.2,
      skills: ["brainstorming", "writing-plans"],
      autoLoadSkills: ["parallel-exploration"],
    },
    saurfang: {
      model: DEFAULT_AGENT_MODELS["saurfang"],
      temperature: 0.2,
      skills: ["dispatching-parallel-agents", "executing-plans"],
      autoLoadSkills: [],
    },
    brann: {
      model: DEFAULT_AGENT_MODELS["brann"],
      temperature: 0.7,
      skills: [],
      autoLoadSkills: [],
    },
    mekkatorque: {
      model: DEFAULT_AGENT_MODELS["mekkatorque"],
      temperature: 0.4,
      autoLoadSkills: [
        "test-driven-development",
        "verification-before-completion",
      ],
    },
    algalon: {
      model: DEFAULT_AGENT_MODELS["algalon"],
      temperature: 0.5,
      skills: ["systematic-debugging", "code-reviewer"],
      autoLoadSkills: [],
    },
  },
};
