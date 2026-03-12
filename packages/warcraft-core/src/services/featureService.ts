import type { BeadsMode, FeatureInfo, FeatureJson, FeatureStatusType, TaskInfo } from '../types.js';
import { fileExists } from '../utils/fs.js';
import { getPlanPath, sanitizeName } from '../utils/paths.js';
import type { OperationOutcome } from './outcomes.js';
import { diagnostic, fatal, ok } from './outcomes.js';
import type { FeatureStore } from './state/types.js';

export class FeatureService {
  constructor(
    private readonly projectRoot: string,
    private readonly store: FeatureStore,
    private readonly beadsMode: BeadsMode = 'on',
    private readonly taskLister?: { list(featureName: string): TaskInfo[] },
  ) {}

  create(name: string, ticket?: string, priority: number = 3): OperationOutcome<FeatureJson> {
    name = sanitizeName(name);

    if (this.store.exists(name)) {
      return fatal([diagnostic('feature_already_exists', `Feature '${name}' already exists`, 'fatal')]);
    }

    // Validate priority
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      return fatal([
        diagnostic(
          'invalid_priority',
          `Priority must be an integer between 1 and 5 (inclusive), got: ${priority}`,
          'fatal',
        ),
      ]);
    }

    return ok(
      this.store.create(
        {
          name,
          ticket,
          status: 'planning',
          createdAt: new Date().toISOString(),
        },
        priority,
      ),
    );
  }

  get(name: string): FeatureJson | null {
    return this.store.get(name);
  }

  list(): string[] {
    return this.store.list();
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

    const updated = this.buildUpdatedFeature(feature, status);
    this.store.save(updated);
    return updated;
  }

  getInfo(name: string): FeatureInfo | null {
    const feature = this.get(name);
    if (!feature) return null;

    const tasks = this.taskLister?.list(name) ?? [];
    const hasPlan = fileExists(getPlanPath(this.projectRoot, name, this.beadsMode));

    return {
      name: feature.name,
      status: feature.status,
      tasks,
      hasPlan,
    };
  }

  complete(name: string): OperationOutcome<FeatureJson> {
    const feature = this.get(name);
    if (!feature) {
      return fatal([diagnostic('feature_not_found', `Feature '${name}' not found`, 'fatal')]);
    }

    if (feature.status === 'completed') {
      return fatal([diagnostic('feature_already_completed', `Feature '${name}' is already completed`, 'fatal')]);
    }

    const updated = this.buildUpdatedFeature(feature, 'completed');
    this.store.complete(updated);
    return ok(updated);
  }

  syncCompletionFromTasks(name: string): FeatureJson | null {
    const feature = this.get(name);
    if (!feature) return null;

    const tasks = this.taskLister?.list(name) ?? [];
    if (tasks.length === 0) return feature;

    const allTasksDone = tasks.every((task) => task.status === 'done');
    if (allTasksDone) {
      if (feature.status === 'completed') {
        return feature;
      }

      const completed = this.buildUpdatedFeature(feature, 'completed');
      this.store.complete(completed);
      return completed;
    }

    if (feature.status === 'completed') {
      const reopened = this.buildUpdatedFeature(feature, 'executing', { clearCompletedAt: true });
      this.store.reopen(reopened);
      return reopened;
    }

    return feature;
  }

  setSession(name: string, sessionId: string): void {
    const feature = this.get(name);
    if (!feature) throw new Error(`Feature '${name}' not found`);

    this.store.save({
      ...feature,
      sessionId,
    });
  }

  getSession(name: string): string | undefined {
    const feature = this.get(name);
    return feature?.sessionId;
  }

  private buildUpdatedFeature(
    feature: FeatureJson,
    status: FeatureStatusType,
    options: { clearCompletedAt?: boolean } = {},
  ): FeatureJson {
    const updated: FeatureJson = {
      ...feature,
      status,
    };

    if (status === 'approved' && !updated.approvedAt) {
      updated.approvedAt = new Date().toISOString();
    }
    if (status === 'completed' && !updated.completedAt) {
      updated.completedAt = new Date().toISOString();
    }
    if (options.clearCompletedAt) {
      delete updated.completedAt;
    }

    return updated;
  }

  patchMetadata(name: string, patch: Partial<FeatureJson>): FeatureJson {
    const feature = this.get(name);
    if (!feature) throw new Error(`Feature '${name}' not found`);

    const immutableKeys: Array<keyof FeatureJson> = ['name', 'epicBeadId', 'createdAt'];
    const blockedKeys = immutableKeys.filter((key) => patch[key] !== undefined);
    if (blockedKeys.length > 0) {
      console.warn(`[warcraft] Ignoring immutable feature metadata fields: ${blockedKeys.join(', ')}`);
    }

    const mutablePatch: Partial<FeatureJson> = { ...patch };
    for (const key of blockedKeys) {
      delete mutablePatch[key];
    }

    const updated: FeatureJson = {
      ...feature,
      ...mutablePatch,
    };
    this.store.save(updated);
    return updated;
  }
}
