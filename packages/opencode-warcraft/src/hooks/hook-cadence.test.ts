import { describe, expect, it, spyOn } from 'bun:test';
import { ConfigService } from 'warcraft-core';
import { createHookCadenceTracker } from './hook-cadence.js';

describe('Hook cadence system', () => {
  it('fires every turn when cadence is 1 (default)', () => {
    const tracker = createHookCadenceTracker();
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(1);

    for (let i = 0; i < 5; i++) {
      expect(tracker.shouldExecuteHook('test.hook', configService)).toBe(true);
    }
  });

  it('fires on turns 1, 4, 7, 10 when cadence is 3', () => {
    const tracker = createHookCadenceTracker();
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(3);

    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(tracker.shouldExecuteHook('test.hook', configService));
    }
    expect(results).toEqual([true, false, false, true, false, false, true, false, false, true]);
  });

  it('fires every turn when cadence is 1 explicitly', () => {
    const tracker = createHookCadenceTracker();
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(1);

    const results: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(tracker.shouldExecuteHook('test.hook', configService));
    }
    expect(results).toEqual([true, true, true]);
  });

  it('fires every turn for safety-critical hooks', () => {
    const tracker = createHookCadenceTracker();
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(1);

    for (let i = 0; i < 5; i++) {
      expect(tracker.shouldExecuteHook('test.hook', configService, { safetyCritical: true })).toBe(true);
    }
  });

  it('tracks independent counters per hook name', () => {
    const tracker = createHookCadenceTracker();
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(2);

    expect(tracker.shouldExecuteHook('hookA', configService)).toBe(true);
    expect(tracker.shouldExecuteHook('hookB', configService)).toBe(true);
    expect(tracker.shouldExecuteHook('hookA', configService)).toBe(false);
    expect(tracker.shouldExecuteHook('hookB', configService)).toBe(false);
    expect(tracker.shouldExecuteHook('hookA', configService)).toBe(true);
  });

  it('reset works per tracker instance', () => {
    const tracker = createHookCadenceTracker();
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(3);

    tracker.shouldExecuteHook('test.hook', configService);
    tracker.shouldExecuteHook('test.hook', configService);
    tracker.reset();

    expect(tracker.shouldExecuteHook('test.hook', configService)).toBe(true);
  });

  it('keeps tracker instances isolated from each other', () => {
    const trackerA = createHookCadenceTracker();
    const trackerB = createHookCadenceTracker();
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(3);

    expect(trackerA.shouldExecuteHook('test.hook', configService)).toBe(true);
    expect(trackerA.shouldExecuteHook('test.hook', configService)).toBe(false);
    expect(trackerB.shouldExecuteHook('test.hook', configService)).toBe(true);
  });

  it('evicts the least-recently-used counter instead of clearing all counters', () => {
    const tracker = createHookCadenceTracker();
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(3);
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    expect(tracker.shouldExecuteHook('hook-0', configService)).toBe(true);
    for (let i = 1; i < 100; i++) {
      tracker.shouldExecuteHook(`hook-${i}`, configService);
    }
    expect(tracker.shouldExecuteHook('hook-0', configService)).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();

    tracker.shouldExecuteHook('hook-overflow', configService);
    expect(warnSpy).toHaveBeenCalledWith('[warcraft] hookCounters exceeded max size, evicting oldest entry: hook-1');

    expect(tracker.shouldExecuteHook('hook-0', configService)).toBe(false);
    expect(tracker.shouldExecuteHook('hook-1', configService)).toBe(true);

    warnSpy.mockRestore();
  });
});
