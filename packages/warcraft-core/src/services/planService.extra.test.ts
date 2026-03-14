import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlanService } from './planService.js';
import type { PlanStore } from './state/types.js';

function createMockPlanStore(overrides: Partial<PlanStore> = {}): PlanStore {
  let approved = false;
  let approvedContent = '';
  return {
    approve: (_f, content) => {
      approved = true;
      approvedContent = content;
    },
    isApproved: (_f, content) => approved && content === approvedContent,
    revokeApproval: () => { approved = false; approvedContent = ''; },
    syncPlanDescription: () => {},
    ...overrides,
  };
}

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-service-extra-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function setupPlan(featureName: string, content: string): void {
  const featurePath = path.join(tempDir, 'docs', featureName);
  fs.mkdirSync(featurePath, { recursive: true });
  fs.writeFileSync(path.join(featurePath, 'plan.md'), content);
}

describe('PlanService extra edge cases', () => {
  describe('read()', () => {
    it('returns null when plan does not exist', () => {
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      expect(service.read('missing-feature')).toBeNull();
    });

    it('returns content with status planning when not approved', () => {
      setupPlan('read-test', '# My Plan');
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      const result = service.read('read-test');
      expect(result).not.toBeNull();
      expect(result!.content).toBe('# My Plan');
      expect(result!.status).toBe('planning');
    });

    it('returns content with status approved when approved', () => {
      setupPlan('read-approved', '# My Plan');
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      service.approve('read-approved');
      const result = service.read('read-approved');
      expect(result!.status).toBe('approved');
    });
  });

  describe('write()', () => {
    it('creates plan file and returns path', () => {
      fs.mkdirSync(path.join(tempDir, 'docs', 'write-test'), { recursive: true });
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      const planPath = service.write('write-test', '# New Plan');
      expect(planPath).toContain('write-test');
      expect(planPath).toContain('plan.md');
      expect(fs.readFileSync(planPath, 'utf-8')).toBe('# New Plan');
    });

    it('invalidates approval when content changes', () => {
      setupPlan('write-invalidate', '# Original');
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      service.approve('write-invalidate');
      expect(service.isApproved('write-invalidate')).toBe(true);

      service.write('write-invalidate', '# Changed');
      expect(service.isApproved('write-invalidate')).toBe(false);
    });

    it('does not invalidate approval when content is same', () => {
      setupPlan('write-same', '# Same Content');
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      service.approve('write-same');
      expect(service.isApproved('write-same')).toBe(true);

      service.write('write-same', '# Same Content');
      expect(service.isApproved('write-same')).toBe(true);
    });

    it('calls syncPlanDescription on write', () => {
      let synced = false;
      const store = createMockPlanStore({
        syncPlanDescription: () => { synced = true; },
      });
      fs.mkdirSync(path.join(tempDir, 'docs', 'sync-test'), { recursive: true });
      const service = new PlanService(tempDir, store, 'off');
      service.write('sync-test', '# Plan');
      expect(synced).toBe(true);
    });
  });

  describe('approve()', () => {
    it('returns fatal when plan file does not exist', () => {
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      const result = service.approve('no-plan');
      expect(result.severity).toBe('fatal');
      expect(result.diagnostics[0].code).toBe('plan_not_found');
    });

    it('returns ok when plan exists', () => {
      setupPlan('approve-ok', '# Plan Content');
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      const result = service.approve('approve-ok');
      expect(result.severity).toBe('ok');
    });

    it('accepts preloaded content and skips file read', () => {
      // No plan file exists, but preloaded content is provided
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      const result = service.approve('no-file', undefined, '# Preloaded Plan');
      expect(result.severity).toBe('ok');
    });
  });

  describe('isApproved()', () => {
    it('returns false when plan file does not exist', () => {
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      expect(service.isApproved('missing')).toBe(false);
    });

    it('returns true after approval', () => {
      setupPlan('is-approved', '# Plan');
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      service.approve('is-approved');
      expect(service.isApproved('is-approved')).toBe(true);
    });

    it('returns false after revocation', () => {
      setupPlan('revoke-test', '# Plan');
      const store = createMockPlanStore();
      const service = new PlanService(tempDir, store, 'off');
      service.approve('revoke-test');
      service.revokeApproval('revoke-test');
      expect(service.isApproved('revoke-test')).toBe(false);
    });
  });
});
