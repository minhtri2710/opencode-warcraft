import { describe, expect, it } from 'bun:test';
import type { BeadsMode, FeatureJson, TaskStatus, TaskStatusType } from './types.js';

describe('types validation', () => {
  it('FeatureJson requires name and status', () => {
    const feature: FeatureJson = {
      name: 'test',
      epicBeadId: 'e-1',
      status: 'planning',
      createdAt: '2024-01-01',
    };
    expect(feature.name).toBe('test');
    expect(feature.status).toBe('planning');
  });

  it('FeatureJson supports all status types', () => {
    const statuses = ['planning', 'approved', 'executing', 'completed'] as const;
    for (const status of statuses) {
      const f: FeatureJson = { name: 't', epicBeadId: 'e', status, createdAt: '2024-01-01' };
      expect(f.status).toBe(status);
    }
  });

  it('TaskStatus has required fields', () => {
    const status: TaskStatus = {
      status: 'pending',
      origin: 'plan',
    };
    expect(status.status).toBe('pending');
    expect(status.origin).toBe('plan');
  });

  it('all TaskStatusType values are valid', () => {
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
    for (const s of statuses) {
      expect(typeof s).toBe('string');
    }
  });

  it('BeadsMode is on or off', () => {
    const modes: BeadsMode[] = ['on', 'off'];
    expect(modes).toHaveLength(2);
  });

  it('TaskStatus with worker session', () => {
    const status: TaskStatus = {
      status: 'in_progress',
      origin: 'plan',
      workerSession: {
        sessionId: 'sess-1',
        workerId: 'w-1',
        agent: 'saurfang',
      },
    };
    expect(status.workerSession?.sessionId).toBe('sess-1');
  });

  it('TaskStatus with blocker', () => {
    const status: TaskStatus = {
      status: 'blocked',
      origin: 'plan',
      blocker: { reason: 'waiting', detail: 'on dep' },
    };
    expect(status.blocker?.reason).toBe('waiting');
  });

  it('TaskStatus with learnings', () => {
    const status: TaskStatus = {
      status: 'done',
      origin: 'plan',
      learnings: ['lesson1', 'lesson2'],
    };
    expect(status.learnings).toHaveLength(2);
  });

  it('FeatureJson with optional fields', () => {
    const feature: FeatureJson = {
      name: 'full',
      epicBeadId: 'e-1',
      status: 'executing',
      createdAt: '2024-01-01',
      ticket: 'PROJ-42',
      approvedAt: '2024-01-02',
      completedAt: '2024-01-03',
    };
    expect(feature.ticket).toBe('PROJ-42');
    expect(feature.approvedAt).toBe('2024-01-02');
    expect(feature.completedAt).toBe('2024-01-03');
  });
});
