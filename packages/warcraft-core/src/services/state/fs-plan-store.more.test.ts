import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilesystemPlanStore } from './fs-plan-store.js';

describe('FilesystemPlanStore more edge cases', () => {
  let tempDir: string;
  let store: FilesystemPlanStore;
  const feature = 'test-feature';

  function writeFeature(data: Record<string, unknown>): void {
    const dir = path.join(tempDir, 'docs', feature);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'feature.json'), JSON.stringify(data));
  }

  function readFeature(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(tempDir, 'docs', feature, 'feature.json'), 'utf-8'));
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-plan-more-'));
    store = new FilesystemPlanStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('approve then isApproved round-trip', () => {
    writeFeature({ name: feature, status: 'planning' });
    const content = 'Plan content here';
    store.approve(feature, content, '2024-01-01T00:00:00Z');
    expect(store.isApproved(feature, content)).toBe(true);
  });

  it('different plan content produces different hash', () => {
    writeFeature({ name: feature, status: 'planning' });
    store.approve(feature, 'Content A', '2024-01-01T00:00:00Z');
    expect(store.isApproved(feature, 'Content A')).toBe(true);
    expect(store.isApproved(feature, 'Content B')).toBe(false);
  });

  it('approve overwrites previous approval', () => {
    writeFeature({ name: feature, status: 'planning' });
    store.approve(feature, 'First', '2024-01-01T00:00:00Z');
    store.approve(feature, 'Second', '2024-01-02T00:00:00Z');
    expect(store.isApproved(feature, 'First')).toBe(false);
    expect(store.isApproved(feature, 'Second')).toBe(true);
  });

  it('revokeApproval makes previously approved plan unapproved', () => {
    writeFeature({ name: feature, status: 'planning' });
    store.approve(feature, 'Plan', '2024-01-01T00:00:00Z');
    expect(store.isApproved(feature, 'Plan')).toBe(true);
    store.revokeApproval(feature);
    expect(store.isApproved(feature, 'Plan')).toBe(false);
  });

  it('approve preserves other feature.json fields', () => {
    writeFeature({ name: feature, status: 'planning', ticket: 'T-1', custom: 'value' });
    store.approve(feature, 'Plan', '2024-01-01T00:00:00Z');
    const data = readFeature();
    expect(data.ticket).toBe('T-1');
    expect(data.custom).toBe('value');
    expect(data.status).toBe('approved');
  });

  it('revokeApproval preserves other feature.json fields', () => {
    writeFeature({ name: feature, status: 'planning', ticket: 'T-2' });
    store.approve(feature, 'Plan', '2024-01-01T00:00:00Z');
    store.revokeApproval(feature);
    const data = readFeature();
    expect(data.ticket).toBe('T-2');
    expect(data.status).toBe('planning');
  });

  it('syncPlanDescription is a no-op', () => {
    // Should not throw or create files
    store.syncPlanDescription(feature, 'content');
    expect(fs.existsSync(path.join(tempDir, 'docs', feature))).toBe(false);
  });
});
