import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import { createTempProjectRoot, getHostPreflightSkipReason } from './helpers/test-env.js';

const PRECONDITION_SKIP_REASON = getHostPreflightSkipReason({ requireBr: true });
const describeIfHostReady = PRECONDITION_SKIP_REASON ? describe.skip : describe;
const runIfHostReady = PRECONDITION_SKIP_REASON ? it.skip : it;

describeIfHostReady('integration: runtime spec contract verification', () => {
  runIfHostReady('plugin loads with refactored service architecture', async () => {
    // This test verifies that the plugin module loads correctly
    // after the BV triage service and spec formatting refactor
    const plugin = await import('../index.js');
    expect(plugin.default).toBeDefined();
    expect(typeof plugin.default).toBe('function');
  });

  runIfHostReady('spec formatter produces expected output structure', async () => {
    // Import the spec content builder directly to verify formatting
    const { formatSpecContent } = await import('warcraft-core');

    const specData = {
      featureName: 'test-feature',
      task: { folder: '01-test-task', name: 'Test Task', order: 1 },
      dependsOn: [],
      allTasks: [{ folder: '01-test-task', name: 'Test Task', order: 1 }],
      planSection: 'Test the spec formatting.\n\n- Create: test file',
      contextFiles: [],
      completedTasks: [],
    };

    const formatted = formatSpecContent(specData);

    // Verify structure matches expected output
    expect(formatted).toContain('# Task: 01-test-task');
    expect(formatted).toContain('## Feature: test-feature');
    expect(formatted).toContain('## Dependencies');
    expect(formatted).toContain('_None_');
    expect(formatted).toContain('## Plan Section');
    expect(formatted).toContain('Test the spec formatting');
    expect(formatted).toContain('## Task Type');
    expect(formatted).toContain('greenfield');
  });

  runIfHostReady('spec formatter handles complex dependencies', async () => {
    const { formatSpecContent } = await import('warcraft-core');

    const specData = {
      featureName: 'complex-feature',
      task: { folder: '03-final-task', name: 'Final Task', order: 3 },
      dependsOn: ['01-setup-task', '02-build-task'],
      allTasks: [
        { folder: '01-setup-task', name: 'Setup Task', order: 1 },
        { folder: '02-build-task', name: 'Build Task', order: 2 },
        { folder: '03-final-task', name: 'Final Task', order: 3 },
      ],
      planSection: 'Complete the implementation.\n\n- Modify: existing file',
      contextFiles: [],
      completedTasks: [
        { name: 'Setup Task', summary: 'Environment configured' },
        { name: 'Build Task', summary: 'Components built' },
      ],
    };

    const formatted = formatSpecContent(specData);

    // Verify dependencies are formatted with order and name
    expect(formatted).toContain('**1. Setup Task** (01-setup-task)');
    expect(formatted).toContain('**2. Build Task** (02-build-task)');

    // Verify completed tasks are included
    expect(formatted).toContain('## Completed Tasks');
    expect(formatted).toContain('Setup Task: Environment configured');
    expect(formatted).toContain('Build Task: Components built');

    // Task type should be modification
    expect(formatted).toContain('modification');
  });

  runIfHostReady('BV triage service can be instantiated', async () => {
    // Import the BV triage service directly
    const { BvTriageService } = await import('warcraft-core');

    const testRoot = createTempProjectRoot('bv-triage-runtime-test');

    try {
      // Create service instance (disabled mode for test)
      const service = new BvTriageService(testRoot, false);

      // Verify health API
      const health = service.getHealth();
      expect(health.enabled).toBe(false);
      expect(health.available).toBe(false); // disabled = not available
      expect(health.lastError).toBeNull();

      // Verify triage APIs return null when disabled
      const blockerTriage = service.getBlockerTriage('test-bead');
      expect(blockerTriage).toBeNull();

      const globalTriage = service.getGlobalTriage();
      expect(globalTriage).toBeNull();
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  runIfHostReady('BV triage service tracks health state correctly', async () => {
    const { BvTriageService } = await import('warcraft-core');
    type BvCommandExecutor = import('warcraft-core').BvCommandExecutor;

    const testRoot = createTempProjectRoot('bv-health-test');

    // Mock executor that simulates command failure
    const failingExecutor: BvCommandExecutor = () => {
      throw new Error('bv command not found');
    };

    try {
      // Create service with failing executor
      const service = new BvTriageService(testRoot, true, failingExecutor);

      // Initial health should show available (no error yet)
      let health = service.getHealth();
      expect(health.enabled).toBe(true);
      expect(health.available).toBe(true);

      // Trigger an operation that will fail
      service.getGlobalTriage();

      // Health should now reflect error
      health = service.getHealth();
      expect(health.enabled).toBe(true);
      expect(health.available).toBe(false);
      expect(health.lastError).toContain('bv command not found');
      expect(health.lastErrorAt).not.toBeNull();
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  runIfHostReady('BV triage service caches results correctly', async () => {
    const { BvTriageService } = await import('warcraft-core');
    type BvCommandExecutor = import('warcraft-core').BvCommandExecutor;

    const testRoot = createTempProjectRoot('bv-cache-test');
    let callCount = 0;

    // Mock executor that returns valid JSON
    const mockExecutor: BvCommandExecutor = () => {
      callCount++;
      return JSON.stringify({ summary: 'Test triage summary' });
    };

    try {
      const service = new BvTriageService(testRoot, true, mockExecutor);

      // First call should execute the command
      const result1 = service.getBlockerTriage('test-bead-1');
      expect(result1?.summary).toContain('Test triage summary');
      expect(callCount).toBe(2); // blocker + causality calls

      // Second call for same bead should use cache
      const result2 = service.getBlockerTriage('test-bead-1');
      expect(result2?.summary).toBe(result1?.summary);
      expect(callCount).toBe(2); // No additional calls

      // Call for different bead should execute command again
      service.getBlockerTriage('test-bead-2');
      expect(callCount).toBe(4); // 2 more calls for new bead
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });
});
