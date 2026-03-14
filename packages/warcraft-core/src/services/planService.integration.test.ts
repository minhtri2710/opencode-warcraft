import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { PlanService } from './planService.js';
import { FilesystemPlanStore } from './state/fs-plan-store.js';
import { FilesystemFeatureStore } from './state/fs-feature-store.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWarcraftPath, getPlanPath } from '../utils/paths.js';

describe('PlanService integration', () => {
  let tempDir: string;
  let service: PlanService;
  let planStore: FilesystemPlanStore;
  let featureStore: FilesystemFeatureStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-int-'));
    planStore = new FilesystemPlanStore(tempDir);
    featureStore = new FilesystemFeatureStore(tempDir);
    service = new PlanService(tempDir, planStore, 'off');
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createFeature(name: string) {
    featureStore.create({ name, status: 'planning', createdAt: new Date().toISOString() });
  }

  it('write then read returns content', () => {
    service.write('my-feature', '# Plan\n\nDo things');
    const result = service.read('my-feature');
    expect(result).not.toBeNull();
    expect(result!.content).toContain('Plan');
    expect(result!.status).toBe('planning');
  });

  it('read returns null for nonexistent plan', () => {
    expect(service.read('ghost')).toBeNull();
  });

  it('write creates plan.md file', () => {
    service.write('my-feature', '# Plan');
    const planPath = getPlanPath(tempDir, 'my-feature', 'off');
    expect(fs.existsSync(planPath)).toBe(true);
  });

  it('approve then read shows approved', () => {
    createFeature('feat');
    service.write('feat', '# Plan\n\nApproved plan');
    const approveResult = service.approve('feat');
    expect(approveResult.severity).toBe('ok');
    expect(service.isApproved('feat')).toBe(true);
    const plan = service.read('feat');
    expect(plan!.status).toBe('approved');
  });

  it('approve nonexistent plan returns fatal', () => {
    const result = service.approve('ghost');
    expect(result.severity).toBe('fatal');
  });

  it('modify plan after approval revokes approval', () => {
    createFeature('feat');
    service.write('feat', '# Original Plan');
    service.approve('feat');
    expect(service.isApproved('feat')).toBe(true);

    // Write different content - should revoke approval
    service.write('feat', '# Modified Plan');
    expect(service.isApproved('feat')).toBe(false);
  });

  it('rewrite identical content preserves approval', () => {
    createFeature('feat');
    const content = '# Same Plan';
    service.write('feat', content);
    service.approve('feat');
    expect(service.isApproved('feat')).toBe(true);

    // Write same content
    service.write('feat', content);
    expect(service.isApproved('feat')).toBe(true);
  });

  it('revokeApproval works', () => {
    createFeature('feat');
    service.write('feat', '# Plan');
    service.approve('feat');
    expect(service.isApproved('feat')).toBe(true);

    service.revokeApproval('feat');
    expect(service.isApproved('feat')).toBe(false);
  });

  it('isApproved returns false for nonexistent plan', () => {
    expect(service.isApproved('ghost')).toBe(false);
  });

  it('approve with sessionId works', () => {
    createFeature('feat');
    service.write('feat', '# Plan');
    const result = service.approve('feat', 'session-123');
    expect(result.severity).toBe('ok');
  });

  it('approve with preloadedContent skips file read', () => {
    createFeature('feat');
    service.write('feat', '# Plan');
    const result = service.approve('feat', undefined, '# Plan');
    expect(result.severity).toBe('ok');
  });
});
