import { beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { createResolveFeature } from './feature-resolution.js';

// ============================================================================
// Minimal fakes for FeatureService & detectContext
// ============================================================================

function createMockFeatureService(features: string[] = []) {
  return {
    list: () => features,
  };
}

describe('createResolveFeature', () => {
  it('returns explicit feature when provided', () => {
    const resolve = createResolveFeature('/tmp/project', createMockFeatureService(), () => ({
      projectRoot: '/tmp/project',
      feature: null,
      task: null,
      isWorktree: false,
      mainProjectRoot: null,
    }));
    expect(resolve('my-feature')).toBe('my-feature');
  });

  it('returns feature from detectContext when no explicit argument', () => {
    const resolve = createResolveFeature('/tmp/project', createMockFeatureService(), () => ({
      projectRoot: '/tmp/project',
      feature: 'context-feature',
      task: null,
      isWorktree: true,
      mainProjectRoot: '/tmp/project',
    }));
    expect(resolve()).toBe('context-feature');
  });

  it('returns sole feature when only one exists and no context', () => {
    const resolve = createResolveFeature('/tmp/project', createMockFeatureService(['only-feature']), () => ({
      projectRoot: '/tmp/project',
      feature: null,
      task: null,
      isWorktree: false,
      mainProjectRoot: null,
    }));
    expect(resolve()).toBe('only-feature');
  });

  it('returns null when multiple features exist and no context', () => {
    const resolve = createResolveFeature('/tmp/project', createMockFeatureService(['feature-a', 'feature-b']), () => ({
      projectRoot: '/tmp/project',
      feature: null,
      task: null,
      isWorktree: false,
      mainProjectRoot: null,
    }));
    expect(resolve()).toBeNull();
  });

  it('returns null when no features exist and no context', () => {
    const resolve = createResolveFeature('/tmp/project', createMockFeatureService([]), () => ({
      projectRoot: '/tmp/project',
      feature: null,
      task: null,
      isWorktree: false,
      mainProjectRoot: null,
    }));
    expect(resolve()).toBeNull();
  });

  it('degrades gracefully when featureService.list throws', () => {
    const failing = {
      list: () => {
        throw new Error('disk read error');
      },
    };
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const resolve = createResolveFeature('/tmp/project', failing, () => ({
      projectRoot: '/tmp/project',
      feature: null,
      task: null,
      isWorktree: false,
      mainProjectRoot: null,
    }));
    expect(resolve()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('prefers explicit over context detection', () => {
    const resolve = createResolveFeature('/tmp/project', createMockFeatureService(['other']), () => ({
      projectRoot: '/tmp/project',
      feature: 'context-feature',
      task: null,
      isWorktree: true,
      mainProjectRoot: '/tmp/project',
    }));
    expect(resolve('explicit-feature')).toBe('explicit-feature');
  });
});
