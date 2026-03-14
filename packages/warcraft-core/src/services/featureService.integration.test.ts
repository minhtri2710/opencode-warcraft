import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getWarcraftPath } from '../utils/paths.js';
import { FeatureService } from './featureService.js';
import { FilesystemFeatureStore } from './state/fs-feature-store.js';

describe('FeatureService integration', () => {
  let tempDir: string;
  let service: FeatureService;
  let store: FilesystemFeatureStore;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-int-'));
    store = new FilesystemFeatureStore(tempDir);
    service = new FeatureService(tempDir, store, 'off');
    const warcraftDir = getWarcraftPath(tempDir, 'off');
    fs.mkdirSync(warcraftDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('create returns ok with feature', () => {
    const result = service.create('my-feature');
    expect(result.severity).toBe('ok');
    if (result.severity === 'ok') {
      expect(result.value.name).toBe('my-feature');
      expect(result.value.status).toBe('planning');
      expect(result.value.createdAt).toBeDefined();
    }
  });

  it('create duplicate returns fatal', () => {
    service.create('dup-feat');
    const result = service.create('dup-feat');
    expect(result.severity).toBe('fatal');
  });

  it('create with invalid priority returns fatal', () => {
    const result = service.create('bad-priority', undefined, 0);
    expect(result.severity).toBe('fatal');
  });

  it('create with ticket stores it', () => {
    const result = service.create('ticketed', 'JIRA-123');
    if (result.severity === 'ok') {
      expect(result.value.ticket).toBe('JIRA-123');
    }
  });

  it('get returns created feature', () => {
    service.create('feat');
    const feature = service.get('feat');
    expect(feature).not.toBeNull();
    expect(feature!.name).toBe('feat');
  });

  it('get returns null for nonexistent', () => {
    expect(service.get('ghost')).toBeNull();
  });

  it('list includes created features', () => {
    service.create('feat-a');
    service.create('feat-b');
    const list = service.list();
    expect(list).toContain('feat-a');
    expect(list).toContain('feat-b');
  });

  it('getActive returns first non-completed feature', () => {
    service.create('active-feat');
    const active = service.getActive();
    expect(active).not.toBeNull();
    expect(active!.name).toBe('active-feat');
  });

  it('getActive returns null when all completed', () => {
    service.create('done-feat');
    service.updateStatus('done-feat', 'completed');
    const active = service.getActive();
    expect(active).toBeNull();
  });

  it('updateStatus changes status', () => {
    service.create('feat');
    const updated = service.updateStatus('feat', 'executing');
    expect(updated.status).toBe('executing');
  });

  it('updateStatus to completed adds completedAt', () => {
    service.create('feat');
    const completed = service.updateStatus('feat', 'completed');
    expect(completed.completedAt).toBeDefined();
  });

  it('complete returns ok', () => {
    service.create('feat');
    const result = service.complete('feat');
    expect(result.severity).toBe('ok');
  });

  it('complete already completed returns fatal', () => {
    service.create('feat');
    service.complete('feat');
    const result = service.complete('feat');
    expect(result.severity).toBe('fatal');
  });

  it('complete nonexistent returns fatal', () => {
    const result = service.complete('ghost');
    expect(result.severity).toBe('fatal');
  });

  it('reopen completed feature via updateStatus', () => {
    service.create('feat');
    service.updateStatus('feat', 'completed');
    const reopened = service.updateStatus('feat', 'executing');
    expect(reopened.status).toBe('executing');
    expect(reopened.completedAt).toBeUndefined();
  });

  it('setSession and getSession round-trip', () => {
    service.create('feat');
    service.setSession('feat', 'sess-abc');
    expect(service.getSession('feat')).toBe('sess-abc');
  });

  it('getInfo with no tasks', () => {
    service.create('feat');
    const info = service.getInfo('feat');
    expect(info).not.toBeNull();
    expect(info!.name).toBe('feat');
    expect(info!.tasks).toEqual([]);
    expect(info!.hasPlan).toBe(false);
  });

  it('patchMetadata updates mutable fields', () => {
    service.create('feat');
    const patched = service.patchMetadata('feat', { ticket: 'NEW-456' });
    expect(patched.ticket).toBe('NEW-456');
  });

  it('patchMetadata ignores immutable fields', () => {
    service.create('feat');
    const patched = service.patchMetadata('feat', { name: 'different' } as any);
    expect(patched.name).toBe('feat');
  });
});
