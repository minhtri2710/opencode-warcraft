import { describe, expect, it } from 'bun:test';
import type {
  BeadsMode,
  BeadsModeProvider,
  ContextFile,
  FeatureInfo,
  FeatureJson,
  FeatureStatusType,
  PlanReadResult,
  SpecData,
  TaskInfo,
  TaskOrigin,
  TaskStatus,
  TaskStatusType,
} from './types.js';

describe('types', () => {
  it('TaskStatusType includes all expected values', () => {
    const statuses: TaskStatusType[] = [
      'pending',
      'in_progress',
      'dispatch_prepared',
      'done',
      'cancelled',
      'blocked',
      'failed',
      'partial',
    ];
    expect(statuses).toHaveLength(8);
  });

  it('FeatureStatusType includes all expected values', () => {
    const statuses: FeatureStatusType[] = ['planning', 'approved', 'executing', 'completed'];
    expect(statuses).toHaveLength(4);
  });

  it('TaskOrigin includes both values', () => {
    const origins: TaskOrigin[] = ['plan', 'manual'];
    expect(origins).toHaveLength(2);
  });

  it('BeadsMode includes both values', () => {
    const modes: BeadsMode[] = ['on', 'off'];
    expect(modes).toHaveLength(2);
  });

  it('FeatureJson can be created with required fields', () => {
    const feature: FeatureJson = {
      name: 'test',
      epicBeadId: 'e',
      status: 'planning',
      createdAt: '2024-01-01',
    };
    expect(feature.name).toBe('test');
    expect(feature.status).toBe('planning');
  });

  it('FeatureJson supports optional fields', () => {
    const feature: FeatureJson = {
      name: 'test',
      epicBeadId: 'e',
      status: 'completed',
      createdAt: '2024-01-01',
      approvedAt: '2024-01-02',
      completedAt: '2024-01-03',
      ticket: 'ABC-123',
      sessionId: 'sess-1',
    };
    expect(feature.approvedAt).toBeDefined();
    expect(feature.completedAt).toBeDefined();
    expect(feature.ticket).toBe('ABC-123');
    expect(feature.sessionId).toBe('sess-1');
  });

  it('TaskStatus can be created with required fields', () => {
    const status: TaskStatus = {
      status: 'pending',
      origin: 'plan',
    };
    expect(status.status).toBe('pending');
    expect(status.origin).toBe('plan');
  });

  it('TaskInfo can be created with required fields', () => {
    const info: TaskInfo = {
      folder: '01-setup',
      name: 'Setup',
      status: 'pending',
      origin: 'plan',
    };
    expect(info.folder).toBe('01-setup');
  });

  it('PlanReadResult has content and status', () => {
    const result: PlanReadResult = {
      content: '# Plan',
      status: 'approved',
    };
    expect(result.content).toBe('# Plan');
    expect(result.status).toBe('approved');
  });

  it('SpecData has all required fields', () => {
    const data: SpecData = {
      featureName: 'feat',
      task: { folder: '01-t', name: 't', order: 1 },
      dependsOn: [],
      allTasks: [],
      planSection: null,
      contextFiles: [],
      completedTasks: [],
    };
    expect(data.featureName).toBe('feat');
  });

  it('ContextFile has name, content, and updatedAt', () => {
    const ctx: ContextFile = {
      name: 'notes',
      content: 'Content',
      updatedAt: '2024-01-01',
    };
    expect(ctx.name).toBe('notes');
  });

  it('BeadsModeProvider interface has getBeadsMode method', () => {
    const provider: BeadsModeProvider = {
      getBeadsMode: () => 'on',
    };
    expect(provider.getBeadsMode()).toBe('on');
  });

  it('FeatureInfo has name, status, tasks, and hasPlan', () => {
    const info: FeatureInfo = {
      name: 'feat',
      status: 'executing',
      tasks: [],
      hasPlan: true,
    };
    expect(info.hasPlan).toBe(true);
  });
});
