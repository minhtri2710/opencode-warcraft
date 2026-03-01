import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Test the updateJsonLockedSync function by importing from warcraft-core
import { updateJsonLockedSync } from 'warcraft-core';

describe('metadata update with atomic locking', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metadata-update-test-'));
  });

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('updateJsonLockedSync creates file with fallback when not exists', () => {
    const filePath = path.join(tempDir, 'test.json');
    const fallback = { version: 1, count: 0 };

    const result = updateJsonLockedSync(filePath, (current) => ({ ...current, count: current.count + 1 }), fallback);

    expect(result).toEqual({ version: 1, count: 1 });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ version: 1, count: 1 });
  });

  test('updateJsonLockedSync applies updater to existing data', () => {
    const filePath = path.join(tempDir, 'test.json');
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, count: 5 }));

    const result = updateJsonLockedSync(filePath, (current) => ({ ...current, count: current.count + 1 }), {
      version: 1,
      count: 0,
    });

    expect(result).toEqual({ version: 1, count: 6 });
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ version: 1, count: 6 });
  });

  test('concurrent updates do not lose data', async () => {
    const filePath = path.join(tempDir, 'concurrent.json');
    const initial = { counter: 0, updates: [] as number[] };

    // Create initial file
    fs.writeFileSync(filePath, JSON.stringify(initial));

    // Spawn multiple concurrent updaters
    const workerCount = 10;
    const updatesPerWorker = 5;
    const promises: Promise<void>[] = [];

    for (let worker = 0; worker < workerCount; worker++) {
      promises.push(
        new Promise((resolve) => {
          // Each worker updates multiple times
          for (let i = 0; i < updatesPerWorker; i++) {
            updateJsonLockedSync(
              filePath,
              (current) => ({
                counter: current.counter + 1,
                updates: [...current.updates, worker],
              }),
              initial,
            );
          }
          resolve();
        }),
      );
    }

    await Promise.all(promises);

    const final = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Counter should reflect all updates (no lost updates)
    expect(final.counter).toBe(workerCount * updatesPerWorker);
    expect(final.updates.length).toBe(workerCount * updatesPerWorker);
  });

  test('updateJsonLockedSync handles errors gracefully', () => {
    const filePath = path.join(tempDir, 'error.json');
    fs.writeFileSync(filePath, JSON.stringify({ valid: true }));

    // Updater throws an error
    expect(() => {
      updateJsonLockedSync(
        filePath,
        () => {
          throw new Error('Updater error');
        },
        { valid: false },
      );
    }).toThrow('Updater error');

    // Original file should remain unchanged (atomic failure)
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ valid: true });
  });

  test('returns updated data from updater function', () => {
    const filePath = path.join(tempDir, 'return.json');

    const result = updateJsonLockedSync(
      filePath,
      (current) => {
        const next = { ...current, value: (current.value || 0) + 10 };
        return next;
      },
      { value: 0 },
    );

    expect(result).toEqual({ value: 10 });
  });
});
