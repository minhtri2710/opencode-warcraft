import * as fs from 'fs';
import * as path from 'path';
import type { FeatureJson } from '../../types.js';
import { ensureDir, fileExists, readJson, writeJson } from '../../utils/fs.js';
import { acquireLockSync } from '../../utils/json-lock.js';
import { getContextPath, getFeatureJsonPath, getFeaturePath } from '../../utils/paths.js';
import { type BeadsRepository, throwIfInitFailure } from '../beads/BeadsRepository.js';
import type { CreateFeatureInput, FeatureStore } from './types.js';

/**
 * FeatureStore implementation for beadsMode='on'.
 *
 * Feature data lives in feature.json on disk; epic beads provide fallback metadata.
 */
export class BeadsFeatureStore implements FeatureStore {
  constructor(
    private readonly projectRoot: string,
    private readonly repository: BeadsRepository,
  ) {}

  exists(name: string): boolean {
    return fileExists(getFeaturePath(this.projectRoot, name, 'on'));
  }

  create(input: CreateFeatureInput, priority: number): FeatureJson {
    const featurePath = getFeaturePath(this.projectRoot, input.name, 'on');
    const featureJsonPath = getFeatureJsonPath(this.projectRoot, input.name, 'on');
    const lockTarget = `${featurePath}.create`;

    ensureDir(path.dirname(featurePath));
    const release = acquireLockSync(lockTarget);
    try {
      if (fileExists(featureJsonPath)) {
        throw new Error(`Feature '${input.name}' already exists`);
      }

      const epicResult = this.repository.createEpic(input.name, priority);
      if (epicResult.success === false) {
        throw new Error(`Failed to create epic: ${epicResult.error.message}`);
      }
      const epicBeadId = epicResult.value;

      const feature: FeatureJson = {
        name: input.name,
        epicBeadId,
        status: input.status,
        ticket: input.ticket,
        createdAt: input.createdAt,
      };

      try {
        ensureDir(featurePath);
        ensureDir(getContextPath(this.projectRoot, input.name, 'on'));
        writeJson(featureJsonPath, feature);
      } catch (error) {
        if (fileExists(featurePath)) {
          fs.rmSync(featurePath, { recursive: true, force: true });
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to initialize feature '${input.name}' after creating epic '${epicBeadId}': ${reason}`);
      }

      return feature;
    } finally {
      release();
    }
  }

  get(name: string): FeatureJson | null {
    const featureJsonPath = getFeatureJsonPath(this.projectRoot, name, 'on');
    const cached = readJson<FeatureJson>(featureJsonPath);
    if (cached) {
      return cached;
    }

    const epicResult = this.repository.getEpicByFeatureName(name, false);
    if (epicResult.success === false) {
      throwIfInitFailure(epicResult.error, `Failed to get epic for feature '${name}'`);
      return null;
    }
    if (!epicResult.value) {
      return null;
    }

    const feature: FeatureJson = {
      name,
      epicBeadId: epicResult.value,
      status: 'planning',
      createdAt: new Date().toISOString(),
    };

    writeJson(featureJsonPath, feature);
    return feature;
  }

  list(): string[] {
    const result = this.repository.listEpics('all');
    if (result.success === false) {
      throwIfInitFailure(result.error, '[warcraft] Failed to list features');
      return [];
    }
    return result.value.map((e) => e.title).sort();
  }

  save(feature: FeatureJson): void {
    writeJson(getFeatureJsonPath(this.projectRoot, feature.name, 'on'), feature);
  }

  complete(feature: FeatureJson): void {
    this.save(feature);
    try {
      const closeResult = this.repository.closeBead(feature.epicBeadId);
      if (closeResult.success === false) {
        throwIfInitFailure(
          closeResult.error,
          `[warcraft] Failed to close epic bead '${feature.epicBeadId}' for feature '${feature.name}'`,
        );
        console.warn(
          `[warcraft] Failed to close epic bead '${feature.epicBeadId}' for feature '${feature.name}': ${closeResult.error.message}`,
        );
      }
    } catch (error) {
      throwIfInitFailure(
        error,
        `[warcraft] Failed to close epic bead '${feature.epicBeadId}' for feature '${feature.name}'`,
      );
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[warcraft] Failed to close epic bead '${feature.epicBeadId}' for feature '${feature.name}': ${reason}`,
      );
    }
  }
}
