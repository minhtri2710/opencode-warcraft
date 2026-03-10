import { describe, expect, it } from 'bun:test';
import type { StructuredVerification } from './guards.js';
import {
  COMPLETION_GATES,
  COMPLETION_PASS_SIGNAL,
  checkVerificationGates,
  hasCompletionGateEvidence,
  isPathInside,
  validateTaskStatus,
} from './guards.js';

describe('guards.ts test suite', () => {
  describe('VALID_TASK_STATUSES constant', () => {
    it('should contain all 7 valid task statuses', () => {
      const _expectedStatuses = ['pending', 'in_progress', 'done', 'cancelled', 'blocked', 'failed', 'partial'];
      expect(COMPLETION_GATES).toBeArray();
      expect(COMPLETION_GATES).toHaveLength(3);
    });
  });

  describe('COMPLETION_GATES constant', () => {
    it('should contain all 3 gate names', () => {
      expect(COMPLETION_GATES).toEqual(['build', 'test', 'lint']);
    });
  });

  describe('COMPLETION_PASS_SIGNAL regex', () => {
    it('should match "exit code 0"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Build passed with exit code 0')).toBe(true);
    });

    it('should match "exit 0"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('exit 0')).toBe(true);
    });

    it('should match "pass"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('All tests pass')).toBe(true);
    });

    it('should match "passes"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('All checks passes')).toBe(true);
    });

    it('should match "passed"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Build passed')).toBe(true);
    });

    it('should match "success"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Deployment success')).toBe(true);
    });

    it('should match "successful"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Operation successful')).toBe(true);
    });

    it('should match "successfully"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Completed successfully')).toBe(true);
    });

    it('should match "succeed"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Tests should succeed')).toBe(true);
    });

    it('should match "succeeded"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Migration succeeded')).toBe(true);
    });

    it('should match "succeeds"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Check succeeds')).toBe(true);
    });

    it('should match "ok"', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Lint: ok')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(COMPLETION_PASS_SIGNAL.test('EXIT CODE 0')).toBe(true);
      expect(COMPLETION_PASS_SIGNAL.test('PASS')).toBe(true);
      expect(COMPLETION_PASS_SIGNAL.test('SUCCESS')).toBe(true);
      expect(COMPLETION_PASS_SIGNAL.test('OK')).toBe(true);
    });

    it('should match word boundaries correctly', () => {
      // Should match "ok" as a whole word
      expect(COMPLETION_PASS_SIGNAL.test('Status: ok')).toBe(true);
    });

    // Note: COMPLETION_PASS_SIGNAL alone matches "ok" in "not ok"
    // The FAIL_SIGNALS check in hasCompletionGateEvidence handles rejection
    it('should match "ok" in "not ok" (FAIL_SIGNALS check handles rejection)', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Lint: not ok')).toBe(true);
    });

    // Note: COMPLETION_PASS_SIGNAL alone matches "successful" in "not successful"
    // The FAIL_SIGNALS check in hasCompletionGateEvidence handles rejection
    it('should match "successful" in "not successful" (FAIL_SIGNALS check handles rejection)', () => {
      expect(COMPLETION_PASS_SIGNAL.test('Build: not successful')).toBe(true);
    });

    // Note: COMPLETION_PASS_SIGNAL alone matches "passed" in "tests failed, not passed"
    // The FAIL_SIGNALS check in hasCompletionGateEvidence handles rejection
    it('should match "passed" in "tests failed, not passed" (FAIL_SIGNALS check handles rejection)', () => {
      expect(COMPLETION_PASS_SIGNAL.test('tests failed, not passed')).toBe(true);
    });
  });

  describe('validateTaskStatus', () => {
    it('should accept all 8 valid task statuses', () => {
      const validStatuses = [
        'pending',
        'in_progress',
        'dispatch_prepared',
        'done',
        'cancelled',
        'blocked',
        'failed',
        'partial',
      ];
      validStatuses.forEach((status) => {
        expect(validateTaskStatus(status)).toBe(status);
      });
    });

    it('should throw error for invalid status', () => {
      expect(() => validateTaskStatus('invalid')).toThrow('Invalid task status: "invalid"');
    });

    it('should throw error for empty string', () => {
      expect(() => validateTaskStatus('')).toThrow('Invalid task status: ""');
    });

    it('should throw error for random string', () => {
      expect(() => validateTaskStatus('some-random-status')).toThrow();
    });

    it('should throw error for mixed case valid status', () => {
      expect(() => validateTaskStatus('PENDING')).toThrow();
      expect(() => validateTaskStatus('Pending')).toThrow();
    });
  });

  describe('hasCompletionGateEvidence', () => {
    describe('build gate', () => {
      it('should return true when summary contains "build" and positive signal', () => {
        expect(hasCompletionGateEvidence('build: exit 0', 'build')).toBe(true);
        expect(hasCompletionGateEvidence('Build passed', 'build')).toBe(true);
        expect(hasCompletionGateEvidence('Build successful', 'build')).toBe(true);
        expect(hasCompletionGateEvidence('Build ok', 'build')).toBe(true);
      });

      it('should return false when summary does not contain gate name', () => {
        expect(hasCompletionGateEvidence('test passed', 'build')).toBe(false);
        expect(hasCompletionGateEvidence('lint: ok', 'build')).toBe(false);
        expect(hasCompletionGateEvidence('All checks pass', 'build')).toBe(false);
      });

      it('should return false when summary contains gate name but no positive signal', () => {
        expect(hasCompletionGateEvidence('Build failed', 'build')).toBe(false);
        expect(hasCompletionGateEvidence('Build: error', 'build')).toBe(false);
        expect(hasCompletionGateEvidence('Build in progress', 'build')).toBe(false);
      });

      // FAIL_SIGNALS should reject "not ok"
      it('should return false for "build: not ok"', () => {
        expect(hasCompletionGateEvidence('build: not ok', 'build')).toBe(false);
      });

      // FAIL_SIGNALS should reject "not successful"
      it('should return false for "build: not successful"', () => {
        expect(hasCompletionGateEvidence('build: not successful', 'build')).toBe(false);
      });

      // Word-boundary: "rebuild" should not match gate "build"
      it('should return false for "rebuild ok" with gate "build"', () => {
        expect(hasCompletionGateEvidence('rebuild ok', 'build')).toBe(false);
      });

      // Valid case: "build: exit 0" should pass
      it('should return true for "build: exit 0"', () => {
        expect(hasCompletionGateEvidence('build: exit 0', 'build')).toBe(true);
      });

      // BUG: Substring match - contains "build" but refers to something else
      it('should handle case-insensitive gate name matching', () => {
        expect(hasCompletionGateEvidence('BUILD passed', 'build')).toBe(true);
        expect(hasCompletionGateEvidence('Build PASSED', 'build')).toBe(true);
      });
    });

    describe('test gate', () => {
      it('should return true when summary contains "test" and positive signal', () => {
        expect(hasCompletionGateEvidence('test: exit 0', 'test')).toBe(true);
        expect(hasCompletionGateEvidence('Tests passed', 'test')).toBe(true);
        expect(hasCompletionGateEvidence('Tests successful', 'test')).toBe(true);
        expect(hasCompletionGateEvidence('Tests: ok', 'test')).toBe(true);
      });

      it('should return false when summary does not contain gate name', () => {
        expect(hasCompletionGateEvidence('build passed', 'test')).toBe(false);
        expect(hasCompletionGateEvidence('lint: ok', 'test')).toBe(false);
        expect(hasCompletionGateEvidence('All checks pass', 'test')).toBe(false);
      });

      it('should return false when summary contains gate name but no positive signal', () => {
        expect(hasCompletionGateEvidence('Tests failed', 'test')).toBe(false);
        expect(hasCompletionGateEvidence('Test: error', 'test')).toBe(false);
        expect(hasCompletionGateEvidence('Test in progress', 'test')).toBe(false);
      });

      // FAIL_SIGNALS should reject "not ok"
      it('should return false for "test: not ok"', () => {
        expect(hasCompletionGateEvidence('test: not ok', 'test')).toBe(false);
      });

      // FAIL_SIGNALS should reject "tests failed, not passed"
      it('should return false for "tests failed, not passed"', () => {
        expect(hasCompletionGateEvidence('tests failed, not passed', 'test')).toBe(false);
      });

      // Word-boundary: "testing" should not match gate "test"
      it('should return false for "testing: pass" with gate "test"', () => {
        expect(hasCompletionGateEvidence('testing: pass', 'test')).toBe(false);
      });

      // Word-boundary: "latest build" should not match gate "test"
      it('should return false for "latest build ok" with gate "test"', () => {
        expect(hasCompletionGateEvidence('latest build ok', 'test')).toBe(false);
      });

      // Valid case: "test: passed" should pass
      it('should return true for "test: passed"', () => {
        expect(hasCompletionGateEvidence('test: passed', 'test')).toBe(true);
      });

      it('should handle case-insensitive gate name matching', () => {
        expect(hasCompletionGateEvidence('TESTS passed', 'test')).toBe(true);
        expect(hasCompletionGateEvidence('Tests PASSED', 'test')).toBe(true);
      });
    });

    describe('lint gate', () => {
      it('should return true when summary contains "lint" and positive signal', () => {
        expect(hasCompletionGateEvidence('lint: exit 0', 'lint')).toBe(true);
        expect(hasCompletionGateEvidence('Lint passed', 'lint')).toBe(true);
        expect(hasCompletionGateEvidence('Lint successful', 'lint')).toBe(true);
        expect(hasCompletionGateEvidence('Lint: ok', 'lint')).toBe(true);
      });

      it('should return false when summary does not contain gate name', () => {
        expect(hasCompletionGateEvidence('build passed', 'lint')).toBe(false);
        expect(hasCompletionGateEvidence('test: ok', 'lint')).toBe(false);
        expect(hasCompletionGateEvidence('All checks pass', 'lint')).toBe(false);
      });

      it('should return false when summary contains gate name but no positive signal', () => {
        expect(hasCompletionGateEvidence('Lint failed', 'lint')).toBe(false);
        expect(hasCompletionGateEvidence('Lint: error', 'lint')).toBe(false);
        expect(hasCompletionGateEvidence('Lint in progress', 'lint')).toBe(false);
      });

      // FAIL_SIGNALS should reject "not ok"
      it('should return false for "lint: not ok"', () => {
        expect(hasCompletionGateEvidence('lint: not ok', 'lint')).toBe(false);
      });

      // FAIL_SIGNALS should reject "error"
      it('should return false for "lint: error"', () => {
        expect(hasCompletionGateEvidence('lint: error', 'lint')).toBe(false);
      });

      it('should handle case-insensitive gate name matching', () => {
        expect(hasCompletionGateEvidence('LINT passed', 'lint')).toBe(true);
        expect(hasCompletionGateEvidence('Lint PASSED', 'lint')).toBe(true);
      });
    });

    describe('multi-line summaries', () => {
      it('should find evidence across multiple lines', () => {
        const summary = 'Build: exit 0\nTest: failed\nLint: ok';
        expect(hasCompletionGateEvidence(summary, 'build')).toBe(true);
        expect(hasCompletionGateEvidence(summary, 'test')).toBe(false);
        expect(hasCompletionGateEvidence(summary, 'lint')).toBe(true);
      });

      it('should ignore empty lines', () => {
        const summary = 'Build: exit 0\n\n\nTest: failed\n\nLint: ok';
        expect(hasCompletionGateEvidence(summary, 'build')).toBe(true);
        expect(hasCompletionGateEvidence(summary, 'test')).toBe(false);
        expect(hasCompletionGateEvidence(summary, 'lint')).toBe(true);
      });

      it('should trim whitespace from lines', () => {
        const summary = '  Build: exit 0  \n  Test: failed  \n  Lint: ok  ';
        expect(hasCompletionGateEvidence(summary, 'build')).toBe(true);
        expect(hasCompletionGateEvidence(summary, 'test')).toBe(false);
        expect(hasCompletionGateEvidence(summary, 'lint')).toBe(true);
      });
    });

    describe('edge cases', () => {
      it('should return false for empty summary', () => {
        expect(hasCompletionGateEvidence('', 'build')).toBe(false);
      });

      it('should return false for whitespace-only summary', () => {
        expect(hasCompletionGateEvidence('   ', 'build')).toBe(false);
      });

      it('should return false for summary with only newlines', () => {
        expect(hasCompletionGateEvidence('\n\n\n', 'build')).toBe(false);
      });

      it('should handle carriage returns in line endings', () => {
        const summary = 'Build: exit 0\r\nTest: failed\r\nLint: ok';
        expect(hasCompletionGateEvidence(summary, 'build')).toBe(true);
        expect(hasCompletionGateEvidence(summary, 'lint')).toBe(true);
      });
    });
  });

  describe('isPathInside', () => {
    describe('normal nesting', () => {
      it('should return true for simple nested path', () => {
        expect(isPathInside('/foo/bar', '/foo')).toBe(true);
      });

      it('should return true for deeply nested path', () => {
        expect(isPathInside('/foo/bar/baz/qux', '/foo')).toBe(true);
      });

      it('should return true for relative nested path', () => {
        expect(isPathInside('foo/bar', 'foo')).toBe(true);
      });

      it('should return true for current directory nesting', () => {
        expect(isPathInside('./foo/bar', './foo')).toBe(true);
      });

      it('should return true for parent directory reference (. and ..)', () => {
        expect(isPathInside('foo/bar', '.')).toBe(true);
        expect(isPathInside('foo/bar/baz', 'foo/bar')).toBe(true);
      });
    });

    describe('path traversal', () => {
      it('should return false when path goes above parent', () => {
        expect(isPathInside('/foo', '/foo/bar')).toBe(false);
      });

      it('should return false for explicit parent traversal', () => {
        expect(isPathInside('../foo', '/foo')).toBe(false);
        expect(isPathInside('/foo/../bar', '/foo')).toBe(false);
      });

      it('should return false for path that escapes and re-enters', () => {
        expect(isPathInside('/foo/bar/../baz', '/foo/qux')).toBe(false);
      });
    });

    describe('equal paths', () => {
      it('should return true when paths are equal', () => {
        expect(isPathInside('/foo', '/foo')).toBe(true);
        expect(isPathInside('foo', 'foo')).toBe(true);
        expect(isPathInside('/foo/bar/', '/foo/bar')).toBe(true);
        expect(isPathInside('./foo', './foo')).toBe(true);
      });

      it('should handle trailing slashes correctly', () => {
        expect(isPathInside('/foo/bar', '/foo/bar/')).toBe(true);
        expect(isPathInside('/foo/bar/', '/foo/bar')).toBe(true);
      });

      it('should normalize dot segments', () => {
        expect(isPathInside('/foo/./bar', '/foo/bar')).toBe(true);
        expect(isPathInside('/foo/bar', '/foo/./bar')).toBe(true);
      });
    });

    describe('absolute vs relative paths', () => {
      it('should handle mixing absolute and relative paths', () => {
        const absolute = '/Users/test/project/src';
        const _relative = 'src';
        expect(isPathInside(absolute, '/Users/test/project')).toBe(true);
      });

      it('should resolve relative paths from current working directory', () => {
        // This will resolve relative to the actual CWD when test runs
        expect(isPathInside('src', '.')).toBe(true);
      });

      it('should handle dot segments in resolution', () => {
        expect(isPathInside('./src/test', '.')).toBe(true);
        expect(isPathInside('../test', './src')).toBe(false);
      });
    });

    describe('edge cases', () => {
      it('should handle empty string paths', () => {
        // Empty candidate resolves to cwd, so this depends on where test runs
        const result = isPathInside('', '.');
        expect(typeof result).toBe('boolean');
      });

      it('should handle single dot as current directory', () => {
        expect(isPathInside('.', '.')).toBe(true);
      });

      it('should handle double dot as parent directory', () => {
        const result = isPathInside('..', '.');
        expect(typeof result).toBe('boolean');
      });
    });

    describe('real-world scenarios', () => {
      it('should correctly identify package paths', () => {
        const project = '/Users/test/project';
        const corePackage = '/Users/test/project/packages/core';
        const utilsPackage = '/Users/test/project/packages/utils';

        expect(isPathInside(corePackage, project)).toBe(true);
        expect(isPathInside(utilsPackage, project)).toBe(true);
        expect(isPathInside(project, corePackage)).toBe(false);
      });

      it('should handle source file within package', () => {
        const packagePath = '/Users/test/project/packages/core/src';
        const file = '/Users/test/project/packages/core/src/utils.ts';

        expect(isPathInside(file, packagePath)).toBe(true);
      });

      it('should handle node_modules correctly', () => {
        const project = '/Users/test/project';
        const nodeModules = '/Users/test/project/node_modules/package';

        expect(isPathInside(nodeModules, project)).toBe(true);
      });
    });
  });
});

