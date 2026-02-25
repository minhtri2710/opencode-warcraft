import * as fs from 'fs';
import {
  getTasksPath,
  getTaskPath,
  getTaskStatusPath,
  getTaskReportPath,
  getPlanPath,
  ensureDir,
  readJson,
  writeJson,
  writeJsonLockedSync,
  patchJsonLockedSync,
  readText,
  writeText,
  fileExists,
  sanitizeName,
  LockOptions,
  deriveTaskFolder,
  slugifyTaskName,
} from '../utils/paths.js';
import { TaskStatus, TaskStatusType, TaskOrigin, TasksSyncResult, TaskInfo, WorkerSession, SpecData } from '../types.js';
import type { BeadsMode, BeadsModeProvider } from '../types.js';
import { BeadsRepository } from './beads/BeadsRepository.js';
import { ConfigService } from './configService.js';
import { isBeadsEnabled } from './beads/beadsMode.js';
import { mapBeadStatusToTaskStatus } from './beads/beadStatus.js';
import { computeRunnableAndBlocked } from './taskDependencyGraph.js';
import type { TaskWithDeps } from './taskDependencyGraph.js';
import { taskStateFromTaskStatus, encodeTaskState } from './beads/artifactSchemas.js';

/** Current schema version for TaskStatus */
export const TASK_STATUS_SCHEMA_VERSION = 1;

/** Fields that can be updated by background workers without clobbering completion-owned fields */
export interface BackgroundPatchFields {
  idempotencyKey?: string;
  workerSession?: Partial<WorkerSession>;
}

/** Fields owned by the completion flow (not to be touched by background patches) */
export interface CompletionFields {
  status?: TaskStatusType;
  summary?: string;
  completedAt?: string;
}

interface ParsedTask {
  folder: string;
  order: number;
  name: string;
  description: string;
  /** Raw dependency numbers parsed from plan. null = not specified (use implicit), [] = explicit none */
  dependsOnNumbers: number[] | null;
}


export interface RunnableTask {
  folder: string;
  name: string;
  status: TaskStatusType;
  beadId?: string;
}

export interface RunnableTasksResult {
  /** Tasks that can be executed now (dependencies satisfied) */
  runnable: RunnableTask[];
  /** Tasks that are blocked by dependencies */
  blocked: RunnableTask[];
  /** Tasks already completed */
  completed: RunnableTask[];
  /** Tasks currently in progress */
  inProgress: RunnableTask[];
  /** Source of the result: 'beads' or 'filesystem' */
  source: 'beads' | 'filesystem';
}

export class TaskService {
  private readonly repository: BeadsRepository;
  private readonly beadsModeProvider: BeadsModeProvider;

  constructor(
    private projectRoot: string,
    repository: BeadsRepository,
    beadsModeProvider: BeadsModeProvider = new ConfigService(),
  ) {
    this.repository = repository;
    this.beadsModeProvider = beadsModeProvider;
  }

  sync(featureName: string): TasksSyncResult {
    const planPath = getPlanPath(this.projectRoot, featureName, this.getBeadsMode());
    const planContent = readText(planPath);
    
    if (!planContent) {
      throw new Error(`No plan.md found for feature '${featureName}'`);
    }

    const planTasks = this.parseTasksFromPlan(planContent);
    
    // Validate dependency graph before proceeding
    this.validateDependencyGraph(planTasks, featureName);
    const epicResult = this.repository.getEpicByFeatureName(featureName, true);
    if (epicResult.success === false) {
      throw new Error(`Failed to resolve epic for feature '${featureName}': ${epicResult.error.message}`);
    }
    const epicBeadId = epicResult.value!;
    
    const existingTasks = this.list(featureName);
    console.error(`[DEBUG sync] featureName=${featureName}, planTasks=${planTasks.length}, existingTasks=${existingTasks.length}, beadsOn=${isBeadsEnabled(this.beadsModeProvider)}`);
    
    const result: TasksSyncResult = {
      created: [],
      removed: [],
      kept: [],
      manual: [],
    };

    const existingByName = new Map(existingTasks.map(t => [t.folder, t]));

    for (const existing of existingTasks) {
      if (existing.origin === 'manual') {
        result.manual.push(existing.folder);
        continue;
      }

      if (existing.status === 'done' || existing.status === 'in_progress') {
        result.kept.push(existing.folder);
        continue;
      }

      if (existing.status === 'cancelled') {
        this.deleteTask(featureName, existing.folder);
        result.removed.push(existing.folder);
        continue;
      }

      const stillInPlan = planTasks.some(p => p.folder === existing.folder);
      if (!stillInPlan) {
        this.deleteTask(featureName, existing.folder);
        result.removed.push(existing.folder);
      } else {
        result.kept.push(existing.folder);
      }
    }

    for (const planTask of planTasks) {
      if (!existingByName.has(planTask.folder)) {
        // Default priority for plan tasks is 3 (medium)
        this.createFromPlan(featureName, planTask, planTasks, planContent, epicBeadId, 3);
        result.created.push(planTask.folder);
      }
    }

    return result;
  }

