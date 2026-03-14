import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FilesystemFeatureStore } from './fs-feature-store.js';

describe('FilesystemFeatureStore lifecycle', () => {
  let tempDir: string;
  let store: FilesystemFeatureStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-store-lc-'));
    store = new FilesystemFeatureStore(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('create and get round-trip', () => {
    store.create({ name: 'feat', status: 'planning', createdAt: new Date().toISOString() });
    const feat = store.get('feat');
    expect(feat).not.toBeNull();
    expect(feat!.name).toBe('feat');
    expect(feat!.status).toBe('planning');
  });

  it('list returns created features', () => {
    store.create({ name: 'a', status: 'planning', createdAt: new Date().toISOString() });
    store.create({ name: 'b', status: 'planning', createdAt: new Date().toISOString() });
    const list = store.list();
    expect(list).toContain('a');
    expect(list).toContain('b');
  });

  it('exists returns true for created', () => {
    store.create({ name: 'exists-feat', status: 'planning', createdAt: new Date().toISOString() });
    expect(store.exists('exists-feat')).toBe(true);
  });

  it('exists returns false for missing', () => {
    expect(store.exists('ghost')).toBe(false);
  });

  it('save updates feature', () => {
    store.create({ name: 'upd', status: 'planning', createdAt: new Date().toISOString() });
    store.save({ name: 'upd', status: 'executing', createdAt: new Date().toISOString() });
    const feat = store.get('upd');
    expect(feat!.status).toBe('executing');
  });

  it('complete marks feature', () => {
    const feat = {
      name: 'comp',
      status: 'completed' as const,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    store.create({ name: 'comp', status: 'planning', createdAt: new Date().toISOString() });
    store.complete(feat);
    const got = store.get('comp');
    expect(got!.status).toBe('completed');
  });

  it('reopen reopens completed feature', () => {
    store.create({ name: 'reop', status: 'planning', createdAt: new Date().toISOString() });
    store.complete({
      name: 'reop',
      status: 'completed',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    store.reopen({ name: 'reop', status: 'executing', createdAt: new Date().toISOString() });
    const got = store.get('reop');
    expect(got!.status).toBe('executing');
  });

  it('create with priority', () => {
    store.create({ name: 'pri', status: 'planning', createdAt: new Date().toISOString() }, 5);
    expect(store.get('pri')).not.toBeNull();
  });

  it('create with ticket', () => {
    store.create({ name: 'tkt', status: 'planning', createdAt: new Date().toISOString(), ticket: 'JIRA-1' });
    expect(store.get('tkt')!.ticket).toBe('JIRA-1');
  });
});
