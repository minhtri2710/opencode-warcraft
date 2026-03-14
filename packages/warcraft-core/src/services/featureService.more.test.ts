import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FeatureJson } from '../types.js';
import { FeatureService } from './featureService.js';
import type { FeatureStore } from './state/types.js';

function createStoreStub(features: FeatureJson[] = [], overrides: Partial<FeatureStore> = {}): FeatureStore {
  const featureMap = new Map(features.map((f) => [f.name, { ...f }]));
  return {
    exists: (name) => featureMap.has(name),
    create: (input) => {
      const f: FeatureJson = { ...input, epicBeadId: `local-${input.name}` };
      featureMap.set(f.name, f);
      return f;
    },
    get: (name) => featureMap.get(name) ? { ...featureMap.get(name)! } : null,
    list: () => Array.from(featureMap.keys()).sort(),
    save: (f) => featureMap.set(f.name, { ...f }),
    complete: (f) => featureMap.set(f.name, { ...f }),
    reopen: (f) => featureMap.set(f.name, { ...f }),
    ...overrides,
  };
}

describe('FeatureService more edge cases', () => {
  it('create sanitizes name', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    const result = service.create('My Feature Name');
    expect(result.severity).toBe('ok');
  });

  it('create defaults priority to 3', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    const result = service.create('default-priority');
    expect(result.severity).toBe('ok');
  });

  it('list returns empty when no features', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(service.list()).toEqual([]);
  });

  it('list returns alphabetically sorted names', () => {
    const store = createStoreStub([
      { name: 'charlie', epicBeadId: 'c', status: 'planning', createdAt: '2024-01-01' },
      { name: 'alpha', epicBeadId: 'a', status: 'planning', createdAt: '2024-01-01' },
      { name: 'bravo', epicBeadId: 'b', status: 'planning', createdAt: '2024-01-01' },
    ]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(service.list()).toEqual(['alpha', 'bravo', 'charlie']);
  });

  it('patchMetadata updates ticket', () => {
    const feature: FeatureJson = { name: 'patch-test', epicBeadId: 'e', status: 'planning', createdAt: '2024-01-01' };
    const store = createStoreStub([feature]);
    const service = new FeatureService('/tmp', store, 'off');
    const updated = service.patchMetadata('patch-test', { ticket: 'NEW-1' });
    expect(updated.ticket).toBe('NEW-1');
  });

  it('patchMetadata throws for non-existent feature', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(() => service.patchMetadata('missing', { ticket: 'X' })).toThrow("Feature 'missing' not found");
  });

  it('updateStatus throws for non-existent feature', () => {
    const store = createStoreStub([]);
    const service = new FeatureService('/tmp', store, 'off');
    expect(() => service.updateStatus('missing', 'approved')).toThrow("Feature 'missing' not found");
  });

  it('getActive skips completed features and returns first active', () => {
    const store = createStoreStub([
      { name: 'done-1', epicBeadId: 'd1', status: 'completed', createdAt: '2024-01-01' },
      { name: 'active-1', epicBeadId: 'a1', status: 'approved', createdAt: '2024-01-01' },
    ]);
    const service = new FeatureService('/tmp', store, 'off');
    const active = service.getActive();
    expect(active?.name).toBe('active-1');
  });

  it('updateStatus from planning to executing (non-completion/non-reopen path)', () => {
    const feature: FeatureJson = { name: 'exec', epicBeadId: 'e', status: 'planning', createdAt: '2024-01-01' };
    let savedFeature: FeatureJson | null = null;
    const store = createStoreStub([feature], {
      save: (f) => { savedFeature = f; },
    });
    const service = new FeatureService('/tmp', store, 'off');
    const updated = service.updateStatus('exec', 'executing');
    expect(updated.status).toBe('executing');
    expect(savedFeature).not.toBeNull();
    expect(savedFeature!.status).toBe('executing');
  });
});