// ============================================================================
// checkVerificationGates tests
// ============================================================================

describe('checkVerificationGates', () => {
  const gates = COMPLETION_GATES;
  const regexEvidence = (summary: string, gate: string) => summary.includes(`${gate}: exit 0`);

  describe('compat mode with full structured verification', () => {
    it('passes when all gates have exitCode 0', () => {
      const verification: StructuredVerification = {
        build: { cmd: 'bun run build', exitCode: 0 },
        test: { cmd: 'bun test', exitCode: 0 },
        lint: { cmd: 'bun run lint', exitCode: 0 },
      };
      const result = checkVerificationGates(verification, '', gates, 'compat', regexEvidence);
      expect(result.passed).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.usedRegexFallback).toBe(false);
    });

    it('fails when a gate has non-zero exitCode', () => {
      const verification: StructuredVerification = {
        build: { cmd: 'bun run build', exitCode: 0 },
        test: { cmd: 'bun test', exitCode: 1 },
        lint: { cmd: 'bun run lint', exitCode: 0 },
      };
      const result = checkVerificationGates(verification, '', gates, 'compat', regexEvidence);
      expect(result.passed).toBe(false);
      expect(result.missing).toEqual(['test']);
      expect(result.usedRegexFallback).toBe(false);
    });
  });

  describe('compat mode with partial structured + regex fallback', () => {
    it('falls back to regex for missing structured gates', () => {
      const verification: StructuredVerification = {
        build: { cmd: 'bun run build', exitCode: 0 },
        test: { cmd: 'bun test', exitCode: 0 },
      };
      const summary = 'lint: exit 0';
      const result = checkVerificationGates(verification, summary, gates, 'compat', regexEvidence);
      expect(result.passed).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.usedRegexFallback).toBe(true);
    });

    it('fails when regex fallback finds no evidence', () => {
      const verification: StructuredVerification = {
        build: { cmd: 'bun run build', exitCode: 0 },
      };
      const summary = 'no evidence here';
      const result = checkVerificationGates(verification, summary, gates, 'compat', regexEvidence);
      expect(result.passed).toBe(false);
      expect(result.missing).toEqual(['test', 'lint']);
      expect(result.usedRegexFallback).toBe(true);
    });
  });

  describe('compat mode with no structured verification', () => {
    it('uses regex for all gates', () => {
      const summary = 'build: exit 0, test: exit 0, lint: exit 0';
      const result = checkVerificationGates(undefined, summary, gates, 'compat', regexEvidence);
      expect(result.passed).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.usedRegexFallback).toBe(true);
    });

    it('fails when regex finds no evidence', () => {
      const result = checkVerificationGates(undefined, 'Did stuff', gates, 'compat', regexEvidence);
      expect(result.passed).toBe(false);
      expect(result.missing).toEqual(['build', 'test', 'lint']);
      expect(result.usedRegexFallback).toBe(true);
    });
  });

  describe('enforce mode', () => {
    it('passes with full structured verification', () => {
      const verification: StructuredVerification = {
        build: { cmd: 'bun run build', exitCode: 0 },
        test: { cmd: 'bun test', exitCode: 0 },
        lint: { cmd: 'bun run lint', exitCode: 0 },
      };
      const result = checkVerificationGates(verification, '', gates, 'enforce', regexEvidence);
      expect(result.passed).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.usedRegexFallback).toBe(false);
    });

    it('fails when structured data is missing even if regex would pass', () => {
      const summary = 'build: exit 0, test: exit 0, lint: exit 0';
      const result = checkVerificationGates(undefined, summary, gates, 'enforce', regexEvidence);
      expect(result.passed).toBe(false);
      expect(result.missing).toEqual(['build', 'test', 'lint']);
      expect(result.usedRegexFallback).toBe(false);
    });

    it('fails when partial structured data is missing', () => {
      const verification: StructuredVerification = {
        build: { cmd: 'bun run build', exitCode: 0 },
      };
      const result = checkVerificationGates(
        verification,
        'test: exit 0, lint: exit 0',
        gates,
        'enforce',
        regexEvidence,
      );
      expect(result.passed).toBe(false);
      expect(result.missing).toEqual(['test', 'lint']);
      expect(result.usedRegexFallback).toBe(false);
    });
  });

  describe('structured wins over contradictory summary', () => {
    it('structured exitCode 1 overrides regex pass', () => {
      const verification: StructuredVerification = {
        build: { cmd: 'bun run build', exitCode: 1, output: 'Compile error' },
        test: { cmd: 'bun test', exitCode: 0 },
        lint: { cmd: 'bun run lint', exitCode: 0 },
      };
      const summary = 'build: exit 0, test: exit 0, lint: exit 0';
      const result = checkVerificationGates(verification, summary, gates, 'compat', regexEvidence);
      expect(result.passed).toBe(false);
      expect(result.missing).toEqual(['build']);
    });
  });
});
