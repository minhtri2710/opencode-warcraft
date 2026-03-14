import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { TaskStatus } from '../../types.js';
import { FilesystemTaskStore } from './fs-task-store.js';

describe('FilesystemTaskStore', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-task-store-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('without BeadsRepository (off mode)', () => {
    it('should construct without a repository', () => {
      const store = new FilesystemTaskStore(tmpDir);
      expect(store).toBeDefined();
    });

    it('should create a task with a deterministic local ID when repository is absent', () => {
      const store = new FilesystemTaskStore(tmpDir);
      const status: TaskStatus = {
        status: 'pending',
        origin: 'plan',
        planTitle: 'Test task',
      };

      const result = store.createTask('my-feature', '01-setup', 'Setup', status, 3);

      expect(result.beadId).toBe('local-my-feature-01-setup');
      expect(result.status).toBe('pending');
    });

    it('should persist the task to filesystem when repository is absent', () => {
      const store = new FilesystemTaskStore(tmpDir);
      const status: TaskStatus = {
        status: 'pending',
        origin: 'plan',
      };

      store.createTask('my-feature', '01-setup', 'Setup', status, 3);
      const retrieved = store.get('my-feature', '01-setup');

      expect(retrieved).not.toBeNull();
      expect(retrieved!.folder).toBe('01-setup');
      expect(retrieved!.beadId).toBe('local-my-feature-01-setup');
    });

    it('should handle writeArtifact gracefully when repository is absent', () => {
      const store = new FilesystemTaskStore(tmpDir);
      const status: TaskStatus = {
        status: 'pending',
        origin: 'plan',
      };

      store.createTask('my-feature', '01-setup', 'Setup', status, 3);
      // writeArtifact should not throw, just return the folder as fallback
      const result = store.writeArtifact('my-feature', '01-setup', 'report', 'test content');
      expect(result).toBe('01-setup');
    });

    it('should handle readArtifact gracefully when repository is absent', () => {
      const store = new FilesystemTaskStore(tmpDir);
      const status: TaskStatus = {
        status: 'pending',
        origin: 'plan',
      };

      store.createTask('my-feature', '01-setup', 'Setup', status, 3);
      const result = store.readArtifact('my-feature', '01-setup', 'report');
      expect(result).toBeNull();
    });
  });

  describe('with BeadsRepository (on mode preserved)', () => {
    it('should still accept a repository parameter', () => {
      // Create a mock repository that throws (simulating unavailable beads)
      const mockRepository = {
        getEpicByFeatureName: () => ({ success: false }),
        createTask: () => ({ success: true, value: 'bead-123' }),
        upsertTaskArtifact: () => {},
        readTaskArtifact: () => ({ success: false }),
      } as any;

      const store = new FilesystemTaskStore(tmpDir, mockRepository);
      expect(store).toBeDefined();
    });

    it('should use repository for bead ID when available', () => {
      const mockRepository = {
        getEpicByFeatureName: () => ({ success: true, value: 'epic-abc' }),
        createTask: () => ({ success: true, value: 'bead-xyz-123' }),
        upsertTaskArtifact: () => {},
        readTaskArtifact: () => ({ success: false }),
      } as any;

      const store = new FilesystemTaskStore(tmpDir, mockRepository);
      const status: TaskStatus = {
        status: 'pending',
        origin: 'plan',
      };

      const result = store.createTask('my-feature', '01-setup', 'Setup', status, 3);
      expect(result.beadId).toBe('bead-xyz-123');
    });
  });

  describe('list and ordering', () => {
    it('list returns empty array for non-existent feature', () => {
      const store = new FilesystemTaskStore(tmpDir);
      expect(store.list('nonexistent')).toEqual([]);
    });

    it('list returns tasks sorted by folder name', () => {
      const store = new FilesystemTaskStore(tmpDir);
      const status: TaskStatus = { status: 'pending', origin: 'plan' };
      store.createTask('feat', '02-build', 'Build', status, 3);
      store.createTask('feat', '01-setup', 'Setup', status, 3);

      const tasks = store.list('feat');
      expect(tasks.length).toBe(2);
      expect(tasks[0].folder).toBe('01-setup');
      expect(tasks[1].folder).toBe('02-build');
    });

    it('getNextOrder returns 1 for empty feature', () => {
      const store = new FilesystemTaskStore(tmpDir);
      expect(store.getNextOrder('feat')).toBe(1);
    });

    it('getNextOrder returns max + 1', () => {
      const store = new FilesystemTaskStore(tmpDir);
      const status: TaskStatus = { status: 'pending', origin: 'plan' };
      store.createTask('feat', '01-setup', 'Setup', status, 3);
      store.createTask('feat', '03-deploy', 'Deploy', status, 3);

      expect(store.getNextOrder('feat')).toBe(4);
    });
  });

  describe('delete', () => {
    it('removes a task folder', () => {
      const store = new FilesystemTaskStore(tmpDir);
      const status: TaskStatus = { status: 'pending', origin: 'plan' };
      store.createTask('feat', '01-setup', 'Setup', status, 3);

      expect(store.get('feat', '01-setup')).not.toBeNull();
      store.delete('feat', '01-setup');
      expect(store.get('feat', '01-setup')).toBeNull();
    });

    it('does not throw for non-existent task', () => {
      const store = new FilesystemTaskStore(tmpDir);
      expect(() => store.delete('feat', '99-missing')).not.toThrow();
    });
  });

  describe('save', () => {
    it('updates an existing task status', () => {
      const store = new FilesystemTaskStore(tmpDir);
      const status: TaskStatus = { status: 'pending', origin: 'plan' };
      store.createTask('feat', '01-setup', 'Setup', status, 3);

      store.save('feat', '01-setup', { ...status, status: 'in_progress' });
      const raw = store.getRawStatus('feat', '01-setup');
      expect(raw?.status).toBe('in_progress');
    });
  });

  describe('writeReport', () => {
    it('writes report.md to task folder', () => {
      const store = new FilesystemTaskStore(tmpDir);
      const status: TaskStatus = { status: 'pending', origin: 'plan' };
      store.createTask('feat', '01-setup', 'Setup', status, 3);

      const reportPath = store.writeReport('feat', '01-setup', '# Report\n\nAll tests passed.');
      expect(fs.existsSync(reportPath)).toBe(true);
      expect(fs.readFileSync(reportPath, 'utf-8')).toContain('All tests passed.');
    });
  });

  describe('getRunnableTasks', () => {
    it('returns null (filesystem store defers to service layer)', () => {
      const store = new FilesystemTaskStore(tmpDir);
      expect(store.getRunnableTasks('feat')).toBeNull();
    });
  });

  describe('flush', () => {
    it('is a no-op that does not throw', () => {
      const store = new FilesystemTaskStore(tmpDir);
      expect(() => store.flush()).not.toThrow();
    });
  });
});
