import { describe, expect, it } from 'bun:test';
import { createStores } from './factory.js';

describe('factory more scenarios', () => {
  it('creates stores for off beadsMode', () => {
    const stores = createStores('/tmp/nonexistent', 'off');
    expect(stores).toBeDefined();
    expect(stores.featureStore).toBeDefined();
    expect(stores.planStore).toBeDefined();
    expect(stores.taskStore).toBeDefined();
  });

  it('throws for on mode without repository', () => {
    expect(() => createStores('/tmp', 'on')).toThrow('BeadsRepository');
  });

  it('featureStore has create method', () => {
    const stores = createStores('/tmp/nonexistent', 'off');
    expect(typeof stores.featureStore.create).toBe('function');
  });

  it('featureStore has get method', () => {
    const stores = createStores('/tmp/nonexistent', 'off');
    expect(typeof stores.featureStore.get).toBe('function');
  });

  it('featureStore has list method', () => {
    const stores = createStores('/tmp/nonexistent', 'off');
    expect(typeof stores.featureStore.list).toBe('function');
  });

  it('planStore has approve method', () => {
    const stores = createStores('/tmp/nonexistent', 'off');
    expect(typeof stores.planStore.approve).toBe('function');
  });

  it('planStore has isApproved method', () => {
    const stores = createStores('/tmp/nonexistent', 'off');
    expect(typeof stores.planStore.isApproved).toBe('function');
  });

  it('taskStore has createTask method', () => {
    const stores = createStores('/tmp/nonexistent', 'off');
    expect(typeof stores.taskStore.createTask).toBe('function');
  });

  it('taskStore has list method', () => {
    const stores = createStores('/tmp/nonexistent', 'off');
    expect(typeof stores.taskStore.list).toBe('function');
  });
});
