import * as fs from 'fs';
import * as path from 'path';
import type { FeatureJson, FeatureStatusType } from '../../types.js';
import { ensureDir, fileExists, writeJson } from '../../utils/fs.js';
import { acquireLockSync } from '../../utils/json-lock.js';
import { getContextPath, getFeatureJsonPath, getFeaturePath } from '../../utils/paths.js';
import { type BeadsRepository, isRepositoryInitFailure } from '../beads/BeadsRepository.js';
import { mapBeadStatusToFeatureStatus } from '../beads/beadStatus.js';
import type { CreateFeatureInput, FeatureStore } from './types.js';

/**
 * FeatureStore implementation for beadsMode='on'.
 *
 * Creates epic beads, dual-writes cache to disk + bead artifacts.
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
        this.writeFeatureState(epicBeadId, feature);
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
    const epicResult = this.repository.getEpicByFeatureName(name, false);
    if (epicResult.success === false) {
      this.throwIfInitFailure(epicResult.error, `Failed to get epic for feature '${name}'`);
      console.warn(`Failed to get epic: ${epicResult.error.message}`);
      return null;
    }
    if (!epicResult.value) {
      return null;
    }
    const epicId = epicResult.value;

    const gateway = this.repository.getGateway();

    let details: Record<string, unknown>;
    try {
      details = gateway.show(epicId) as Record<string, unknown>;
    } catch (error) {
      this.throwIfInitFailure(error, `Failed to show epic '${epicId}' for feature '${name}'`);
      return null;
    }

    const description = gateway.readDescription(epicId);
    let ticket: string | undefined;

    if (description) {
      const ticketMatch = description.match(/Ticket:\s*([^\n]+)/);
      if (ticketMatch) {
        ticket = ticketMatch[1].trim();
      }
    }

    const featureStateResult = this.repository.getFeatureState(epicId);
    const featureState = featureStateResult.success !== false ? featureStateResult.value : null;

    const epic = details as {
      status: string;
      created_at?: string;
      approved_at?: string;
      closed_at?: string;
      title?: string;
    };
    const status: FeatureStatusType = featureState?.status ?? mapBeadStatusToFeatureStatus(epic.status);

    const feature: FeatureJson = {
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

    // Write cache to disk
    writeJson(getFeatureJsonPath(this.projectRoot, feature.name, 'on'), feature);
    return feature;
  }

  list(): string[] {
    const gateway = this.repository.getGateway();
    const epics = gateway.list({ type: 'epic', status: 'all' });
    return epics.map((e) => e.title).sort();
  }

  save(feature: FeatureJson): void {
    this.writeFeatureState(feature.epicBeadId, feature);
  }

  complete(feature: FeatureJson): void {
    this.save(feature);
    try {
      const closeResult = this.repository.closeBead(feature.epicBeadId);
      if (closeResult.success === false) {
        this.throwIfInitFailure(
          closeResult.error,
          `[warcraft] Failed to close epic bead '${feature.epicBeadId}' for feature '${feature.name}'`,
        );
        console.warn(
          `[warcraft] Failed to close epic bead '${feature.epicBeadId}' for feature '${feature.name}': ${closeResult.error.message}`,
        );
      }
    } catch (error) {
      this.throwIfInitFailure(
        error,
        `[warcraft] Failed to close epic bead '${feature.epicBeadId}' for feature '${feature.name}'`,
      );
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[warcraft] Failed to close epic bead '${feature.epicBeadId}' for feature '${feature.name}': ${reason}`,
      );
    }
  }

  private writeFeatureState(epicBeadId: string, feature: FeatureJson): void {
    writeJson(getFeatureJsonPath(this.projectRoot, feature.name, 'on'), feature);
    const result = this.repository.setFeatureState(epicBeadId, feature);
    if (result.success === false) {
      this.throwIfInitFailure(result.error, `Failed to write feature state for epic '${epicBeadId}'`);
      console.warn(`Failed to write feature state: ${result.error.message}`);
    }
  }

  private throwIfInitFailure(error: unknown, context: string): void {
    if (!isRepositoryInitFailure(error)) {
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${context}: ${reason}`);
  }
}
