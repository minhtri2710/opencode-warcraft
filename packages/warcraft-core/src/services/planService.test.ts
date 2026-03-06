import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlanService } from './planService';
import { createStores } from './state/index.js';

/**
 * Mock BeadsRepository that tracks calls and stores data for round-trip tests.
 * Implements the label + description equality model used by BeadsPlanStore.
 */
class MockBeadsRepository {
  // Tracking arrays for assertions
  addedLabels: Array<{ beadId: string; label: string }> = [];
  removedLabels: Array<{ beadId: string; label: string }> = [];
  setDescriptions: Array<{ beadId: string; content: string }> = [];

  // Internal storage for round-trip tests
  private labels = new Map<string, Set<string>>();
  private descriptions = new Map<string, string>();

  getEpicByFeatureName(_name: string, _cache: boolean) {
    return { success: true as const, value: 'epic-1' };
  }

  addWorkflowLabel(beadId: string, label: string) {
    this.addedLabels.push({ beadId, label });
    if (!this.labels.has(beadId)) {
      this.labels.set(beadId, new Set());
    }
    this.labels.get(beadId)!.add(label);
    return { success: true as const, value: undefined };
  }

  removeWorkflowLabel(beadId: string, label: string) {
    this.removedLabels.push({ beadId, label });
    this.labels.get(beadId)?.delete(label);
    return { success: true as const, value: undefined };
  }

  hasWorkflowLabel(beadId: string, label: string): boolean {
    return this.labels.get(beadId)?.has(label) ?? false;
  }

  setPlanDescription(beadId: string, content: string) {
    this.setDescriptions.push({ beadId, content });
    this.descriptions.set(beadId, content);
    return { success: true as const, value: undefined };
  }

  getPlanDescription(beadId: string) {
    return { success: true as const, value: this.descriptions.get(beadId) ?? null };
  }
}

