/**
 * Audit: taskService.update() must centrally stamp preparedAt when transitioning to dispatch_prepared.
 *
 * Bug: taskService.update() centrally stamps startedAt (for in_progress) and completedAt (for done),
 * but did NOT stamp preparedAt for dispatch_prepared. The timestamp was instead set only by the
 * dispatch-coordinator in opencode-warcraft, using a Record<string, unknown> type widening trick
 * to pass it through transition() extras (whose type doesn't include preparedAt).
 *
 * This meant any future code path transitioning to dispatch_prepared without manually passing
 * preparedAt would leave the timestamp unset, breaking stale dispatch detection (doctor-tool,
 * context-tools) which relies on preparedAt to identify stuck tasks.
 *
 * Fix: add central preparedAt stamping in update(), matching the startedAt/completedAt pattern.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';

describe('taskService.update() central preparedAt stamping audit', () => {
  const taskServicePath = 'packages/warcraft-core/src/services/taskService.ts';
  const source = fs.readFileSync(taskServicePath, 'utf-8');

  it('should stamp preparedAt when transitioning to dispatch_prepared', () => {
    // The update() method must contain a check for dispatch_prepared → preparedAt,
    // analogous to the existing in_progress → startedAt and done → completedAt checks.
    expect(source).toContain("updates.status === 'dispatch_prepared'");
    expect(source).toContain('updated.preparedAt');
  });

  it('should follow the same guard pattern as startedAt and completedAt', () => {
    // The guard pattern is: only stamp if the current status doesn't already have the timestamp.
    // This prevents overwriting preparedAt on re-entrance (like startedAt is preserved).
    expect(source).toContain('!current.preparedAt');
  });

  it('should clear preparedAt when transitioning back to pending', () => {
    // The pending reset block should clear preparedAt (already existed before this fix).
    const pendingBlock = source.match(
      /if\s*\(updates\.status\s*===\s*'pending'\)\s*\{[\s\S]*?updated\.preparedAt\s*=\s*undefined/,
    );
    expect(pendingBlock).not.toBeNull();
  });
});
