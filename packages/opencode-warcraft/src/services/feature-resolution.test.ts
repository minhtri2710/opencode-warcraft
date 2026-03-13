import { describe, expect, it, spyOn } from 'bun:test';
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

  it('checks the live working directory before the configured project root', () => {
    const cwdSpy = spyOn(process, 'cwd').mockImplementation(
      () => '/tmp/project/docs/.worktrees/context-feature/01-task',
    );
    const detectCalls: string[] = [];
    const resolve = createResolveFeature('/tmp/project', createMockFeatureService(['fallback-feature']), (cwd) => {
      detectCalls.push(cwd);
      if (cwd.includes('/docs/.worktrees/')) {
        return {
          projectRoot: '/tmp/project',
          feature: 'context-feature',
          task: '01-task',
          isWorktree: true,
          mainProjectRoot: '/tmp/project',
        };
      }
      return {
        projectRoot: cwd,
        feature: null,
        task: null,
        isWorktree: false,
        mainProjectRoot: null,
      };
    });

    try {
      expect(resolve()).toBe('context-feature');
      expect(detectCalls[0]).toBe('/tmp/project/docs/.worktrees/context-feature/01-task');
      expect(detectCalls).not.toContain('/tmp/project');
    } finally {
      cwdSpy.mockRestore();
    }
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
