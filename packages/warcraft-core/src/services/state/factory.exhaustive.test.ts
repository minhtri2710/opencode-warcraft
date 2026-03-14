import { describe, expect, it } from 'bun:test';
import { createStores } from './factory.js';

describe('createStores exhaustive off mode', () => {
  const stores = createStores('/tmp/factory-exhaust', 'off');

  describe('featureStore methods', () => {
    const methods = ['create', 'get', 'list'];
    for (const method of methods) {
      it(`has ${method} method`, () => {
        expect(typeof (stores.featureStore as any)[method]).toBe('function');
      });
    }
  });

  describe('planStore methods', () => {
    const methods = ['approve', 'isApproved', 'revokeApproval', 'syncPlanDescription'];
    for (const method of methods) {
      it(`has ${method} method`, () => {
        expect(typeof (stores.planStore as any)[method]).toBe('function');
      });
    }
  });

  describe('taskStore methods', () => {
    const methods = [
      'createTask',
      'get',
      'getRawStatus',
      'list',
      'getNextOrder',
      'save',
      'patchBackground',
      'delete',
      'writeArtifact',
      'readArtifact',
      'writeReport',
      'getRunnableTasks',
      'flush',
    ];
    for (const method of methods) {
      it(`has ${method} method`, () => {
        expect(typeof (stores.taskStore as any)[method]).toBe('function');
      });
    }
  });
});
