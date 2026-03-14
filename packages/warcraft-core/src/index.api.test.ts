import { describe, expect, it } from 'bun:test';
import * as index from './index.js';

describe('warcraft-core public API completeness', () => {
  const EXPECTED_EXPORTS = [
    // Services
    'FeatureService',
    'PlanService',
    'TaskService',
    'ContextService',
    'ConfigService',
    'AgentsMdService',
    'DockerSandboxService',

    // State stores
    'FilesystemFeatureStore',
    'FilesystemPlanStore',
    'FilesystemTaskStore',
    'createStores',

    // Utilities
    'createNoopLogger',
    'createConsoleLogger',
    'sanitizeName',

    // Outcomes
    'ok',
    'okVoid',
    'degraded',
    'fatal',
    'diagnostic',
    'isUsable',

    // State machine
    'validateTransition',
    'isTransitionAllowed',

    // Dependency graph
    'computeRunnableAndBlocked',

    // Defaults
    'DEFAULT_WARCRAFT_CONFIG',
    'DEFAULT_AGENT_MODELS',
  ];

  for (const name of EXPECTED_EXPORTS) {
    it(`exports ${name}`, () => {
      const value = (index as Record<string, unknown>)[name];
      expect(value).toBeDefined();
    });
  }

  it('all exports are defined (not undefined)', () => {
    const entries = Object.entries(index);
    for (const [_key, value] of entries) {
      expect(value).toBeDefined();
    }
  });

  it('exports at least 20 items', () => {
    expect(Object.keys(index).length).toBeGreaterThanOrEqual(20);
  });
});
