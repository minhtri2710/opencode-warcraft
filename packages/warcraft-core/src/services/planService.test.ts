import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FeatureJson, PlanComment } from '../types.js';
import type { PlanApprovalPayload } from './beads/BeadGateway.types.js';
import { PlanService } from './planService';
import { createStores } from './state/index.js';

/**
 * Mock BeadsRepository that tracks calls and stores data for round-trip tests.
 * Replaces the old FakePlanBeadClient to match the refactored PlanService
 * which now uses BeadsRepository instead of a separate PlanBeadClient.
 */
class MockBeadsRepository {
  // Tracking arrays for assertions
  labels: Array<{ beadId: string; label: string }> = [];
  descriptions: Array<{ beadId: string; content: string }> = [];
  appendedComments: Array<{ beadId: string; comment: string }> = [];

  // Internal storage for round-trip tests
  private approvals = new Map<string, PlanApprovalPayload>();
  private approvedPlans = new Map<string, string>();
  private planComments = new Map<string, PlanComment[]>();
  private featureStates = new Map<string, FeatureJson>();

  getEpicByFeatureName(_name: string, _cache: boolean) {
    // Read epicBeadId from feature.json if it exists (simulates real behavior)
    return { success: true as const, value: 'epic-1' };
  }

  setPlanApproval(beadId: string, hash: string, timestamp: string, session?: string) {
    const payload: PlanApprovalPayload = {
      hash,
      approvedAt: timestamp,
      ...(session !== undefined ? { approvedBySession: session } : {}),
    };
    this.approvals.set(beadId, payload);
    return { success: true as const, value: undefined };
  }

  getPlanApproval(beadId: string) {
    const approval = this.approvals.get(beadId) ?? null;
    return { success: true as const, value: approval };
  }

  setApprovedPlan(beadId: string, content: string, _hash?: string) {
    this.approvedPlans.set(beadId, content);
    return { success: true as const, value: undefined };
  }

  getApprovedPlan(beadId: string) {
    return { success: true as const, value: this.approvedPlans.get(beadId) ?? null };
  }

  addWorkflowLabel(beadId: string, label: string) {
    this.labels.push({ beadId, label });
    return { success: true as const, value: undefined };
  }

  setPlanDescription(beadId: string, content: string) {
    this.descriptions.push({ beadId, content });
    return { success: true as const, value: undefined };
  }

  appendPlanComment(beadId: string, comment: string) {
    this.appendedComments.push({ beadId, comment });
    return { success: true as const, value: undefined };
  }

  getPlanComments(beadId: string) {
    return { success: true as const, value: this.planComments.get(beadId) ?? null };
  }

  setPlanComments(beadId: string, comments: PlanComment[]) {
    this.planComments.set(beadId, comments);
    return { success: true as const, value: undefined };
  }

  getFeatureState(epicBeadId: string) {
    const state = this.featureStates.get(epicBeadId) ?? null;
    return { success: true as const, value: state };
  }

  setFeatureState(epicBeadId: string, feature: FeatureJson) {
    this.featureStates.set(epicBeadId, { ...feature });
    return { success: true as const, value: undefined };
  }

  getStoredFeatureState(epicBeadId: string): FeatureJson | undefined {
    return this.featureStates.get(epicBeadId);
  }

  // Convenience accessors for test assertions
  getStoredApproval(beadId: string): PlanApprovalPayload | undefined {
    return this.approvals.get(beadId);
  }

  getStoredApprovedPlan(beadId: string): string | undefined {
    return this.approvedPlans.get(beadId);
  }

