import * as path from 'path';
import * as fs from 'fs';
import type { FeatureJson } from '../../types.js';
import {
  getFeaturePath,
  getFeatureJsonPath,
  getContextPath,
  getTasksPath,
  listFeatureDirectories,
} from '../../utils/paths.js';
import { ensureDir, readJson, writeJson, fileExists } from '../../utils/fs.js';
import { acquireLockSync, writeJsonLockedSync } from '../../utils/json-lock.js';
import type { FeatureStore, CreateFeatureInput } from './types.js';

/**
 * FeatureStore implementation for beadsMode='off'.
 *
 * Manages feature state entirely via local filesystem directories and JSON files.
 */
export class FilesystemFeatureStore implements FeatureStore {
  constructor(private readonly projectRoot: string) {}

  exists(name: string): boolean {
    return fileExists(getFeaturePath(this.projectRoot, name, 'off'));
  }

  create(input: CreateFeatureInput, _priority: number): FeatureJson {
    const featurePath = getFeaturePath(this.projectRoot, input.name, 'off');
    const featureJsonPath = getFeatureJsonPath(this.projectRoot, input.name, 'off');
    const lockTarget = `${featurePath}.create`;

    ensureDir(path.dirname(featurePath));
    const release = acquireLockSync(lockTarget);
    try {
      if (fileExists(featureJsonPath)) {
        throw new Error(`Feature '${input.name}' already exists`);
      }

      const epicBeadId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const feature: FeatureJson = {
        name: input.name,
        epicBeadId,
        status: input.status,
        ticket: input.ticket,
        createdAt: input.createdAt,
      };

      try {
        ensureDir(featurePath);
        ensureDir(getContextPath(this.projectRoot, input.name, 'off'));
        ensureDir(getTasksPath(this.projectRoot, input.name));
        writeJson(featureJsonPath, feature);
      } catch (error) {
        if (fileExists(featurePath)) {
          fs.rmSync(featurePath, { recursive: true, force: true });
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to initialize feature '${input.name}': ${reason}`,
        );
      }

      return feature;
    } finally {
      release();
    }
  }

  get(name: string): FeatureJson | null {
    return readJson<FeatureJson>(getFeatureJsonPath(this.projectRoot, name, 'off'));
  }

  list(): string[] {
    return listFeatureDirectories(this.projectRoot, 'off').sort();
  }

  save(feature: FeatureJson): void {
    writeJsonLockedSync(getFeatureJsonPath(this.projectRoot, feature.name, 'off'), feature);
  }

  complete(feature: FeatureJson): void {
    this.save(feature);
  }
}
