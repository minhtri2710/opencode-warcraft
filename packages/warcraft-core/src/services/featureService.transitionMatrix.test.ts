import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { FeatureStatusType } from '../types.js';
import { getWarcraftPath } from '../utils/paths.js';
import { FeatureService } from './featureService.js';
import { FilesystemFeatureStore } from './state/fs-feature-store.js';

describe('FeatureService status transition matrix', () => {
  let tempDir: string;
  let store: FilesystemFeatureStore;
  const ALL_STATUSES: FeatureStatusType[] = ['planning', 'approved', 'executing', 'completed'];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-trans-'));
    store = new FilesystemFeatureStore(tempDir);
    fs.mkdirSync(getWarcraftPath(tempDir, 'off'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  for (const fromStatus of ALL_STATUSES) {
    for (const toStatus of ALL_STATUSES) {
      it(`${fromStatus} → ${toStatus}`, () => {
        const service = new FeatureService(tempDir, store, 'off');
        const name = `feat-${fromStatus}-${toStatus}`;
        service.create(name);

        // Set initial status
        if (fromStatus !== 'planning') {
          service.updateStatus(name, fromStatus);
        }

        // Transition
        const updated = service.updateStatus(name, toStatus);
        expect(updated.status).toBe(toStatus);
      });
    }
  }
});
