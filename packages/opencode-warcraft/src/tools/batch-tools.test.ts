import { describe, expect, test } from 'bun:test';
import {
  mapWithConcurrencyLimit,
  resolveParallelPolicy,
} from './batch-tools.js';

describe('batch-tools parallel helpers', () => {
  test('resolveParallelPolicy defaults to unbounded', () => {
    expect(resolveParallelPolicy(undefined)).toEqual({
      strategy: 'unbounded',
      maxConcurrency: 4,
    });
  });

  test('resolveParallelPolicy clamps maxConcurrency', () => {
    expect(resolveParallelPolicy({ strategy: 'bounded', maxConcurrency: 0 })).toEqual({
      strategy: 'bounded',
      maxConcurrency: 1,
    });
    expect(resolveParallelPolicy({ strategy: 'bounded', maxConcurrency: 99 })).toEqual({
      strategy: 'bounded',
      maxConcurrency: 32,
    });
  });

  test('mapWithConcurrencyLimit enforces bounded parallelism', async () => {
    const items = [1, 2, 3, 4, 5];
    let inFlight = 0;
    let peak = 0;

    const results = await mapWithConcurrencyLimit(items, 2, async (item) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return item * 2;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });
});
