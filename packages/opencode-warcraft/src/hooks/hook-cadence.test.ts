import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { ConfigService } from 'warcraft-core';
import { resetHookCounters, shouldExecuteHook } from './hook-cadence.js';

afterEach(() => {
  resetHookCounters();
});

describe('Hook cadence system', () => {
  it('fires every turn when cadence is 1 (default)', () => {
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(1);

    for (let i = 0; i < 5; i++) {
      expect(shouldExecuteHook('test.hook', configService)).toBe(true);
    }
  });

  it('fires on turns 1, 4, 7, 10 when cadence is 3', () => {
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(3);

    const results: boolean[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(shouldExecuteHook('test.hook', configService));
    }
    // Turn 1=true, 2=false, 3=false, 4=true, 5=false, 6=false, 7=true, 8=false, 9=false, 10=true
    expect(results).toEqual([true, false, false, true, false, false, true, false, false, true]);
  });

  it('fires every turn when cadence is 1 explicitly', () => {
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(1);

    const results: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      results.push(shouldExecuteHook('test.hook', configService));
    }
    expect(results).toEqual([true, true, true]);
  });

  it('fires every turn for safety-critical hooks', () => {
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(1);

    for (let i = 0; i < 5; i++) {
      expect(shouldExecuteHook('test.hook', configService, { safetyCritical: true })).toBe(true);
    }
  });

  it('tracks independent counters per hook name', () => {
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(2);

    // Hook A: turn 1 (true), turn 2 (true)
    expect(shouldExecuteHook('hookA', configService)).toBe(true);
    // Hook B: turn 1 (true)
    expect(shouldExecuteHook('hookB', configService)).toBe(true);
    // Hook A: turn 2 (false for cadence 2)
    expect(shouldExecuteHook('hookA', configService)).toBe(false);
    // Hook B: turn 2 (false for cadence 2)
    expect(shouldExecuteHook('hookB', configService)).toBe(false);
    // Hook A: turn 3 (true for cadence 2)
    expect(shouldExecuteHook('hookA', configService)).toBe(true);
  });

  it('counter reset works', () => {
    const configService = new ConfigService();
    spyOn(configService, 'getHookCadence').mockReturnValue(3);

    shouldExecuteHook('test.hook', configService); // turn 1 - true
    shouldExecuteHook('test.hook', configService); // turn 2 - false
    resetHookCounters();
    expect(shouldExecuteHook('test.hook', configService)).toBe(true); // reset: turn 1 again
  });
});
