import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilesystemPlanStore } from './fs-plan-store.js';

describe('FilesystemPlanStore', () => {
  let tempDir: string;
  let store: FilesystemPlanStore;
  const featureName = 'test-feature';

  function writeFeatureJson(data: Record<string, unknown>): void {
    const featureDir = path.join(tempDir, 'docs', featureName);
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, 'feature.json'), JSON.stringify(data));
  }

  function readFeatureJson(): Record<string, unknown> {
    const raw = fs.readFileSync(path.join(tempDir, 'docs', featureName, 'feature.json'), 'utf-8');
    return JSON.parse(raw);
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-plan-store-test-'));
    store = new FilesystemPlanStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('approve()', () => {
    it('sets status to approved and stores plan hash', () => {
      writeFeatureJson({ name: featureName, status: 'planning' });

      store.approve(featureName, 'The plan content', '2024-01-01T00:00:00Z');

      const data = readFeatureJson();
      expect(data.status).toBe('approved');
      expect(data.approvedAt).toBe('2024-01-01T00:00:00Z');
      expect(data.planApprovalHash).toBeDefined();
      expect(typeof data.planApprovalHash).toBe('string');
      expect((data.planApprovalHash as string).length).toBe(64); // SHA-256 hex length
    });

    it('is a no-op when feature.json does not exist', () => {
      // Should not throw
      store.approve(featureName, 'content', '2024-01-01T00:00:00Z');

      expect(fs.existsSync(path.join(tempDir, 'docs', featureName, 'feature.json'))).toBe(false);
    });
  });

  describe('isApproved()', () => {
    it('returns true when plan content matches approval hash', () => {
      writeFeatureJson({ name: featureName, status: 'planning' });

      const planContent = 'My plan for the feature';
      store.approve(featureName, planContent, '2024-01-01T00:00:00Z');

      expect(store.isApproved(featureName, planContent)).toBe(true);
    });

    it('returns false when plan content has changed since approval', () => {
      writeFeatureJson({ name: featureName, status: 'planning' });

      store.approve(featureName, 'Original plan', '2024-01-01T00:00:00Z');

      expect(store.isApproved(featureName, 'Modified plan')).toBe(false);
    });

    it('returns false when feature does not exist', () => {
      expect(store.isApproved('non-existent', 'content')).toBe(false);
    });

    it('returns false when status is not approved', () => {
      writeFeatureJson({ name: featureName, status: 'planning' });

      expect(store.isApproved(featureName, 'any content')).toBe(false);
    });

    it('returns false when planApprovalHash is missing', () => {
      writeFeatureJson({ name: featureName, status: 'approved' });

      expect(store.isApproved(featureName, 'content')).toBe(false);
    });
  });

  describe('revokeApproval()', () => {
    it('resets status to planning and removes approval fields', () => {
      writeFeatureJson({ name: featureName, status: 'planning' });

      store.approve(featureName, 'Plan content', '2024-01-01T00:00:00Z');

      const afterApprove = readFeatureJson();
      expect(afterApprove.status).toBe('approved');
      expect(afterApprove.planApprovalHash).toBeDefined();

      store.revokeApproval(featureName);

      const afterRevoke = readFeatureJson();
      expect(afterRevoke.status).toBe('planning');
      expect(afterRevoke.approvedAt).toBeUndefined();
      expect(afterRevoke.planApprovalHash).toBeUndefined();
    });

    it('is a no-op when feature is not approved', () => {
      writeFeatureJson({ name: featureName, status: 'executing' });

      store.revokeApproval(featureName);

      const data = readFeatureJson();
      expect(data.status).toBe('executing');
    });

    it('is a no-op when feature.json does not exist', () => {
      // Should not throw
      store.revokeApproval('non-existent');
    });
  });

  describe('syncPlanDescription()', () => {
    it('is a no-op in filesystem mode', () => {
      // Should not throw and not create any files
      store.syncPlanDescription(featureName, 'plan content');

      expect(fs.existsSync(path.join(tempDir, 'docs', featureName))).toBe(false);
    });
  });
});
