import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isUsable, type ConfigService } from 'warcraft-core';
import { createWarcraftContainer } from './container.js';

let testRoot = '';

function createConfigServiceStub(): ConfigService {
  return {
    getBeadsMode: () => 'off',
    getDisabledMcps: () => [],
    getDisabledSkills: () => [],
    get: () => ({}),
    getWorkflowGatesMode: () => 'warn',
    getVerificationModel: () => 'tdd',
    getStructuredVerificationMode: () => 'compat',
  } as unknown as ConfigService;
}

describe('createWarcraftContainer task lifecycle wiring', () => {
  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warcraft-container-test-'));
  });

  afterEach(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('auto-completes and reopens the feature as child task statuses change', () => {
    const container = createWarcraftContainer(testRoot, createConfigServiceStub());
    const createOutcome = container.featureService.create('my-feature');
    if (!isUsable(createOutcome)) throw new Error('create failed');

    container.featureService.updateStatus('my-feature', 'approved');
    const firstTask = container.taskService.create('my-feature', 'First task', 1, 3);
    const secondTask = container.taskService.create('my-feature', 'Second task', 2, 3);

    container.taskService.update('my-feature', firstTask, {
      status: 'done',
      summary: 'First task complete',
    });
    expect(container.featureService.get('my-feature')?.status).toBe('approved');

    container.taskService.update('my-feature', secondTask, {
      status: 'done',
      summary: 'Second task complete',
    });

    const completedFeature = container.featureService.get('my-feature');
    expect(completedFeature?.status).toBe('completed');
    expect(completedFeature?.completedAt).toBeDefined();
    expect(completedFeature?.approvedAt).toBeDefined();

    container.taskService.update('my-feature', firstTask, {
      status: 'in_progress',
      summary: 'Reopened for follow-up',
    });

    const reopenedFeature = container.featureService.get('my-feature');
    expect(reopenedFeature?.status).toBe('executing');
    expect(reopenedFeature?.completedAt).toBeUndefined();
    expect(reopenedFeature?.approvedAt).toBeDefined();
  });
});
