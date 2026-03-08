/**
 * Tests for task complexity classifier.
 *
 * Pure, deterministic classification of task complexity from runtime signals.
 * Three levels: trivial, standard, complex.
 *
 * Boundary tests verify exact threshold edges per spec:
 * - trivial: specLength < 500, fileCount <= 2, dependencyCount === 0, previousAttempts === 0
 * - complex: specLength > 3000, fileCount > 5, previousAttempts >= 2, featureReopenRate > 0.2
 * - standard: everything else
 */

import { describe, expect, it } from 'bun:test';
import type { ComplexitySignals } from './task-complexity.js';
import { classifyComplexity } from './task-complexity.js';

// ============================================================================
// Helpers
// ============================================================================

/** Base signals that yield "standard" classification. */
const standardSignals: ComplexitySignals = {
  specLength: 1000,
  fileCount: 3,
  dependencyCount: 1,
  previousAttempts: 0,
  featureReopenRate: 0,
};

/** Signals that satisfy ALL trivial conditions. */
const trivialSignals: ComplexitySignals = {
  specLength: 200,
  fileCount: 1,
  dependencyCount: 0,
  previousAttempts: 0,
  featureReopenRate: 0,
};

/** Signals that trigger complex via specLength. */
const complexSignals: ComplexitySignals = {
  specLength: 4000,
  fileCount: 8,
  dependencyCount: 3,
  previousAttempts: 2,
  featureReopenRate: 0.3,
};

// ============================================================================
// Basic Classification
// ============================================================================

