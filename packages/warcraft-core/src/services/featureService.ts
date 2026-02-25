import * as fs from 'fs';
import {
  sanitizeName,
  getFeaturePath,
  listFeatureDirectories,
  getFeatureJsonPath,
  getContextPath,
  getTasksPath,
  getPlanPath,
  getTaskStatusPath,
  ensureDir,
  readJson,
  writeJson,
  writeJsonLockedSync,
  fileExists,
} from '../utils/paths.js';
import { FeatureJson, FeatureStatusType, TaskInfo, FeatureInfo, TaskStatus, TaskStatusType } from '../types.js';
import type { BeadsMode, BeadsModeProvider } from '../types.js';
import { BeadsRepository } from './beads/BeadsRepository.js';
import { isBeadsEnabled } from './beads/beadsMode.js';
import { mapBeadStatusToTaskStatus, mapBeadStatusToFeatureStatus } from './beads/beadStatus.js';
import { readJsonArtifact, writeJsonArtifact } from './beads/beadArtifacts.js';

import { ConfigService } from './configService.js';
import { PlanService } from './planService.js';

type FeatureStateArtifact = Pick<
  FeatureJson,
  | 'name'
  | 'epicBeadId'
  | 'status'
  | 'workflowPath'
  | 'reviewChecklistVersion'
  | 'reviewChecklistCompletedAt'
  | 'ticket'
  | 'sessionId'
  | 'createdAt'
  | 'approvedAt'
  | 'completedAt'
>;

type TaskStateArtifact = TaskStatus & { folder?: string };


export class FeatureService {
  private readonly repository: BeadsRepository;
  private readonly beadsModeProvider: BeadsModeProvider;
  private readonly planService: PlanService;

  constructor(
    private projectRoot: string,
    repository: BeadsRepository,
    beadsModeProvider: BeadsModeProvider = new ConfigService(),
  ) {
    this.repository = repository;
    this.beadsModeProvider = beadsModeProvider;
    this.planService = new PlanService(projectRoot, repository, this.beadsModeProvider);
  }

  create(name: string, ticket?: string, priority: number = 3): FeatureJson {
    name = sanitizeName(name);
    const beadsMode = this.getBeadsMode();
    const featurePath = getFeaturePath(this.projectRoot, name, beadsMode);

    if (fileExists(featurePath)) {
      throw new Error(`Feature '${name}' already exists`);
    }

    // Validate priority
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      throw new Error(`Priority must be an integer between 1 and 5 (inclusive), got: ${priority}`);
    }

    const beadsOn = isBeadsEnabled(this.beadsModeProvider);

    // In beadsMode 'off', we don't create bead epics
    let epicBeadId: string;
    if (beadsOn) {
      const epicResult = this.repository.createEpic(name, priority);
      if (epicResult.success === false) {
        throw new Error(`Failed to create epic: ${epicResult.error.message}`);
      }
      epicBeadId = epicResult.value;
    } else {
      epicBeadId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    }
    const feature: FeatureJson = {
      name,
      epicBeadId,
      status: 'planning',
      ticket,
      createdAt: new Date().toISOString(),
    };

    try {
      ensureDir(featurePath);
      ensureDir(getContextPath(this.projectRoot, name, beadsMode));
      if (!beadsOn) {
        // beadsMode off: create local tasks directory
        ensureDir(getTasksPath(this.projectRoot, name));
        writeJson(getFeatureJsonPath(this.projectRoot, name, beadsMode), feature);
      } else {
        this.writeFeatureState(feature.epicBeadId, feature);
      }
    } catch (error) {
      if (fileExists(featurePath)) {
        fs.rmSync(featurePath, { recursive: true, force: true });
      }
      const reason = error instanceof Error ? error.message : String(error);
      const context = beadsOn ? ` after creating epic '${epicBeadId}'` : '';
      throw new Error(
        `Failed to initialize feature '${name}'${context}: ${reason}`,
      );
    }

