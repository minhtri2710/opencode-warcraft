import { describe, expect, it } from 'bun:test';
import { resolveFeatureInput } from './tool-input.js';

describe('resolveFeatureInput', () => {
  it('returns a tagged validation error for invalid explicit features', () => {
    const result = resolveFeatureInput(() => 'ignored', '../bad');

    expect(result).toEqual({
      ok: false,
      error: 'feature: Name cannot contain path separators: "../bad"',
    });
  });

  it('returns the existing missing-feature error when nothing resolves', () => {
    const result = resolveFeatureInput(() => null);

    expect(result).toEqual({
      ok: false,
      error: 'No feature specified. Create a feature or provide feature param.',
    });
  });

  it('returns the resolved feature for valid explicit input', () => {
    const result = resolveFeatureInput((name) => name ?? null, 'valid-feature');

    expect(result).toEqual({ ok: true, feature: 'valid-feature' });
  });

  it('rethrows unexpected resolver failures', () => {
    expect(() =>
      resolveFeatureInput(() => {
        throw new Error('resolver exploded');
      }, 'valid-feature'),
    ).toThrow('resolver exploded');
  });
});
