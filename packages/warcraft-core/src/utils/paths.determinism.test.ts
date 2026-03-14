import { describe, expect, it } from 'bun:test';
import type { BeadsMode } from '../types.js';
import { getFeaturePath, getTaskPath, getWarcraftPath } from './paths.js';

describe('paths determinism matrix', () => {
  const MODES: BeadsMode[] = ['off'];
  const PROJECTS = ['/project', '/home/user/code', '/var/lib/app'];
  const FEATURES = ['auth', 'billing', 'data-sync'];
  const TASKS = ['01-setup', '02-build', '99-deploy'];

  // getWarcraftPath: 2 modes × 3 projects = 6
  describe('getWarcraftPath deterministic', () => {
    for (const mode of MODES) {
      for (const project of PROJECTS) {
        it(`${project} ${mode}: deterministic`, () => {
          const a = getWarcraftPath(project, mode);
          const b = getWarcraftPath(project, mode);
          expect(a).toBe(b);
        });
      }
    }
  });

  // getFeaturePath: 2×3×3 = 18
  describe('getFeaturePath deterministic', () => {
    for (const mode of MODES) {
      for (const project of PROJECTS) {
        for (const feat of FEATURES) {
          it(`${project}/${feat} ${mode}`, () => {
            expect(getFeaturePath(project, feat, mode)).toBe(getFeaturePath(project, feat, mode));
          });
        }
      }
    }
  });

  // getTaskPath: 2×3×3×3 = 54
  describe('getTaskPath deterministic', () => {
    for (const mode of MODES) {
      for (const project of PROJECTS) {
        for (const feat of FEATURES) {
          for (const task of TASKS) {
            it(`${feat}/${task} ${mode}`, () => {
              expect(getTaskPath(project, feat, task, mode)).toBe(getTaskPath(project, feat, task, mode));
            });
          }
        }
      }
    }
  });
});
