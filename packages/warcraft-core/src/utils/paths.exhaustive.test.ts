import { describe, expect, it } from 'bun:test';
import type { BeadsMode } from '../types.js';
import { getContextPath, getFeaturePath, getPlanPath, getWarcraftPath, sanitizeName } from './paths.js';

describe('paths exhaustive modes', () => {
  const MODES: BeadsMode[] = ['on', 'off'];
  const FEATURES = ['simple', 'complex-feature-name', 'a'];
  const PROJECTS = ['/project', '/home/user/project', '/tmp/test'];

  describe('getWarcraftPath for all combinations', () => {
    for (const mode of MODES) {
      for (const project of PROJECTS) {
        it(`${project} with mode ${mode}`, () => {
          const result = getWarcraftPath(project, mode);
          expect(result).toContain(project);
          expect(result.length).toBeGreaterThan(project.length);
        });
      }
    }
  });

  describe('getFeaturePath for all combinations', () => {
    for (const mode of MODES) {
      for (const feat of FEATURES) {
        it(`feature ${feat} with mode ${mode}`, () => {
          const result = getFeaturePath('/project', feat, mode);
          expect(result).toContain(feat);
        });
      }
    }
  });

  describe('getPlanPath for all combinations', () => {
    for (const mode of MODES) {
      for (const feat of FEATURES) {
        it(`plan for ${feat} with mode ${mode}`, () => {
          const result = getPlanPath('/project', feat, mode);
          expect(result).toContain('plan');
        });
      }
    }
  });

  describe('getContextPath for all combinations', () => {
    for (const mode of MODES) {
      for (const feat of FEATURES) {
        it(`context for ${feat} with mode ${mode}`, () => {
          const result = getContextPath('/project', feat, mode);
          expect(result).toContain(feat);
        });
      }
    }
  });

  describe('sanitizeName valid inputs', () => {
    const VALID = ['abc', 'test-123', 'name_with_underscore', 'x', '123', 'UPPER'];
    for (const name of VALID) {
      it(`${name} is valid`, () => {
        expect(() => sanitizeName(name)).not.toThrow();
      });
    }
  });

  describe('sanitizeName invalid inputs', () => {
    const INVALID = ['', '  ', '..', '.hidden', 'a/b', 'a\\b', '\x00bad'];
    for (const name of INVALID) {
      it(`"${name.replace(/\x00/g, '\\0')}" throws`, () => {
        expect(() => sanitizeName(name)).toThrow();
      });
    }
  });
});
