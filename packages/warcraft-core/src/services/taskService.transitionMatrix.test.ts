import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createNoopLogger } from '../utils/logger.js';
import { getPlanPath, getWarcraftPath } from '../utils/paths.js';
import { FilesystemTaskStore } from './state/fs-task-store.js';
import { TaskService } from './taskService.js';

describe('TaskService status transition matrix via update', () => {
  let tempDir: string;
  let store: FilesystemTaskStore;
  const ALL_STATUSES = [
    'pending',
    'in_progress',
    'dispatch_prepared',
    'done',
    'cancelled',
    'blocked',
    'failed',
    'partial',
  ] as const;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-trans-mx-'));
    store = new FilesystemTaskStore(tempDir);
    fs.mkdirSync(getWarcraftPath(tempDir, 'off'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Non-strict mode allows all transitions
  for (const fromStatus of ALL_STATUSES) {
    for (const toStatus of ALL_STATUSES) {
      it(`${fromStatus} → ${toStatus} (non-strict)`, () => {
        const service = new TaskService(tempDir, store, 'off', createNoopLogger());
        const folder = service.create('feat', `task-${fromStatus}-${toStatus}`);

        // Set to fromStatus first (if not pending)
        if (fromStatus !== 'pending') {
          service.update('feat', folder, { status: fromStatus });
        }

        // Transition to toStatus
        const updated = service.update('feat', folder, { status: toStatus });
        expect(updated.status).toBe(toStatus);
      });
    }
  }
});