  getStoredComments(beadId: string): PlanComment[] | undefined {
    return this.planComments.get(beadId);
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

    expect(mockRepo.labels).toEqual([{ beadId: 'epic-1', label: 'approved' }]);
  });

  it('skips bead label sync when mode is off', () => {
    setupFeature('feature-b');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'off', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    service.approve('feature-b');
    service.revokeApproval('feature-b');

    expect(mockRepo.labels).toEqual([]);
  });

  it('updates epic description when writing plan and mode is on', () => {
    setupFeature('feature-c');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    const planContent = '# My Plan\n\nSome content here';
    service.write('feature-c', planContent);

    expect(mockRepo.descriptions).toEqual([{ beadId: 'epic-1', content: planContent }]);
  });

  it('skips epic description update when writing plan and mode is off', () => {
    setupFeature('feature-d');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'off', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    service.write('feature-d', '# My Plan');

    expect(mockRepo.descriptions).toEqual([]);
  });

  it('adds bead comment when adding comment and mode is on', () => {
    setupFeature('feature-e');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.addComment('feature-e', {
      line: 5,
      body: 'This needs clarification',
      author: 'test-user',
    });

    expect(mockRepo.appendedComments.length).toBe(1);
    expect(mockRepo.appendedComments[0].beadId).toBe('epic-1');
    expect(mockRepo.appendedComments[0].comment).toContain('[test-user]');
    expect(mockRepo.appendedComments[0].comment).toContain('Line 5:');
    expect(mockRepo.appendedComments[0].comment).toContain('This needs clarification');
  });

  it('skips bead comment when adding comment and mode is off', () => {
    setupFeature('feature-f');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'off', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    service.addComment('feature-f', {
      line: 3,
      body: 'Test comment',
      author: 'test-user',
    });

    expect(mockRepo.appendedComments).toEqual([]);
  });

  it('addComment() generates unique comment-prefixed IDs', () => {
    setupFeature('feature-comment-ids');
    const stores = createStores(testRoot, 'off', new MockBeadsRepository() as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    const first = service.addComment('feature-comment-ids', {
      line: 1,
      body: 'first',
      author: 'test-user',
    });
    const second = service.addComment('feature-comment-ids', {
      line: 2,
      body: 'second',
      author: 'test-user',
    });

    expect(first.id).toMatch(/^comment-/);
    expect(second.id).toMatch(/^comment-/);
    expect(first.id).not.toBe(second.id);
  });

  it('clearComments() in off mode updates canonical feature.json only', () => {
    const featureName = 'feature-clear-comments-off';
    const docsFeaturePath = path.join(testRoot, 'docs', featureName);
    const beadsFeaturePath = path.join(testRoot, '.beads', 'artifacts', featureName);

    fs.mkdirSync(docsFeaturePath, { recursive: true });
    fs.mkdirSync(beadsFeaturePath, { recursive: true });

    fs.writeFileSync(
      path.join(docsFeaturePath, 'feature.json'),
      JSON.stringify(
        {
          name: featureName,
          status: 'planning',
          createdAt: new Date().toISOString(),
          planComments: [
            {
              id: 'docs-comment-1',
              line: 4,
              body: 'Docs comment',
              author: 'tester',
              timestamp: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    );

    fs.writeFileSync(
      path.join(beadsFeaturePath, 'feature.json'),
      JSON.stringify(
        {
          name: featureName,
          status: 'planning',
          createdAt: new Date().toISOString(),
          planComments: [
            {
              id: 'beads-comment-1',
              line: 6,
              body: 'Beads comment',
              author: 'tester',
              timestamp: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
    );

    const stores = createStores(testRoot, 'off', new MockBeadsRepository() as any);
    const service = new PlanService(testRoot, stores.planStore, 'off');

    service.clearComments(featureName);

    const docsFeature = JSON.parse(fs.readFileSync(path.join(docsFeaturePath, 'feature.json'), 'utf-8'));
    const beadsFeature = JSON.parse(fs.readFileSync(path.join(beadsFeaturePath, 'feature.json'), 'utf-8'));

    expect(beadsFeature.planComments).toHaveLength(1);
    expect(beadsFeature.planComments[0].id).toBe('beads-comment-1');
    expect(docsFeature.planComments).toEqual([]);
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
    expect(feature.planApprovalHash).toMatch(/^[a-f0-9]{64}$/);
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

  it('isApproved() returns false for legacy feature.json without stored approval hash', () => {
    setupFeatureWithPlan('feature-legacy', '# Legacy Plan\n\nOld content');
    const featureJsonPath = path.join(testRoot, 'docs', 'feature-legacy', 'feature.json');
    const feature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    feature.status = 'approved';
    feature.approvedAt = '2024-01-15T10:30:00.000Z';
    delete feature.planApprovalHash;
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

  it('approve() stores approval in bead artifact with hash', () => {
    setupFeatureWithPlan('bead-approve-test', '# My Plan\n\nContent');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-approve-test', 'session-123');

    const approval = mockRepo.getStoredApproval('epic-1');
    expect(approval).toBeDefined();
    expect(approval!.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(approval!.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(approval!.approvedBySession).toBe('session-123');
  });

  it('isApproved() returns true when bead artifact hash matches current plan', () => {
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

  it('isApproved() returns false in on mode when approval artifact does not exist', () => {
    setupFeatureWithPlan('bead-no-artifact', '# Plan\n\nContent');
    const stores = createStores(testRoot, 'on', new MockBeadsRepository() as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');
    expect(service.isApproved('bead-no-artifact')).toBe(false);
  });

  it('revokeApproval() removes approval from bead artifact', () => {
    setupFeatureWithPlan('bead-revoke', '# Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-revoke');
    expect(service.isApproved('bead-revoke')).toBe(true);

    service.revokeApproval('bead-revoke');

    expect(service.isApproved('bead-revoke')).toBe(false);
    // After revoke, approval has empty hash (invalid)
    const approval = mockRepo.getStoredApproval('epic-1');
    expect(approval?.hash).toBe('');
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

  it('approve() without sessionId omits approvedBySession field', () => {
    setupFeatureWithPlan('bead-no-session', '# Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-no-session');

    const approval = mockRepo.getStoredApproval('epic-1');
    expect(approval!.approvedBySession).toBeUndefined();
    expect(approval!.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(approval!.approvedAt).toBeDefined();
  });

  it('approve() stores full plan content as approved_plan artifact', () => {
    const planContent = '# My Plan\n\nSome detailed content here\n\n- Task 1\n- Task 2';
    setupFeatureWithPlan('bead-approved-plan', planContent);
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-approved-plan', 'session-456');

    const approvedPlan = mockRepo.getStoredApprovedPlan('epic-1');
    expect(approvedPlan).toBeDefined();
    expect(approvedPlan).toBe(planContent);
  });

  it('revokeApproval() removes both plan_approval and approved_plan artifacts', () => {
    const planContent = '# My Plan\n\nContent';
    setupFeatureWithPlan('bead-revoke-plan', planContent);
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-revoke-plan');
    expect(mockRepo.getStoredApproval('epic-1')).toBeDefined();
    expect(mockRepo.getStoredApprovedPlan('epic-1')).toBeDefined();

    service.revokeApproval('bead-revoke-plan');

    // After revoke, approval has empty hash and approved plan is empty
    expect(mockRepo.getStoredApproval('epic-1')?.hash).toBe('');
    expect(mockRepo.getStoredApprovedPlan('epic-1')).toBe('');
  });

  it('write() invalidates both plan_approval and approved_plan artifacts when plan changes', () => {
    const originalContent = '# Original Plan';
    setupFeatureWithPlan('bead-write-invalidate-plan', originalContent);
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-write-invalidate-plan');
    expect(service.isApproved('bead-write-invalidate-plan')).toBe(true);
    expect(mockRepo.getStoredApprovedPlan('epic-1')).toBe(originalContent);

    // Write different content - this should revoke approval
    service.write('bead-write-invalidate-plan', '# Modified Plan');

    expect(service.isApproved('bead-write-invalidate-plan')).toBe(false);
    // The approved_plan artifact should have been cleared during revoke
  });

  it('isApproved() migrates legacy feature.json approval to bead artifact in on mode', () => {
    const planContent = '# Legacy Plan\n\nApproved before bead-native mode';
    setupFeatureWithPlan('bead-legacy-migrate', planContent);

    // Simulate legacy state: approval exists in feature.json but NOT in bead artifacts
    const featureJsonPath = path.join(testRoot, '.beads', 'artifacts', 'bead-legacy-migrate', 'feature.json');
    const feature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(planContent, 'utf-8').digest('hex');
    feature.status = 'approved';
    feature.approvedAt = '2024-06-15T10:00:00.000Z';
    feature.planApprovalHash = hash;
    fs.writeFileSync(featureJsonPath, JSON.stringify(feature, null, 2));

    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    // First call should detect legacy approval and migrate forward
    expect(service.isApproved('bead-legacy-migrate')).toBe(true);

    // Verify migration: repository should now contain approval data
    const approval = mockRepo.getStoredApproval('epic-1');
    expect(approval).toBeDefined();
    expect(approval!.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(approval!.approvedAt).toBe('2024-06-15T10:00:00.000Z');

    // Approved plan snapshot should also be migrated
    const approvedPlan = mockRepo.getStoredApprovedPlan('epic-1');
    expect(approvedPlan).toBe(planContent);
  });

  it('isApproved() returns false for legacy feature.json with hash mismatch in on mode', () => {
    const planContent = '# Plan\n\nOriginal';
    setupFeatureWithPlan('bead-legacy-mismatch', planContent);

    // Simulate legacy state with outdated hash
    const featureJsonPath = path.join(testRoot, '.beads', 'artifacts', 'bead-legacy-mismatch', 'feature.json');
    const feature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    feature.status = 'approved';
    feature.planApprovalHash = 'a'.repeat(64); // wrong hash
    fs.writeFileSync(featureJsonPath, JSON.stringify(feature, null, 2));

    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    expect(service.isApproved('bead-legacy-mismatch')).toBe(false);
    // Should not migrate invalid approval
    expect(mockRepo.getStoredApproval('epic-1')).toBeUndefined();
  });

  it('getComments() migrates legacy feature.json comments to bead artifact in on mode', () => {
    setupFeatureWithPlan('bead-legacy-comments', '# Plan');

    // Simulate legacy state: comments in feature.json but NOT in bead artifacts
    const featureJsonPath = path.join(testRoot, '.beads', 'artifacts', 'bead-legacy-comments', 'feature.json');
    const feature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    feature.planComments = [
      { id: 'c1', line: 3, body: 'Legacy comment', author: 'user', timestamp: '2024-06-15T10:00:00.000Z' },
    ];
    fs.writeFileSync(featureJsonPath, JSON.stringify(feature, null, 2));

    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    // First call should detect legacy comments and migrate forward
    const comments = service.getComments('bead-legacy-comments');
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe('Legacy comment');

    // Verify migration: repository should now contain comments
    const storedComments = mockRepo.getStoredComments('epic-1');
    expect(storedComments).toBeDefined();
    expect(storedComments).toHaveLength(1);
    expect(storedComments![0].body).toBe('Legacy comment');
  });

  it('approved_plan artifact contains exact plan content that was approved', () => {
    const planContent = `## Plan Overview

This is a detailed plan with:
- Multiple sections
- Code examples
- Tables

\`\`\`typescript
const x = 1;
\`\`\`

End of plan.`;
    setupFeatureWithPlan('bead-plan-exact', planContent);
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('bead-plan-exact');

    const approvedPlan = mockRepo.getStoredApprovedPlan('epic-1');
    expect(approvedPlan).toBe(planContent);
    // Verify exact match including whitespace and formatting
    expect(approvedPlan).toHaveLength(planContent.length);
  });
});

describe('PlanService on-mode feature state parity', () => {
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

  it('approve() sets feature state to approved in on-mode (parity with off-mode)', () => {
    setupFeatureWithPlan('on-approve-state', '# Plan\n\nContent');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('on-approve-state', 'session-abc');

    // Feature state artifact should be set to 'approved'
    const featureState = mockRepo.getStoredFeatureState('epic-1');
    expect(featureState).toBeDefined();
    expect(featureState!.status).toBe('approved');
    expect(featureState!.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Local feature.json should also reflect 'approved'
    const featureJsonPath = path.join(testRoot, '.beads', 'artifacts', 'on-approve-state', 'feature.json');
    const localFeature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    expect(localFeature.status).toBe('approved');
    expect(localFeature.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(localFeature.planApprovalHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('revokeApproval() resets feature state to planning in on-mode (parity with off-mode)', () => {
    setupFeatureWithPlan('on-revoke-state', '# Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('on-revoke-state');

    // Verify approved state
    const beforeRevoke = mockRepo.getStoredFeatureState('epic-1');
    expect(beforeRevoke!.status).toBe('approved');

    service.revokeApproval('on-revoke-state');

    // Feature state should be reset to 'planning'
    const afterRevoke = mockRepo.getStoredFeatureState('epic-1');
    expect(afterRevoke!.status).toBe('planning');
    expect(afterRevoke!.approvedAt).toBeUndefined();

    // Local feature.json should also reflect 'planning'
    const featureJsonPath = path.join(testRoot, '.beads', 'artifacts', 'on-revoke-state', 'feature.json');
    const localFeature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    expect(localFeature.status).toBe('planning');
    expect(localFeature.approvedAt).toBeUndefined();
    expect(localFeature.planApprovalHash).toBeUndefined();
  });

  it('revokeApproval() does not add contradictory approved label in on-mode', () => {
    setupFeatureWithPlan('on-revoke-labels', '# Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('on-revoke-labels');
    const labelsAfterApprove = [...mockRepo.labels];

    service.revokeApproval('on-revoke-labels');

    // Revoke should NOT add any new labels (especially not a second 'approved')
    expect(mockRepo.labels).toEqual(labelsAfterApprove);
  });

  it('revokeApproval() is idempotent when feature is already planning in on-mode', () => {
    setupFeatureWithPlan('on-revoke-idempotent', '# Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    // Revoke without prior approval should not throw
    service.revokeApproval('on-revoke-idempotent');

    // Feature.json should still be 'planning'
    const featureJsonPath = path.join(testRoot, '.beads', 'artifacts', 'on-revoke-idempotent', 'feature.json');
    const localFeature = JSON.parse(fs.readFileSync(featureJsonPath, 'utf-8'));
    expect(localFeature.status).toBe('planning');
  });

  it('write() with changed content resets feature state from approved to planning in on-mode', () => {
    setupFeatureWithPlan('on-write-resets', '# Original Plan');
    const mockRepo = new MockBeadsRepository();
    const stores = createStores(testRoot, 'on', mockRepo as any);
    const service = new PlanService(testRoot, stores.planStore, 'on');

    service.approve('on-write-resets');
    expect(mockRepo.getStoredFeatureState('epic-1')!.status).toBe('approved');

    // Write changed content triggers revokeApproval
    service.write('on-write-resets', '# Modified Plan');

    const afterWrite = mockRepo.getStoredFeatureState('epic-1');
    expect(afterWrite!.status).toBe('planning');
    expect(afterWrite!.approvedAt).toBeUndefined();
  });
});