  /**
   * Create a manual task with auto-incrementing index.
   * Folder format: "01-task-name", "02-task-name", etc.
   * Index ensures alphabetical sort = chronological order.
   */
  create(featureName: string, name: string, order?: number, priority: number = 3): string {
    name = sanitizeName(name);
    const epicResult = this.repository.getEpicByFeatureName(featureName, true);
    if (epicResult.success === false) {
      throw new Error(`Failed to resolve epic for feature '${featureName}': ${epicResult.error.message}`);
    }
    const epicBeadId = epicResult.value!;

    // Validate priority
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      throw new Error(`Priority must be an integer between 1 and 5 (inclusive), got: ${priority}`);
    }

    // Determine folder name
    let folder: string;
    if (isBeadsEnabled(this.beadsModeProvider)) {
      // In beads mode, use provided order or auto-increment based on existing beads
      const existingTasks = this.listFromBeads(featureName);
      const nextOrder = order ?? this.getNextOrderFromTasks(existingTasks);
      folder = deriveTaskFolder(nextOrder, name);
    } else {
      // In off mode, use filesystem-based order detection
      const existingFolders = this.listFolders(featureName);
      const nextOrder = order ?? this.getNextOrder(existingFolders);
      folder = deriveTaskFolder(nextOrder, name);
    }

    const beadId = this.createChildBead(name, epicBeadId, priority);

    const status: TaskStatus = {
      status: 'pending',
      origin: 'manual',
      planTitle: name,
      beadId,
    };

    if (isBeadsEnabled(this.beadsModeProvider)) {
      this.writeTaskStateByBeadId(beadId, {
        ...status,
        folder,
      });
    }

    // In beadsMode off, write local task directory and status.json.
    // In beadsMode on, bead artifacts are canonical — no local tasks/ writes.
    if (!isBeadsEnabled(this.beadsModeProvider)) {
      const taskPath = getTaskPath(this.projectRoot, featureName, folder);
      ensureDir(taskPath);
      writeJson(getTaskStatusPath(this.projectRoot, featureName, folder), status);
    }

