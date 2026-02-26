import {
  sanitizeName,
  getPlanPath,
} from '../utils/paths.js';
import { fileExists } from '../utils/fs.js';
import type { FeatureJson, FeatureStatusType, TaskInfo, FeatureInfo, BeadsMode } from '../types.js';
import type { FeatureStore } from './state/types.js';
import type { PlanService } from './planService.js';

export class FeatureService {
  constructor(
    private readonly projectRoot: string,
    private readonly store: FeatureStore,
    private readonly planService: PlanService,
    private readonly beadsMode: BeadsMode = 'on',
    private readonly taskLister?: { list(featureName: string): TaskInfo[] },
  ) {}

  create(name: string, ticket?: string, priority: number = 3): FeatureJson {
    name = sanitizeName(name);

    if (this.store.exists(name)) {
      throw new Error(`Feature '${name}' already exists`);
    }

    // Validate priority
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      throw new Error(`Priority must be an integer between 1 and 5 (inclusive), got: ${priority}`);
    }

    return this.store.create(
      {
        name,
        ticket,
        status: 'planning',
        createdAt: new Date().toISOString(),
      },
      priority,
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

    feature.status = status;

    if (status === 'approved' && !feature.approvedAt) {
      feature.approvedAt = new Date().toISOString();
    }
    if (status === 'completed' && !feature.completedAt) {
      feature.completedAt = new Date().toISOString();
    }

    this.store.save(feature);
    return feature;
  }

  getInfo(name: string): FeatureInfo | null {
    const feature = this.get(name);
    if (!feature) return null;

    const tasks = this.taskLister?.list(name) ?? [];
    const hasPlan = fileExists(getPlanPath(this.projectRoot, name, this.beadsMode));
    const commentCount = this.planService.getComments(name).length;

    return {
      name: feature.name,
      status: feature.status,
      tasks,
      hasPlan,
      commentCount,
    };
  }

  complete(name: string): FeatureJson {
    const feature = this.get(name);
    if (!feature) throw new Error(`Feature '${name}' not found`);

    if (feature.status === 'completed') {
      throw new Error(`Feature '${name}' is already completed`);
    }

    const updated = this.updateStatus(name, 'completed');
    this.store.complete(updated);
    return updated;
  }

  setSession(name: string, sessionId: string): void {
    const feature = this.get(name);
    if (!feature) throw new Error(`Feature '${name}' not found`);

    feature.sessionId = sessionId;
    this.store.save(feature);
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
    this.store.save(updated);
    return updated;
  }
}
