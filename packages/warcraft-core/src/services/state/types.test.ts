import { describe, expect, it } from 'bun:test';
import type { CreateFeatureInput, FeatureStore, PlanStore, StoreSet, TaskArtifactKind, TaskStore } from './types.js';

describe('state types validation', () => {
  describe('CreateFeatureInput', () => {
    it('accepts minimal input', () => {
      const input: CreateFeatureInput = { name: 'test-feature' };
      expect(input.name).toBe('test-feature');
    });

    it('accepts input with ticket', () => {
      const input: CreateFeatureInput = { name: 'feat', ticket: 'PROJ-42' };
      expect(input.ticket).toBe('PROJ-42');
    });
  });

  describe('TaskArtifactKind', () => {
    it('includes spec', () => {
      const kind: TaskArtifactKind = 'spec';
      expect(kind).toBe('spec');
    });

    it('includes worker_prompt', () => {
      const kind: TaskArtifactKind = 'worker_prompt';
      expect(kind).toBe('worker_prompt');
    });

    it('includes report', () => {
      const kind: TaskArtifactKind = 'report';
      expect(kind).toBe('report');
    });
  });

  describe('interface shapes', () => {
    it('FeatureStore has required methods in type', () => {
      const store: FeatureStore = {
        create: async () => ({ name: 'f', epicBeadId: 'e', status: 'planning', createdAt: '' }),
        get: async () => null,
        list: async () => [],
        update: async () => {},
      };
      expect(typeof store.create).toBe('function');
      expect(typeof store.get).toBe('function');
      expect(typeof store.list).toBe('function');
    });

    it('PlanStore has required methods in type', () => {
      const store: PlanStore = {
        approve: async () => {},
        isApproved: async () => false,
        revokeApproval: async () => {},
        syncPlanDescription: async () => {},
      };
      expect(typeof store.approve).toBe('function');
      expect(typeof store.isApproved).toBe('function');
    });

    it('StoreSet has all three stores', () => {
      const set: StoreSet = {
        featureStore: {} as FeatureStore,
        taskStore: {} as TaskStore,
        planStore: {} as PlanStore,
      };
      expect(set.featureStore).toBeDefined();
      expect(set.taskStore).toBeDefined();
      expect(set.planStore).toBeDefined();
    });
  });
});