    return feature;
  }

  get(name: string): FeatureJson | null {
    if (isBeadsEnabled(this.beadsModeProvider)) {
      return this.getViaBeads(name);
    }
    return readJson<FeatureJson>(getFeatureJsonPath(this.projectRoot, name, this.getBeadsMode()));
  }

  private getViaBeads(name: string): FeatureJson | null {
    // Use repository to find epic by name
    const epicResult = this.repository.getEpicByFeatureName(name, false);
    if (epicResult.success === false) {
      console.warn(`Failed to get epic: ${epicResult.error.message}`);
      return null;
    }
    if (!epicResult.value) {
      return null;
    }
    const epicId = epicResult.value;

    // Get gateway for detailed operations
    const gateway = this.repository.getGateway();

    // Read full details via show
    const details = gateway.show(epicId);
    const obj = details as Record<string, unknown>;

    // Extract artifacts if present
    const description = gateway.readDescription(epicId);
    let ticket: string | undefined;

    if (description) {
      // Try to extract ticket from description or artifacts
      const ticketMatch = description.match(/Ticket:\s*([^\n]+)/);
      if (ticketMatch) {
        ticket = ticketMatch[1].trim();
      }
    }

    const featureState = this.readFeatureState(epicId);
    const epic = obj as { status: string; created_at?: string; approved_at?: string; closed_at?: string; title?: string };
    const status = featureState?.status ?? mapBeadStatusToFeatureStatus(epic.status);

    const feature = {
      name: epic.title || name,
      epicBeadId: epicId,
      status,
      ticket: featureState?.ticket ?? ticket,
      createdAt: String(epic.created_at || new Date().toISOString()),
      approvedAt: featureState?.approvedAt ?? (epic.approved_at ? String(epic.approved_at) : undefined),
      completedAt: featureState?.completedAt ?? (epic.closed_at ? String(epic.closed_at) : undefined),
      sessionId: featureState?.sessionId,
      workflowPath: featureState?.workflowPath,
      reviewChecklistVersion: featureState?.reviewChecklistVersion,
      reviewChecklistCompletedAt: featureState?.reviewChecklistCompletedAt,
    };

    writeJson(getFeatureJsonPath(this.projectRoot, feature.name, this.getBeadsMode()), feature);
    return feature;
  }

  list(): string[] {
    if (isBeadsEnabled(this.beadsModeProvider)) {
      return this.listViaBeads();
    }
    return listFeatureDirectories(this.projectRoot, this.getBeadsMode()).sort();
  }

  private listViaBeads(): string[] {
    const gateway = this.repository.getGateway();
    const epics = gateway.list({ type: 'epic', status: 'all' });
    return epics.map(e => e.title).sort();
  }

  getActive(): FeatureJson | null {
    const features = this.list().sort();
    for (const name of features) {
      const feature = this.get(name);
      if (feature && feature.status !== 'completed') {
        return feature;
      }
    }
    return null;
  }

  updateStatus(name: string, status: FeatureStatusType): FeatureJson {
    const feature = this.get(name);
    if (!feature) throw new Error(`Feature '${name}' not found`);

    feature.status = status;
    
    if (status === 'approved' && !feature.approvedAt) {
      feature.approvedAt = new Date().toISOString();
    }
    if (status === 'completed' && !feature.completedAt) {
      feature.completedAt = new Date().toISOString();
    }

    if (isBeadsEnabled(this.beadsModeProvider)) {
      this.writeFeatureState(feature.epicBeadId, feature);
    } else {
      writeJsonLockedSync(getFeatureJsonPath(this.projectRoot, name, this.getBeadsMode()), feature);
    }
    return feature;
  }

  getInfo(name: string): FeatureInfo | null {
    const feature = this.get(name);
    if (!feature) return null;

    const tasks = this.getTasks(name);
    const hasPlan = fileExists(getPlanPath(this.projectRoot, name, this.getBeadsMode()));
    const commentCount = this.planService.getComments(name).length;

    return {
      name: feature.name,
      status: feature.status,
      tasks,
      hasPlan,
      commentCount,
    };
  }

  private getTasks(featureName: string): TaskInfo[] {
    if (isBeadsEnabled(this.beadsModeProvider)) {
      const feature = this.get(featureName);
      if (!feature?.epicBeadId) {
        return [];
      }

      const gateway = this.repository.getGateway();
      const taskBeads = gateway.list({ type: 'task', parent: feature.epicBeadId, status: 'all' });
      return taskBeads.map((taskBead, index) => {
        const beadStatus = mapBeadStatusToTaskStatus(taskBead.status);
        const taskState = this.readTaskState(taskBead.id);
        let folder = taskState?.folder;
        if (!folder) {
          folder = `${String(index + 1).padStart(2, '0')}-${taskBead.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`;
          // Persist the generated folder name so it remains stable across
          // future calls even if task ordering changes (avoids index-derived drift).
          this.writeTaskState(taskBead.id, {
            folder,
            status: taskState?.status ?? beadStatus,
            origin: taskState?.origin ?? 'plan',
            planTitle: taskState?.planTitle ?? taskBead.title,
          });
        }
        return {
          folder,
          name: folder.replace(/^\d+-/, ''),
          beadId: taskBead.id,
          status: taskState?.status ?? beadStatus,
          origin: taskState?.origin ?? 'plan',
          planTitle: taskState?.planTitle ?? taskBead.title,
          summary: taskState?.summary,
        };
      });
    }

    const tasksPath = getTasksPath(this.projectRoot, featureName);
    if (!fileExists(tasksPath)) return [];

    const folders = fs.readdirSync(tasksPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();

    return folders.map(folder => {
      const statusPath = getTaskStatusPath(this.projectRoot, featureName, folder);
      const status = readJson<TaskStatus>(statusPath);
      const name = folder.replace(/^\d+-/, '');
      
      return {
        folder,
        name,
        beadId: status?.beadId,
        status: status?.status || 'pending',
        origin: status?.origin || 'plan',
        planTitle: status?.planTitle,
        summary: status?.summary,
      };
    });
  }

  complete(name: string): FeatureJson {
    const feature = this.get(name);
    if (!feature) throw new Error(`Feature '${name}' not found`);
    
    if (feature.status === 'completed') {
      throw new Error(`Feature '${name}' is already completed`);
    }

    const updated = this.updateStatus(name, 'completed');

    if (!isBeadsEnabled(this.beadsModeProvider)) {
      return updated;
    }

    try {
      const closeResult = this.repository.closeBead(feature.epicBeadId);
      if (closeResult.success === false) {
        console.warn(
          `[warcraft] Failed to close epic bead '${feature.epicBeadId}' for feature '${name}': ${closeResult.error.message}`,
        );
      }
      // Note: flushArtifacts is handled automatically by repository sync policy
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[warcraft] Failed to close epic bead '${feature.epicBeadId}' for feature '${name}': ${reason}`,
      );
    }

    return updated;
  }


  setSession(name: string, sessionId: string): void {
    const feature = this.get(name);
    if (!feature) throw new Error(`Feature '${name}' not found`);

    feature.sessionId = sessionId;
    if (isBeadsEnabled(this.beadsModeProvider)) {
      this.writeFeatureState(feature.epicBeadId, feature);
      return;
    }

    writeJsonLockedSync(getFeatureJsonPath(this.projectRoot, name, this.getBeadsMode()), feature);
  }

  getSession(name: string): string | undefined {
    const feature = this.get(name);
    return feature?.sessionId;
  }

  patchMetadata(name: string, patch: Partial<FeatureJson>): FeatureJson {
    const feature = this.get(name);
    if (!feature) throw new Error(`Feature '${name}' not found`);

    const updated: FeatureJson = {
      ...feature,
      ...patch,
    };
    if (isBeadsEnabled(this.beadsModeProvider)) {
      this.writeFeatureState(updated.epicBeadId, updated);
    } else {
      writeJsonLockedSync(getFeatureJsonPath(this.projectRoot, name, this.getBeadsMode()), updated);
    }
    return updated;
  }

  private readFeatureState(epicBeadId: string): FeatureStateArtifact | null {
    const result = this.repository.getFeatureState(epicBeadId);
    if (result.success === false) {
      console.warn(`Failed to read feature state: ${result.error.message}`);
      return null;
    }
    return result.value;
  }

  private readTaskState(beadId: string): TaskStateArtifact | null {
    const result = this.repository.getTaskState(beadId);
    if (result.success === false) {
      console.warn(`Failed to read task state: ${result.error.message}`);
      return null;
    }
    return result.value;
  }

  private writeTaskState(beadId: string, state: TaskStateArtifact): void {
    try {
      const result = this.repository.setTaskState(beadId, state);
      if (result.success === false) {
        console.warn(`Failed to write task state: ${result.error.message}`);
      }
    } catch {
      // Best-effort persist; if it fails, the folder will be re-derived next call.
    }
  }

  private writeFeatureState(epicBeadId: string, feature: FeatureJson): void {
    writeJson(getFeatureJsonPath(this.projectRoot, feature.name, this.getBeadsMode()), feature);

    const result = this.repository.setFeatureState(epicBeadId, feature);
    if (result.success === false) {
      console.warn(`Failed to write feature state: ${result.error.message}`);
    }
    // Note: flush is handled automatically by repository sync policy
  }

  private getBeadsMode(): BeadsMode {
    return this.beadsModeProvider.getBeadsMode();
  }

}
