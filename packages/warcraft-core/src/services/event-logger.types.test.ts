import { describe, expect, it } from 'bun:test';
import type { WarcraftEvent } from './event-logger.js';
import { WARCRAFT_EVENT_TYPES, createEventLogger, createNoopEventLogger } from './event-logger.js';

describe('event-logger type system', () => {
  it('WARCRAFT_EVENT_TYPES has expected count', () => {
    expect(WARCRAFT_EVENT_TYPES).toHaveLength(13);
  });

  it('WARCRAFT_EVENT_TYPES includes verification_run', () => {
    expect(WARCRAFT_EVENT_TYPES).toContain('verification_run');
  });

  it('WARCRAFT_EVENT_TYPES is frozen (readonly)', () => {
    // Attempting to modify should not change the array
    const original = [...WARCRAFT_EVENT_TYPES];
    expect(WARCRAFT_EVENT_TYPES).toEqual(original);
  });

  it('event types are all lowercase strings', () => {
    for (const type of WARCRAFT_EVENT_TYPES) {
      expect(type).toBe(type.toLowerCase());
    }
  });

  it('event types have no duplicates', () => {
    const unique = new Set(WARCRAFT_EVENT_TYPES);
    expect(unique.size).toBe(WARCRAFT_EVENT_TYPES.length);
  });
});

describe('noopEventLogger', () => {
  it('has emit function', () => {
    const logger = createNoopEventLogger();
    expect(typeof logger.emit).toBe('function');
  });

  it('has getLatestTraceContext function', () => {
    const logger = createNoopEventLogger();
    expect(typeof logger.getLatestTraceContext).toBe('function');
  });

  it('emit does not throw for any event type', () => {
    const logger = createNoopEventLogger();
    for (const type of WARCRAFT_EVENT_TYPES) {
      expect(() => logger.emit({ type, feature: 'f', task: 't' })).not.toThrow();
    }
  });
});
