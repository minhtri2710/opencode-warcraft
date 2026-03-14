import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PlanService } from './planService.js';
import type { PlanStore } from './state/types.js';

function createStore(overrides: Partial<PlanStore> = {}): PlanStore {
  let approved = false;
  let content = '';
  return {
    approve: (_f, c) => { approved = true; content = c; },
    isApproved: (_f, c) => approved && c === content,
    revokeApproval: () => { approved = false; },
    syncPlanDescription: () => {},
    ...overrides,
  };
}

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-more-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function setupPlan(name: string, content: string): void {
  const dir = path.join(tempDir, 'docs', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plan.md'), content);
}

describe('PlanService more integration', () => {
  it('write → approve → read returns approved status', () => {
    const store = createStore();
    const service = new PlanService(tempDir, store, 'off');
    fs.mkdirSync(path.join(tempDir, 'docs', 'feat'), { recursive: true });

    service.write('feat', '# Plan\n\nContent');
    service.approve('feat');

    const result = service.read('feat');
    expect(result?.status).toBe('approved');
    expect(result?.content).toBe('# Plan\n\nContent');
  });

  it('write → approve → write (different) → read returns planning', () => {
    const store = createStore();
    const service = new PlanService(tempDir, store, 'off');
    fs.mkdirSync(path.join(tempDir, 'docs', 'feat'), { recursive: true });

    service.write('feat', '# Original');
    service.approve('feat');
    service.write('feat', '# Modified');

    const result = service.read('feat');
    expect(result?.status).toBe('planning');
  });

  it('write → approve → write (same) → read returns approved', () => {
    const store = createStore();
    const service = new PlanService(tempDir, store, 'off');
    fs.mkdirSync(path.join(tempDir, 'docs', 'feat'), { recursive: true });

    service.write('feat', '# Same');
    service.approve('feat');
    service.write('feat', '# Same');

    const result = service.read('feat');
    expect(result?.status).toBe('approved');
  });

  it('approve with preloaded content does not require file', () => {
    const store = createStore();
    const service = new PlanService(tempDir, store, 'off');
    const outcome = service.approve('no-file-feat', undefined, '# Preloaded');
    expect(outcome.severity).toBe('ok');
  });

  it('revokeApproval makes isApproved return false', () => {
    setupPlan('revoke-feat', '# Plan');
    const store = createStore();
    const service = new PlanService(tempDir, store, 'off');
    service.approve('revoke-feat');
    expect(service.isApproved('revoke-feat')).toBe(true);
    service.revokeApproval('revoke-feat');
    expect(service.isApproved('revoke-feat')).toBe(false);
  });

  it('isApproved returns false for non-existent feature', () => {
    const store = createStore();
    const service = new PlanService(tempDir, store, 'off');
    expect(service.isApproved('ghost')).toBe(false);
  });

  it('read returns null for non-existent feature', () => {
    const store = createStore();
    const service = new PlanService(tempDir, store, 'off');
    expect(service.read('ghost')).toBeNull();
  });
});