describe('classifyComplexity', () => {
  it('returns "trivial" when all trivial conditions are met', () => {
    expect(classifyComplexity(trivialSignals)).toBe('trivial');
  });

  it('returns "complex" when any complex condition is met', () => {
    expect(classifyComplexity(complexSignals)).toBe('complex');
  });

  it('returns "standard" when neither trivial nor complex', () => {
    expect(classifyComplexity(standardSignals)).toBe('standard');
  });

  // ============================================================================
  // Trivial Boundary Tests
  // ============================================================================

  describe('trivial boundaries', () => {
    it('is trivial at specLength=499 (just under 500)', () => {
      expect(classifyComplexity({ ...trivialSignals, specLength: 499 })).toBe('trivial');
    });

    it('is NOT trivial at specLength=500 (threshold is < 500, not <=)', () => {
      expect(classifyComplexity({ ...trivialSignals, specLength: 500 })).not.toBe('trivial');
    });

    it('is trivial at fileCount=2 (threshold is <= 2)', () => {
      expect(classifyComplexity({ ...trivialSignals, fileCount: 2 })).toBe('trivial');
    });

    it('is NOT trivial at fileCount=3', () => {
      expect(classifyComplexity({ ...trivialSignals, fileCount: 3 })).not.toBe('trivial');
    });

    it('is NOT trivial when dependencyCount=1', () => {
      expect(classifyComplexity({ ...trivialSignals, dependencyCount: 1 })).not.toBe('trivial');
    });

    it('is NOT trivial when previousAttempts=1', () => {
      expect(classifyComplexity({ ...trivialSignals, previousAttempts: 1 })).not.toBe('trivial');
    });

    it('is trivial at specLength=0 with all trivial conditions', () => {
      expect(classifyComplexity({ ...trivialSignals, specLength: 0 })).toBe('trivial');
    });
  });

  // ============================================================================
  // Complex Boundary Tests
  // ============================================================================

  describe('complex boundaries', () => {
    it('is complex at specLength=3001 (threshold is > 3000)', () => {
      expect(classifyComplexity({ ...standardSignals, specLength: 3001 })).toBe('complex');
    });

    it('is NOT complex at specLength=3000 (threshold is >, not >=)', () => {
      expect(classifyComplexity({ ...standardSignals, specLength: 3000 })).not.toBe('complex');
    });

    it('is complex at fileCount=6 (threshold is > 5)', () => {
      expect(classifyComplexity({ ...standardSignals, fileCount: 6 })).toBe('complex');
    });

    it('is NOT complex at fileCount=5 (threshold is >, not >=)', () => {
      expect(classifyComplexity({ ...standardSignals, fileCount: 5 })).not.toBe('complex');
    });

    it('is complex at previousAttempts=2 (threshold is >= 2)', () => {
      expect(classifyComplexity({ ...standardSignals, previousAttempts: 2 })).toBe('complex');
    });

    it('is NOT complex at previousAttempts=1', () => {
      expect(classifyComplexity({ ...standardSignals, previousAttempts: 1 })).not.toBe('complex');
    });

    it('is complex at featureReopenRate=0.21 (threshold is > 0.2)', () => {
      expect(classifyComplexity({ ...standardSignals, featureReopenRate: 0.21 })).toBe('complex');
    });

    it('is NOT complex at featureReopenRate=0.2 (threshold is >, not >=)', () => {
      expect(classifyComplexity({ ...standardSignals, featureReopenRate: 0.2 })).not.toBe('complex');
    });

    it('is complex when only one complex condition triggers', () => {
      // Only specLength triggers complex; other signals are standard/trivial
      const signals: ComplexitySignals = {
        specLength: 5000,
        fileCount: 1,
        dependencyCount: 0,
        previousAttempts: 0,
        featureReopenRate: 0,
      };
      expect(classifyComplexity(signals)).toBe('complex');
    });
  });

  // ============================================================================
  // Standard Classification Tests
  // ============================================================================

  describe('standard classification', () => {
    it('returns standard for middle-of-range signals', () => {
      const signals: ComplexitySignals = {
        specLength: 1500,
        fileCount: 3,
        dependencyCount: 1,
        previousAttempts: 0,
        featureReopenRate: 0.1,
      };
      expect(classifyComplexity(signals)).toBe('standard');
    });

    it('returns standard at specLength=500 (fails trivial, not complex)', () => {
      const signals: ComplexitySignals = {
        specLength: 500,
        fileCount: 1,
        dependencyCount: 0,
        previousAttempts: 0,
        featureReopenRate: 0,
      };
      expect(classifyComplexity(signals)).toBe('standard');
    });

    it('returns standard at specLength=3000 (not trivial, not complex)', () => {
      const signals: ComplexitySignals = {
        specLength: 3000,
        fileCount: 3,
        dependencyCount: 1,
        previousAttempts: 0,
        featureReopenRate: 0,
      };
      expect(classifyComplexity(signals)).toBe('standard');
    });

    it('returns standard at fileCount=3 with all else trivial', () => {
      const signals: ComplexitySignals = {
        specLength: 100,
        fileCount: 3,
        dependencyCount: 0,
        previousAttempts: 0,
        featureReopenRate: 0,
      };
      expect(classifyComplexity(signals)).toBe('standard');
    });
  });

  // ============================================================================
  // Complex Overrides Trivial
  // ============================================================================

  describe('complex overrides trivial', () => {
    it('complex wins when both trivial and complex conditions could apply', () => {
      // specLength is trivial-range but previousAttempts triggers complex
      const signals: ComplexitySignals = {
        specLength: 100,
        fileCount: 1,
        dependencyCount: 0,
        previousAttempts: 3,
        featureReopenRate: 0,
      };
      expect(classifyComplexity(signals)).toBe('complex');
    });
  });

  // ============================================================================
  // Determinism
  // ============================================================================

  describe('determinism', () => {
    it('returns the same result for identical signals', () => {
      const signals: ComplexitySignals = {
        specLength: 1234,
        fileCount: 3,
        dependencyCount: 2,
        previousAttempts: 1,
        featureReopenRate: 0.15,
      };
      const results = Array.from({ length: 10 }, () => classifyComplexity(signals));
      expect(new Set(results).size).toBe(1);
    });
  });

  // ============================================================================
  // Return Type
  // ============================================================================

  describe('return type', () => {
    it('returns one of the three valid TaskComplexity values', () => {
      const validValues = new Set(['trivial', 'standard', 'complex']);
      expect(validValues.has(classifyComplexity(trivialSignals))).toBe(true);
      expect(validValues.has(classifyComplexity(standardSignals))).toBe(true);
      expect(validValues.has(classifyComplexity(complexSignals))).toBe(true);
    });
  });
});
