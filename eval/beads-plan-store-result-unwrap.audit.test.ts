/**
 * Audit: BeadsPlanStore.isApproved must properly unwrap Result<boolean> from hasWorkflowLabel.
 *
 * Bug: hasWorkflowLabel returns Result<boolean> (an object), but isApproved checked `!hasLabel`
 * which is always false because objects are truthy in JavaScript. This meant the 'approved' label
 * check was effectively bypassed — plans could be considered approved without the label, as long
 * as the epic description matched the plan content.
 *
 * Fix: Changed to `hasLabel.success === false || !hasLabel.value` to properly unwrap the Result.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';

describe('BeadsPlanStore.isApproved Result unwrap audit', () => {
  const storePath = 'packages/warcraft-core/src/services/state/beads-plan-store.ts';
  const source = fs.readFileSync(storePath, 'utf-8');

  it('should properly unwrap Result<boolean> from hasWorkflowLabel', () => {
    // Must check hasLabel.success and hasLabel.value, not just !hasLabel
    expect(source).toContain('hasLabel.success === false || !hasLabel.value');
  });

  it('should not use bare truthiness check on Result object', () => {
    // The bare `!hasLabel` check would always be false since objects are truthy
    expect(source).not.toMatch(/if\s*\(\s*!hasLabel\s*\)/);
  });
});