    return folder;
  }

  private createFromPlan(featureName: string, task: ParsedTask, allTasks: ParsedTask[], planContent: string, epicBeadId: string, priority: number = 3): void {
    console.error(`[DEBUG createFromPlan] task=${task.folder}, feature=${featureName}`);
    // Resolve dependencies: numbers -> folder names
    const dependsOn = this.resolveDependencies(task, allTasks);

    // Create child bead for the task
    const beadId = this.createChildBead(task.name, epicBeadId, priority);

    const status: TaskStatus = {
      status: 'pending',
      origin: 'plan',
      planTitle: task.name,
      beadId,
      dependsOn,
    };

    if (isBeadsEnabled(this.beadsModeProvider)) {
      this.writeTaskStateByBeadId(beadId, {
        ...status,
        folder: task.folder,
      });
    }

    // In beadsMode off, write local task directory and status.json.
    // In beadsMode on, bead artifacts are canonical — no local tasks/ writes.
    if (!isBeadsEnabled(this.beadsModeProvider)) {
      const taskPath = getTaskPath(this.projectRoot, featureName, task.folder);
      ensureDir(taskPath);
      writeJson(getTaskStatusPath(this.projectRoot, featureName, task.folder), status);
    }

    // Build and store spec in bead (works for both modes)
    const specContent = this.buildSpecContent({
      featureName,
      task,
      dependsOn,
      allTasks,
      planContent,
    });

    // Store spec as bead artifact
    this.repository.upsertTaskArtifact(beadId, 'spec', specContent);
    console.error(`[DEBUG createFromPlan] upsertTaskArtifact returned for ${task.folder}`);
    if (isBeadsEnabled(this.beadsModeProvider)) {
      this.repository.flushArtifacts();
    }
  }

  /**
   * Build structured SpecData for a task.
   * This separates data collection from markdown formatting.
   */
  buildSpecData(params: {
    featureName: string;
    task: { folder: string; name: string; order: number; description?: string };
    dependsOn: string[];
    allTasks: Array<{ folder: string; name: string; order: number }>;
    planContent?: string | null;
    contextFiles?: Array<{ name: string; content: string }>;
    completedTasks?: Array<{ name: string; summary: string }>;
  }): SpecData {
    const { featureName, task, dependsOn, allTasks, planContent, contextFiles = [], completedTasks = [] } = params;

    const planSection = this.extractPlanSection(planContent ?? null, task);

    return {
      featureName,
      task: {
        folder: task.folder,
        name: task.name,
        order: task.order,
      },
      dependsOn,
      allTasks,
      planSection,
      contextFiles,
      completedTasks,
    };
  }

  buildSpecContent(params: {
    featureName: string;
    task: { folder: string; name: string; order: number; description?: string };
    dependsOn: string[];
    allTasks: Array<{ folder: string; name: string; order: number }>;
    planContent?: string | null;
    contextFiles?: Array<{ name: string; content: string }>;
    completedTasks?: Array<{ name: string; summary: string }>;
  }): string {
    // Build structured data first, then format to markdown
    const specData = this.buildSpecData(params);
    return this.formatSpecDataToMarkdown(specData);
  }

  /**
   * Format SpecData to markdown string.
   * This is kept in core for backward compatibility.
   * The plugin layer should use its own formatter for new code.
   */
  private formatSpecDataToMarkdown(data: SpecData): string {
    const { featureName, task, dependsOn, allTasks, planSection, contextFiles, completedTasks } = data;

    const getTaskType = (section: string | null, taskName: string): string | null => {
      if (!section) {
        return null;
      }

      const fileTypeMatches = Array.from(section.matchAll(/-\s*(Create|Modify|Test):/gi)).map(
        match => match[1].toLowerCase()
      );
      const fileTypes = new Set(fileTypeMatches);

      if (fileTypes.size === 0) {
        return taskName.toLowerCase().includes('test') ? 'testing' : null;
      }

      if (fileTypes.size === 1) {
        const onlyType = Array.from(fileTypes)[0];
        if (onlyType === 'create') return 'greenfield';
        if (onlyType === 'test') return 'testing';
      }

      if (fileTypes.has('modify')) {
        return 'modification';
      }

      return null;
    };

    const specLines: string[] = [
      `# Task: ${task.folder}`,
      '',
      `## Feature: ${featureName}`,
      '',
      '## Dependencies',
      '',
    ];

    if (dependsOn.length > 0) {
      for (const dep of dependsOn) {
        const depTask = allTasks.find(t => t.folder === dep);
        if (depTask) {
          specLines.push(`- **${depTask.order}. ${depTask.name}** (${dep})`);
        } else {
          specLines.push(`- ${dep}`);
        }
      }
    } else {
      specLines.push('_None_');
    }

    specLines.push('', '## Plan Section', '');

    if (planSection) {
      specLines.push(planSection.trim());
    } else {
      specLines.push('_No plan section available._');
    }

    specLines.push('');

    const taskType = getTaskType(planSection, task.name);
    if (taskType) {
      specLines.push('## Task Type', '', taskType, '');
    }

    if (contextFiles.length > 0) {
      const contextCompiled = contextFiles
        .map(f => `## ${f.name}\n\n${f.content}`)
        .join('\n\n---\n\n');
      specLines.push('## Context', '', contextCompiled, '');
    }

    if (completedTasks.length > 0) {
      const completedLines = completedTasks.map(t => `- ${t.name}: ${t.summary}`);
      specLines.push('## Completed Tasks', '', ...completedLines, '');
    }

    return specLines.join('\n');
  }

  private extractPlanSection(planContent: string | null, task: { name: string; order: number; folder: string }): string | null {
    if (!planContent) return null;

    const escapedTitle = task.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const titleRegex = new RegExp(`###\\s*\\d+\\.\\s*${escapedTitle}[\\s\\S]*?(?=###|$)`, 'i');
    let taskMatch = planContent.match(titleRegex);

    if (!taskMatch && task.order > 0) {
      const orderRegex = new RegExp(`###\\s*${task.order}\\.\\s*[^\\n]+[\\s\\S]*?(?=###|$)`, 'i');
      taskMatch = planContent.match(orderRegex);
    }

    return taskMatch ? taskMatch[0].trim() : null;
  }

  /**
   * Resolve dependency numbers to folder names.
   * - If dependsOnNumbers is null (not specified), apply implicit sequential default (N-1 for N > 1).
   * - If dependsOnNumbers is [] (explicit "none"), return empty array.
   * - Otherwise, map numbers to corresponding task folders.
   */
  private resolveDependencies(task: ParsedTask, allTasks: ParsedTask[]): string[] {
    // Explicit "none" - no dependencies
    if (task.dependsOnNumbers !== null && task.dependsOnNumbers.length === 0) {
      return [];
    }

    // Explicit dependency numbers provided
    if (task.dependsOnNumbers !== null) {
      return task.dependsOnNumbers
        .map(num => allTasks.find(t => t.order === num)?.folder)
        .filter((folder): folder is string => folder !== undefined);
    }

    // Implicit sequential default: depend on previous task (N-1)
    if (task.order === 1) {
      return [];
    }

    const previousTask = allTasks.find(t => t.order === task.order - 1);
    return previousTask ? [previousTask.folder] : [];
  }

  /**
   * Validate the dependency graph for errors before creating tasks.
   * Throws descriptive errors pointing the operator to fix plan.md.
   * 
   * Checks for:
   * - Unknown task numbers in dependencies
   * - Self-dependencies
   * - Cycles (using DFS topological sort)
   */
  private validateDependencyGraph(tasks: ParsedTask[], featureName: string): void {
    const taskNumbers = new Set(tasks.map(t => t.order));
    
    // Validate each task's dependencies
    for (const task of tasks) {
      if (task.dependsOnNumbers === null) {
        // Implicit dependencies - no validation needed
        continue;
      }
      
      for (const depNum of task.dependsOnNumbers) {
        // Check for self-dependency
        if (depNum === task.order) {
          throw new Error(
            `Invalid dependency graph in plan.md: Self-dependency detected for task ${task.order} ("${task.name}"). ` +
            `A task cannot depend on itself. Please fix the "Depends on:" line in plan.md.`
          );
        }
        
        // Check for unknown task number
        if (!taskNumbers.has(depNum)) {
          throw new Error(
            `Invalid dependency graph in plan.md: Unknown task number ${depNum} referenced in dependencies for task ${task.order} ("${task.name}"). ` +
            `Available task numbers are: ${Array.from(taskNumbers).sort((a, b) => a - b).join(', ')}. ` +
            `Please fix the "Depends on:" line in plan.md.`
          );
        }
      }
    }
    
    // Check for cycles using DFS
    this.detectCycles(tasks);
  }

  /**
   * Detect cycles in the dependency graph using DFS.
   * Throws a descriptive error if a cycle is found.
   */
  private detectCycles(tasks: ParsedTask[]): void {
    // Build adjacency list: task order -> [dependency orders]
    const taskByOrder = new Map(tasks.map(t => [t.order, t]));
    
    // Build dependency graph with resolved implicit dependencies
    const getDependencies = (task: ParsedTask): number[] => {
      if (task.dependsOnNumbers !== null) {
        return task.dependsOnNumbers;
      }
      // Implicit sequential dependency
      if (task.order === 1) {
        return [];
      }
      return [task.order - 1];
    };
    
    // Track visited state: 0 = unvisited, 1 = in current path, 2 = fully processed
    const visited = new Map<number, number>();
    const path: number[] = [];
    
    const dfs = (taskOrder: number): void => {
      const state = visited.get(taskOrder);
      
      if (state === 2) {
        // Already fully processed, no cycle through here
        return;
      }
      
      if (state === 1) {
        // Found a cycle! Build the cycle path for the error message
        const cycleStart = path.indexOf(taskOrder);
        const cyclePath = [...path.slice(cycleStart), taskOrder];
        const cycleDesc = cyclePath.join(' -> ');
        
        throw new Error(
          `Invalid dependency graph in plan.md: Cycle detected in task dependencies: ${cycleDesc}. ` +
          `Tasks cannot have circular dependencies. Please fix the "Depends on:" lines in plan.md.`
        );
      }
      
      // Mark as in current path
      visited.set(taskOrder, 1);
      path.push(taskOrder);
      
      const task = taskByOrder.get(taskOrder);
      if (task) {
        const deps = getDependencies(task);
        for (const depOrder of deps) {
          dfs(depOrder);
        }
      }
      
      // Mark as fully processed
      path.pop();
      visited.set(taskOrder, 2);
    };
    
    // Run DFS from each node
    for (const task of tasks) {
      if (!visited.has(task.order)) {
        dfs(task.order);
      }
    }
  }

  writeSpec(featureName: string, taskFolder: string, content: string): string {
    return this.upsertTaskBeadArtifact(featureName, taskFolder, 'spec', content);
  }

  writeWorkerPrompt(featureName: string, taskFolder: string, content: string): string {
    return this.upsertTaskBeadArtifact(featureName, taskFolder, 'worker_prompt', content);
  }

  readTaskBeadArtifact(
    featureName: string,
    taskFolder: string,
    kind: 'spec' | 'worker_prompt' | 'report',
  ): string | null {
    if (isBeadsEnabled(this.beadsModeProvider)) {
      this.repository.importArtifacts();
    }

    const status = this.getRawStatus(featureName, taskFolder);
    if (!status) {
      return null;
    }

    const beadId = status.beadId;
    if (!beadId) {
      return null;
    }

    const readResult = this.repository.readTaskArtifact(beadId, kind);
    return readResult.success ? readResult.value : null;
  }

  /**
   * Update task status with locked atomic write.
   * Uses file locking to prevent race conditions between concurrent updates.
   * 
   * @param featureName - Feature name
   * @param taskFolder - Task folder name
   * @param updates - Fields to update (status, summary, baseCommit, blocker)
   * @param lockOptions - Optional lock configuration
   * @returns Updated TaskStatus
   */
  update(
    featureName: string,
    taskFolder: string,
    updates: Partial<
      Pick<TaskStatus, 'status' | 'summary' | 'baseCommit' | 'blocker'>
    >,
    lockOptions?: LockOptions
  ): TaskStatus {
    const beadsOn = isBeadsEnabled(this.beadsModeProvider);
    const current = this.getRawStatus(featureName, taskFolder);
    
    if (!current) {
      throw new Error(`Task '${taskFolder}' not found`);
    }

    const updated: TaskStatus = {
      ...current,
      ...updates,
      schemaVersion: TASK_STATUS_SCHEMA_VERSION,
    };

    if (updates.status === 'in_progress' && !current.startedAt) {
      updated.startedAt = new Date().toISOString();
    }
    if (updates.status === 'done' && !current.completedAt) {
      updated.completedAt = new Date().toISOString();
    }

    if (beadsOn) {
      if (updated.beadId) {
        this.writeTaskStateByBeadId(updated.beadId, {
          ...updated,
          folder: taskFolder,
        }, updates.status !== undefined);
      }
    }

    // In beadsMode off, write local cache. In beadsMode on, bead artifacts are canonical.
    if (!beadsOn) {
      const statusPath = getTaskStatusPath(this.projectRoot, featureName, taskFolder);
      writeJsonLockedSync(statusPath, updated, lockOptions);
    }

    if (updates.status && updated.beadId && isBeadsEnabled(this.beadsModeProvider)) {
      this.syncTaskBeadStatus(updated.beadId, updates.status);
      this.repository.flushArtifacts();
    }

    return updated;
  }

  /**
   * Patch only background-owned fields without clobbering completion-owned fields.
   * Safe for concurrent use by background workers.
   * 
   * Uses deep merge for workerSession to allow partial updates like:
   * - patchBackgroundFields(..., { workerSession: { lastHeartbeatAt: '...' } })
   *   will update only lastHeartbeatAt, preserving other workerSession fields.
   * 
   * @param featureName - Feature name
   * @param taskFolder - Task folder name
   * @param patch - Background-owned fields to update
   * @param lockOptions - Optional lock configuration
   * @returns Updated TaskStatus
   */
  patchBackgroundFields(
    featureName: string,
    taskFolder: string,
    patch: BackgroundPatchFields,
    lockOptions?: LockOptions
  ): TaskStatus {
    if (isBeadsEnabled(this.beadsModeProvider)) {
      const status = this.getRawStatus(featureName, taskFolder);
      if (!status) {
        throw new Error(`Task '${taskFolder}' not found`);
      }

      const updated: TaskStatus = {
        ...status,
        schemaVersion: TASK_STATUS_SCHEMA_VERSION,
      };

      if (patch.idempotencyKey !== undefined) {
        updated.idempotencyKey = patch.idempotencyKey;
      }

      if (patch.workerSession !== undefined) {
        updated.workerSession = {
          ...(status.workerSession ?? ({} as WorkerSession)),
          ...patch.workerSession,
        } as WorkerSession;
      }

      if (status.beadId) {
        this.writeTaskStateByBeadId(status.beadId, {
          ...updated,
          folder: taskFolder,
        }, false);
      }

      // beadsMode on: bead artifacts are canonical — skip local write
      return updated;
    }

    const statusPath = getTaskStatusPath(this.projectRoot, featureName, taskFolder);
    
    // Build the patch object, only including fields that are defined
    const safePatch: Partial<TaskStatus> = {
      schemaVersion: TASK_STATUS_SCHEMA_VERSION,
    };
    
    if (patch.idempotencyKey !== undefined) {
      safePatch.idempotencyKey = patch.idempotencyKey;
    }
    
    if (patch.workerSession !== undefined) {
      safePatch.workerSession = patch.workerSession as WorkerSession;
    }
    
    // Use patchJsonLockedSync which does deep merge
    return patchJsonLockedSync<TaskStatus>(statusPath, safePatch, lockOptions);
  }

  /**
   * Get raw TaskStatus including all fields (for internal use or debugging).
   */
  getRawStatus(featureName: string, taskFolder: string): TaskStatus | null {
    if (isBeadsEnabled(this.beadsModeProvider)) {
      const beadsTask = this.getFromBeads(featureName, taskFolder);
      if (beadsTask?.beadId) {
        const taskState = this.readTaskStateByBeadId(beadsTask.beadId);
        if (taskState) {
          return taskState;
        }

        return {
          status: beadsTask.status,
          origin: beadsTask.origin,
          planTitle: beadsTask.planTitle ?? beadsTask.name,
          beadId: beadsTask.beadId,
        };
      }

    }

    const statusPath = getTaskStatusPath(this.projectRoot, featureName, taskFolder);
    const existing = readJson<TaskStatus>(statusPath);
    if (!existing) {
      return null;
    }

    return existing;
  }

  get(featureName: string, taskFolder: string): TaskInfo | null {
    // In beads mode, try to get task info from beads first
    if (isBeadsEnabled(this.beadsModeProvider)) {
      const beadsTask = this.getFromBeads(featureName, taskFolder);
      return beadsTask ?? null;
    }
    const statusPath = getTaskStatusPath(this.projectRoot, featureName, taskFolder);
    const status = readJson<TaskStatus>(statusPath);

    if (!status) return null;

    return {
      folder: taskFolder,
      name: taskFolder.replace(/^\d+-/, ''),
      beadId: status.beadId,
      status: status.status,
      origin: status.origin,
      planTitle: status.planTitle,
      summary: status.summary,
    };
  }

  /**
   * Get task info from beads in on-mode.
   * Returns null if task not found via beads.
   */
  private getFromBeads(featureName: string, taskFolder: string): TaskInfo | null {
    try {
      const task = this.listFromBeads(featureName).find((entry) => entry.folder === taskFolder);
      if (!task) {
        return null;
      }
      return task;
    } catch (error) {
      // If beads query fails, return null to trigger fallback
      return null;
    }
  }

  /**
   * Map bead status to task status.
   */
  list(featureName: string): TaskInfo[] {
    if (isBeadsEnabled(this.beadsModeProvider)) {
      return this.listFromBeads(featureName);
    }

    // Local filesystem fallback (off-mode only)
    const folders = this.listFolders(featureName);
    return folders
      .map(folder => this.get(featureName, folder))
      .filter((t): t is TaskInfo => t !== null);
  }
  /**
   * List tasks from beads in on-mode.
   * Returns tasks by querying child beads of the feature's epic.
   */
  private listFromBeads(featureName: string): TaskInfo[] {
    try {
      const epicResult = this.repository.getEpicByFeatureName(featureName, true);
      if (epicResult.success === false) {
        throw epicResult.error;
      }
      const epicBeadId = epicResult.value!;
      const listResult = this.repository.listTaskBeadsForEpic(epicBeadId);
      const taskBeads = listResult.success ? listResult.value : [];
      const sortedTaskBeads = [...taskBeads].sort((a, b) => a.title.localeCompare(b.title));
      const tasks = sortedTaskBeads.map((bead, index) => {
        const beadStatus = mapBeadStatusToTaskStatus(bead.status);
        const taskState = this.readTaskStateByBeadId(bead.id);
        if (taskState) {
          return {
            folder: taskState.folder,
            name: taskState.folder.replace(/^\d+-/, ''),
            beadId: bead.id,
            status: taskState.status,
            origin: taskState.origin,
            planTitle: taskState.planTitle ?? bead.title,
            summary: taskState.summary,
          };
        }

        const order = index + 1;
        const folderName = slugifyTaskName(bead.title);
        const folder = deriveTaskFolder(order, folderName);

        return {
          folder,
          name: folderName,
          beadId: bead.id,
          status: beadStatus,
          origin: 'plan' as TaskOrigin,
          planTitle: bead.title,
        };
      });

      return tasks.sort((a, b) => {
        const aOrder = parseInt(a.folder.split('-')[0], 10);
        const bOrder = parseInt(b.folder.split('-')[0], 10);
        return aOrder - bOrder;
      });
    } catch (error) {
      // If beads query fails, return empty array to trigger fallback
      return [];
    }
  }

  /**
   * Get next order number from existing bead tasks.
   */
  private getNextOrderFromTasks(tasks: TaskInfo[]): number {
    if (tasks.length === 0) return 1;

    const orders = tasks
      .map(t => parseInt(t.folder.split('-')[0], 10))
      .filter(n => !isNaN(n));

    return Math.max(...orders, 0) + 1;
  }

  writeReport(featureName: string, taskFolder: string, report: string): string {
    // In beadsMode on, only write to bead artifacts — no local tasks/ writes.
    // In beadsMode off, write to local filesystem.
    if (isBeadsEnabled(this.beadsModeProvider)) {
      const status = this.getRawStatus(featureName, taskFolder);
      if (status?.beadId) {
        try {
          this.repository.upsertTaskArtifact(status.beadId, 'report', report);
          this.repository.flushArtifacts();
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          console.warn(`[warcraft] Failed to add report as bead artifact for '${taskFolder}': ${reason}`);
        }
      }
      // Return a virtual path for the caller (not written to disk)
      return getTaskReportPath(this.projectRoot, featureName, taskFolder);
    }

    const reportPath = getTaskReportPath(this.projectRoot, featureName, taskFolder);
    writeText(reportPath, report);
    return reportPath;
  }

  /**
   * Get tasks that are runnable (dependencies satisfied).
   * In beadsMode 'on': uses BeadsViewerGateway (bv --robot-plan) for parallel execution planning.
   * In beadsMode 'off': uses filesystem-based dependency resolution.
   */
  getRunnableTasks(featureName: string): RunnableTasksResult {
    if (isBeadsEnabled(this.beadsModeProvider)) {
      const beadsResult = this.getRunnableTasksFromBeads(featureName);
      if (beadsResult !== null) {
        return beadsResult;
      }
      // Fall back to filesystem if beads query fails
    }

    return this.getRunnableTasksFromFilesystem(featureName);
  }

  /**
   * Get runnable tasks from BeadsViewerGateway using bv --robot-plan.
   */
  private getRunnableTasksFromBeads(featureName: string): RunnableTasksResult | null {
    try {
      const planResult = this.repository.getRobotPlan();
      if (!planResult) {
        return null;
      }

      // Use beads-based listing in on-mode
      const allTasks = isBeadsEnabled(this.beadsModeProvider)
        ? this.listFromBeads(featureName)
        : this.list(featureName);

      // If beads listing returned empty and we're in on-mode, fall back
      const tasksToUse = (isBeadsEnabled(this.beadsModeProvider) && allTasks.length === 0)
        ? this.list(featureName)
        : allTasks;

      const taskByBeadId = new Map<string, TaskInfo>(
        tasksToUse
          .filter((t): t is TaskInfo & { beadId: string } => t.beadId !== undefined)
          .map(t => [t.beadId, t])
      );

      const runnable: RunnableTask[] = [];
      const blocked: RunnableTask[] = [];
      const completed: RunnableTask[] = [];
      const inProgress: RunnableTask[] = [];

      // Process tasks from robot plan tracks
      for (const track of planResult.tracks) {
        for (const beadId of track.tasks) {
          const task = taskByBeadId.get(beadId);
          if (!task) continue;

          const runnableTask: RunnableTask = {
            folder: task.folder,
            name: task.name,
            status: task.status,
            beadId: task.beadId,
          };

          switch (task.status) {
            case 'done':
              completed.push(runnableTask);
              break;
            case 'in_progress':
              inProgress.push(runnableTask);
              break;
            case 'pending':
              // Tasks in robot plan tracks are considered runnable
              runnable.push(runnableTask);
              break;
            case 'blocked':
            case 'failed':
            case 'cancelled':
            case 'partial':
              blocked.push(runnableTask);
              break;
          }
        }
      }

      // Also include tasks not in the robot plan (fallback)
      const plannedBeadIds = new Set(planResult.tracks.flatMap(t => t.tasks));
      const nonPlannedTasks = tasksToUse.filter(t => t.beadId && !plannedBeadIds.has(t.beadId));

      if (nonPlannedTasks.length > 0) {
        // Build dependency info for all tasks (engine needs full graph for accurate resolution)
        const allTasksWithDeps: TaskWithDeps[] = tasksToUse.map(task => {
          const rawStatus = this.getRawStatus(featureName, task.folder);
          return {
            folder: task.folder,
            status: task.status,
            dependsOn: rawStatus?.dependsOn,
          };
        });
        const { runnable: runnableFolders } = computeRunnableAndBlocked(allTasksWithDeps);
        const runnableSet = new Set(runnableFolders);

        for (const task of nonPlannedTasks) {
          const runnableTask: RunnableTask = {
            folder: task.folder,
            name: task.name,
            status: task.status,
            beadId: task.beadId,
          };

          switch (task.status) {
            case 'done':
              if (!completed.find(t => t.folder === task.folder)) {
                completed.push(runnableTask);
              }
              break;
            case 'in_progress':
              if (!inProgress.find(t => t.folder === task.folder)) {
                inProgress.push(runnableTask);
              }
              break;
            case 'pending':
              if (runnableSet.has(task.folder)) {
                if (!runnable.find(t => t.folder === task.folder)) {
                  runnable.push(runnableTask);
                }
              } else {
                if (!blocked.find(t => t.folder === task.folder)) {
                  blocked.push(runnableTask);
                }
              }
              break;
            default:
              if (!blocked.find(t => t.folder === task.folder)) {
                blocked.push(runnableTask);
              }
          }
        }
      }

      return {
        runnable,
        blocked,
        completed,
        inProgress,
        source: 'beads',
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[warcraft] Failed to get runnable tasks from beads: ${reason}`);
      return null;
    }
  }

  /**
   * Get runnable tasks from filesystem using dependency resolution.
   */
  private getRunnableTasksFromFilesystem(featureName: string): RunnableTasksResult {
    const allTasks = this.list(featureName);

    // Build dependency-aware task list for canonical engine
    const tasksWithDeps: TaskWithDeps[] = allTasks.map(task => {
      const rawStatus = this.getRawStatus(featureName, task.folder);
      return {
        folder: task.folder,
        status: task.status,
        dependsOn: rawStatus?.dependsOn,
      };
    });

    const { runnable: runnableFolders } = computeRunnableAndBlocked(tasksWithDeps);
    const runnableSet = new Set(runnableFolders);

    const runnable: RunnableTask[] = [];
    const blocked: RunnableTask[] = [];
    const completed: RunnableTask[] = [];
    const inProgress: RunnableTask[] = [];

    for (const task of allTasks) {
      const runnableTask: RunnableTask = {
        folder: task.folder,
        name: task.name,
        status: task.status,
        beadId: task.beadId,
      };

      switch (task.status) {
        case 'done':
          completed.push(runnableTask);
          break;
        case 'in_progress':
          inProgress.push(runnableTask);
          break;
        case 'pending':
          if (runnableSet.has(task.folder)) {
            runnable.push(runnableTask);
          } else {
            blocked.push(runnableTask);
          }
          break;
        case 'blocked':
        case 'failed':
        case 'cancelled':
        case 'partial':
          blocked.push(runnableTask);
          break;
      }
    }

    return {
      runnable,
      blocked,
      completed,
      inProgress,
      source: 'filesystem',
    };
  }


  private listFolders(featureName: string): string[] {
    const tasksPath = getTasksPath(this.projectRoot, featureName);
    if (!fileExists(tasksPath)) return [];

    return fs.readdirSync(tasksPath, { withFileTypes: true })
      .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
      .map((d: { name: string }) => d.name)
      .sort();
  }

  private deleteTask(featureName: string, taskFolder: string): void {
    const taskPath = getTaskPath(this.projectRoot, featureName, taskFolder);
    if (fileExists(taskPath)) {
      fs.rmSync(taskPath, { recursive: true });
    }
  }

  private getNextOrder(existingFolders: string[]): number {
    if (existingFolders.length === 0) return 1;
    
    const orders = existingFolders
      .map(f => parseInt(f.split('-')[0], 10))
      .filter(n => !isNaN(n));
    
    return Math.max(...orders, 0) + 1;
  }

  private createChildBead(title: string, epicBeadId: string, priority: number = 3): string {
    return this.repository.getGateway().createTask(title, epicBeadId, priority);
  }

  private syncTaskBeadStatus(beadId: string, status: TaskStatusType): void {
    try {
      this.repository.getGateway().syncTaskStatus(beadId, status);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[warcraft] Failed to sync bead status for '${beadId}' -> '${status}': ${reason}`);
    }
  }

  upsertTaskBeadArtifact(
    featureName: string,
    taskFolder: string,
    kind: 'spec' | 'worker_prompt' | 'report',
    content: string,
  ): string {
    const taskStatus = this.getRawStatus(featureName, taskFolder);

    if (!taskStatus) {
      throw new Error(`Task '${taskFolder}' not found`);
    }

    if (!taskStatus.beadId) {
      throw new Error(`Task '${taskFolder}' does not have beadId`);
    }

    this.repository.upsertTaskArtifact(taskStatus.beadId, kind, content);

    if (isBeadsEnabled(this.beadsModeProvider)) {
      this.repository.flushArtifacts();
    }

    return taskStatus.beadId;
  }

  private readTaskStateByBeadId(beadId: string): TaskStatus | null {
    const result = this.repository.getTaskState(beadId);
    if (result.success === false || !result.value) {
      return null;
    }
    return result.value;
  }

  private writeTaskStateByBeadId(beadId: string, state: TaskStatus, shouldFlush: boolean = true): void {
    if (shouldFlush) {
      // Full repository path: schema-aware encode + auto-flush
      this.repository.setTaskState(beadId, state);
    } else {
      // Schema-aware encode without flush (performance optimization for background patches)
      const artifact = taskStateFromTaskStatus(state);
      const encoded = encodeTaskState(artifact);
      this.repository.getGateway().upsertArtifact(beadId, 'task_state', encoded);
    }
  }

  private getBeadsMode(): BeadsMode {
    return this.beadsModeProvider.getBeadsMode();
  }

  private parseTasksFromPlan(content: string): ParsedTask[] {
    const tasks: ParsedTask[] = [];
    const lines = content.split('\n');
    
    let currentTask: ParsedTask | null = null;
    let descriptionLines: string[] = [];
    
    // Regex to match "Depends on:" or "**Depends on**:" with optional markdown
    // Strips markdown formatting (**, *, etc.) and captures the value
    const dependsOnRegex = /^\s*\*{0,2}Depends\s+on\*{0,2}\s*:\s*(.+)$/i;
    
    for (const line of lines) {
      // Check for task header: ### N. Task Name
      const taskMatch = line.match(/^###\s+(\d+)\.\s+(.+)$/);
      
      if (taskMatch) {
        // Save previous task if exists
        if (currentTask) {
          currentTask.description = descriptionLines.join('\n').trim();
          tasks.push(currentTask);
        }
        
        const order = parseInt(taskMatch[1], 10);
        const rawName = taskMatch[2].trim();
        const folderName = slugifyTaskName(rawName);
        const folder = deriveTaskFolder(order, folderName);
        
        currentTask = {
          folder,
          order,
          name: rawName,
          description: '',
          dependsOnNumbers: null,  // null = not specified, use implicit
        };
        descriptionLines = [];
      } else if (currentTask) {
        // Check for end of task section (next ## header or ### without number)
        if (line.match(/^##\s+/) || line.match(/^###\s+[^0-9]/)) {
          currentTask.description = descriptionLines.join('\n').trim();
          tasks.push(currentTask);
          currentTask = null;
          descriptionLines = [];
        } else {
          // Check for Depends on: annotation within task section
          const dependsMatch = line.match(dependsOnRegex);
          if (dependsMatch) {
            const value = dependsMatch[1].trim().toLowerCase();
            if (value === 'none') {
              currentTask.dependsOnNumbers = [];
            } else {
              // Parse comma-separated numbers
              const numbers = value
                .split(/[,\s]+/)
                .map(s => parseInt(s.trim(), 10))
                .filter(n => !isNaN(n));
              currentTask.dependsOnNumbers = numbers;
            }
          }
          descriptionLines.push(line);
        }
      }
    }
    
    // Don't forget the last task
    if (currentTask) {
      currentTask.description = descriptionLines.join('\n').trim();
      tasks.push(currentTask);
    }

    return tasks;
  }

}