let testRoot = '';

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-plan-service-'));
});

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function setupFeature(feature: string): void {
  const featurePayload = JSON.stringify(
    {
      name: feature,
      epicBeadId: 'epic-1',
      status: 'planning',
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  );

  for (const root of [path.join(testRoot, '.beads', 'artifacts'), path.join(testRoot, 'docs')]) {
    const featurePath = path.join(root, feature);
    fs.mkdirSync(featurePath, { recursive: true });
    fs.writeFileSync(path.join(featurePath, 'plan.md'), '# Plan');
    fs.writeFileSync(path.join(featurePath, 'feature.json'), featurePayload);
  }
}

describe('PlanService bead sync', () => {
  it('adds plan-approved label when mode is on', () => {
    setupFeature('feature-a');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('feature-a');

    expect(mockRepo.addedLabels).toEqual([{ beadId: 'epic-1', label: 'approved' }]);
  });

  it('skips bead label sync when mode is off', () => {
    setupFeature('feature-b');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'off', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    service.approve('feature-b');
    service.revokeApproval('feature-b');

    expect(mockRepo.addedLabels).toEqual([]);
  });

  it('updates epic description when writing plan and mode is on', () => {
    setupFeature('feature-c');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    const planContent = '# My Plan\n\nSome content here';
    service.write('feature-c', planContent);

    expect(mockRepo.setDescriptions).toEqual([{ beadId: 'epic-1', content: planContent }]);
  });

  it('skips epic description update when writing plan and mode is off', () => {
    setupFeature('feature-d');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'off', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    service.write('feature-d', '# My Plan');

    expect(mockRepo.setDescriptions).toEqual([]);
  });
});

describe('PlanService hash-based approval validity', () => {
  function setupFeatureWithPlan(feature: string, planContent: string): void {
    const featurePayload = JSON.stringify(
      {
        name: feature,
        epicBeadId: 'epic-1',
        status: 'planning',
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    );

    for (const root of [path.join(testRoot, '.beads', 'artifacts'), path.join(testRoot, 'docs')]) {
      const featurePath = path.join(root, feature);
      fs.mkdirSync(featurePath, { recursive: true });
      fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);
      fs.writeFileSync(path.join(featurePath, 'feature.json'), featurePayload);
    }
  }

  it('approve() writes approval metadata to feature.json in off mode', () => {
    setupFeatureWithPlan('feature-hash', '# My Plan\n\nSome content here');
    const stores = createStores(testRoot, 'off', new MockBeadsRepository() as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    service.approve('feature-hash');

    const featureJsonPath = path.join(testRoot, 'docs', 'feature-hash', 'feature.json');
    const feature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    expect(feature.status).toBe('approved');
    expect(feature.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('isApproved() returns true when current plan hash matches marker hash', () => {
    const planContent = '# My Plan\n\nSome content here';
    setupFeatureWithPlan('feature-valid', planContent);
    const stores = createStores(testRoot, 'off', new MockBeadsRepository() as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    service.approve('feature-valid');
    const isApproved = service.isApproved('feature-valid');

    expect(isApproved).toBe(true);
  });

  it('isApproved() returns false when plan content changes after approval (hash mismatch)', () => {
    const originalContent = '# My Plan\n\nOriginal content';
    setupFeatureWithPlan('feature-invalid', originalContent);
    const stores = createStores(testRoot, 'off', new MockBeadsRepository() as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    service.approve('feature-invalid');

    // Simulate plan modification after approval
    const planPath = path.join(testRoot, 'docs', 'feature-invalid', 'plan.md');
    fs.writeFileSync(planPath, '# My Plan\n\nModified content');

    const isApproved = service.isApproved('feature-invalid');

    expect(isApproved).toBe(false);
  });

  it('isApproved() returns false for legacy feature.json without stored approval', () => {
    setupFeatureWithPlan('feature-legacy', '# Legacy Plan\n\nOld content');
    const featureJsonPath = path.join(testRoot, 'docs', 'feature-legacy', 'feature.json');
    const feature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    feature.status = 'approved';
    feature.approvedAt = '2024-01-15T10:30:00.000Z';
    fs.writeFileSync(featureJsonPath, JSON.stringify(feature, null, 2));

    const stores = createStores(testRoot, 'off', new MockBeadsRepository() as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    const isApproved = service.isApproved('feature-legacy');

    expect(isApproved).toBe(false);
  });
});

describe('PlanService bead-backed approval (beadsMode: on)', () => {
  function setupFeatureWithPlan(feature: string, planContent: string): void {
    const featurePath = path.join(testRoot, '.beads', 'artifacts', feature);
    fs.mkdirSync(featurePath, { recursive: true });
    fs.writeFileSync(path.join(featurePath, 'plan.md'), planContent);
    fs.writeFileSync(
      path.join(featurePath, 'feature.json'),
      JSON.stringify(
        {
          name: feature,
          epicBeadId: 'epic-1',
          status: 'planning',
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  }

  it('approve() sets description and adds approved label', () => {
    const planContent = '# My Plan\n\nContent';
    setupFeatureWithPlan('bead-approve-test', planContent);
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-approve-test', 'session-123');

    // Should set description to plan content
    expect(mockRepo.setDescriptions).toContainEqual({ beadId: 'epic-1', content: planContent });
    // Should add approved label
    expect(mockRepo.addedLabels).toContainEqual({ beadId: 'epic-1', label: 'approved' });
    // Should have the label tracked
    expect(mockRepo.hasWorkflowLabel('epic-1', 'approved')).toBe(true);
  });

  it('isApproved() returns true when label exists and description matches', () => {
    const planContent = '# My Plan\n\nContent';
    setupFeatureWithPlan('bead-is-approved', planContent);
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-is-approved');

    expect(service.isApproved('bead-is-approved')).toBe(true);
  });

  it('isApproved() returns false when plan content changes after approval', () => {
    const originalContent = '# My Plan\n\nOriginal';
    setupFeatureWithPlan('bead-hash-invalid', originalContent);
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-hash-invalid');

    // Modify plan content
    const planPath = path.join(testRoot, '.beads', 'artifacts', 'bead-hash-invalid', 'plan.md');
    fs.writeFileSync(planPath, '# My Plan\n\nModified');

    expect(service.isApproved('bead-hash-invalid')).toBe(false);
  });

  it('isApproved() returns false when no approval exists', () => {
    setupFeatureWithPlan('bead-no-artifact', '# Plan\n\nContent');
    const stores = createStores(testRoot, 'on', new MockBeadsRepository() as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');
    expect(service.isApproved('bead-no-artifact')).toBe(false);
  });

  it('revokeApproval() removes approved label', () => {
    setupFeatureWithPlan('bead-revoke', '# Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-revoke');
    expect(service.isApproved('bead-revoke')).toBe(true);

    service.revokeApproval('bead-revoke');

    expect(service.isApproved('bead-revoke')).toBe(false);
    expect(mockRepo.hasWorkflowLabel('epic-1', 'approved')).toBe(false);
    expect(mockRepo.removedLabels).toContainEqual({ beadId: 'epic-1', label: 'approved' });
  });

  it('write() invalidates approval when plan content changes', () => {
    const originalContent = '# Original Plan';
    setupFeatureWithPlan('bead-write-invalidate', originalContent);
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-write-invalidate');
    expect(service.isApproved('bead-write-invalidate')).toBe(true);

    // Write different content
    service.write('bead-write-invalidate', '# Modified Plan');

    expect(service.isApproved('bead-write-invalidate')).toBe(false);
  });

  it('write() does not invalidate approval when content is unchanged', () => {
    const content = '# Original Plan';
    setupFeatureWithPlan('bead-write-preserve', content);
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-write-preserve');
    expect(service.isApproved('bead-write-preserve')).toBe(true);

    // Write same content
    service.write('bead-write-preserve', content);

    expect(service.isApproved('bead-write-preserve')).toBe(true);
  });

  it('isApproved() returns false when no epicBeadId exists', () => {
    const featurePath = path.join(testRoot, '.beads', 'artifacts', 'no-epic');
    fs.mkdirSync(featurePath, { recursive: true });
    fs.writeFileSync(path.join(featurePath, 'plan.md'), '# Plan');
    fs.writeFileSync(
      path.join(featurePath, 'feature.json'),
      JSON.stringify({
        name: 'no-epic',
        status: 'planning',
        createdAt: new Date().toISOString(),
        // No epicBeadId
      }),
    );

    // Mock that returns no epic for this feature
    const mockRepo = new MockBeadsRepository();
    mockRepo.getEpicByFeatureName = () => ({ success: true as const, value: null });

    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    expect(service.isApproved('no-epic')).toBe(false);
  });

  it('approve() without sessionId works correctly', () => {
    setupFeatureWithPlan('bead-no-session', '# Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-no-session');

    expect(mockRepo.addedLabels).toContainEqual({ beadId: 'epic-1', label: 'approved' });
    expect(mockRepo.hasWorkflowLabel('epic-1', 'approved')).toBe(true);
  });

  it('revokeApproval() does not add contradictory approved label', () => {
    setupFeatureWithPlan('revoke-labels', '# Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('revoke-labels');
    const labelsAfterApprove = [...mockRepo.addedLabels];

    service.revokeApproval('revoke-labels');

    // Revoke should NOT add any new labels (especially not a second 'approved')
    expect(mockRepo.addedLabels).toEqual(labelsAfterApprove);
  });

  it('revokeApproval() is idempotent when feature is already planning', () => {
    setupFeatureWithPlan('revoke-idempotent', '# Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    // Revoke without prior approval should not throw
    service.revokeApproval('revoke-idempotent');

    // Feature.json should still be 'planning'
    const featureJsonPath = path.join(testRoot, '.beads', 'artifacts', 'revoke-idempotent', 'feature.json');
    const localFeature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    expect(localFeature.status).toBe('planning');
  });

  it('write() with changed content resets feature state from approved to planning', () => {
    setupFeatureWithPlan('write-resets', '# Original Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('write-resets');
    expect(service.isApproved('write-resets')).toBe(true);

    // Write changed content triggers revokeApproval
    service.write('write-resets', '# Modified Plan');

    expect(service.isApproved('write-resets')).toBe(false);

    // Local feature.json should reflect planning status
    const featureJsonPath = path.join(testRoot, '.beads', 'artifacts', 'write-resets', 'feature.json');
    const localFeature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    expect(localFeature.status).toBe('planning');
  });
});
