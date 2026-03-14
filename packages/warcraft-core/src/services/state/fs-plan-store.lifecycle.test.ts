import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { FilesystemPlanStore } from './fs-plan-store.js';
import { FilesystemFeatureStore } from './fs-feature-store.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getPlanPath, getWarcraftPath } from '../../utils/paths.js';
import { writeText } from '../../utils/fs.js';

describe('FilesystemPlanStore lifecycle', () => {
  let tempDir: string;
  let store: FilesystemPlanStore;
  let featureStore: FilesystemFeatureStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-store-lc-'));
    store = new FilesystemPlanStore(tempDir);
    featureStore = new FilesystemFeatureStore(tempDir);
    fs.mkdirSync(getWarcraftPath(tempDir, 'off'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createFeatureWithPlan(name: string, plan: string) {
    featureStore.create({ name, status: 'planning', createdAt: new Date().toISOString() });
    const planPath = getPlanPath(tempDir, name, 'off');
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    writeText(planPath, plan);
  }

  it('isApproved false before approval', () => {
    createFeatureWithPlan('feat', '# Plan');
    expect(store.isApproved('feat', '# Plan')).toBe(false);
  });

  it('approve then isApproved true', () => {
    createFeatureWithPlan('feat', '# Plan');
    store.approve('feat', '# Plan', new Date().toISOString());
    expect(store.isApproved('feat', '# Plan')).toBe(true);
  });

  it('isApproved false with different content', () => {
    createFeatureWithPlan('feat', '# Plan');
    store.approve('feat', '# Plan', new Date().toISOString());
    expect(store.isApproved('feat', '# Plan Modified')).toBe(false);
  });

  it('revokeApproval works', () => {
    createFeatureWithPlan('feat', '# Plan');
    store.approve('feat', '# Plan', new Date().toISOString());
    store.revokeApproval('feat');
    expect(store.isApproved('feat', '# Plan')).toBe(false);
  });

  it('syncPlanDescription does not throw', () => {
    createFeatureWithPlan('feat', '# Plan');
    expect(() => store.syncPlanDescription('feat', '# Updated Plan')).not.toThrow();
  });

  it('approve with sessionId', () => {
    createFeatureWithPlan('feat', '# Plan');
    store.approve('feat', '# Plan', new Date().toISOString(), 'sess-123');
    expect(store.isApproved('feat', '# Plan')).toBe(true);
  });

  it('approve without feature.json is no-op', () => {
    // No feature created
    expect(() => store.approve('ghost', '# Plan', new Date().toISOString())).not.toThrow();
    expect(store.isApproved('ghost', '# Plan')).toBe(false);
  });

  it('hash changes after plan content changes', () => {
    createFeatureWithPlan('feat', '# Plan A');
    store.approve('feat', '# Plan A', new Date().toISOString());
    expect(store.isApproved('feat', '# Plan A')).toBe(true);
    expect(store.isApproved('feat', '# Plan B')).toBe(false);
  });

  it('re-approve after revoke', () => {
    createFeatureWithPlan('feat', '# Plan');
    store.approve('feat', '# Plan', new Date().toISOString());
    store.revokeApproval('feat');
    store.approve('feat', '# Plan', new Date().toISOString());
    expect(store.isApproved('feat', '# Plan')).toBe(true);
  });
});
