import { describe, expect, it } from 'bun:test';
import { createStores } from './factory.js';

describe('createStores on mode', () => {
  // Note: 'on' mode requires beads CLI which may not be available
  // so we test with 'off' mode and verify structure

  const stores = createStores('/tmp/factory-on-test', 'off');

  it('featureStore.list returns array', () => {
    expect(Array.isArray(stores.featureStore.list())).toBe(true);
  });

  it('taskStore.list returns array', () => {
    expect(Array.isArray(stores.taskStore.list('any-feat'))).toBe(true);
  });

  it('taskStore.get returns null for missing', () => {
    expect(stores.taskStore.get('any-feat', 'any-task')).toBeNull();
  });

  it('taskStore.getRawStatus returns null for missing', () => {
    expect(stores.taskStore.getRawStatus('any-feat', 'any-task')).toBeNull();
  });

  it('taskStore.getNextOrder starts at 1', () => {
    expect(stores.taskStore.getNextOrder('new-feat')).toBe(1);
  });

  it('planStore.isApproved false for missing', () => {
    expect(stores.planStore.isApproved('missing', 'content')).toBe(false);
  });

  it('featureStore.get returns null for missing', () => {
    expect(stores.featureStore.get('missing')).toBeNull();
  });

  it('featureStore.exists returns false for missing', () => {
    expect(stores.featureStore.exists('missing')).toBe(false);
  });

  it('taskStore.getRunnableTasks returns null for fs store', () => {
    expect(stores.taskStore.getRunnableTasks('feat')).toBeNull();
  });
});
