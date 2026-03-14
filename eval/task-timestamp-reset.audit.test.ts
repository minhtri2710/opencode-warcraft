import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('taskService timestamp reset on pending transition', () => {
  const content = readFileSync(
    join(import.meta.dir, '..', 'packages', 'warcraft-core', 'src', 'services', 'taskService.ts'),
    'utf-8',
  );

  it('should clear startedAt when transitioning to pending', () => {
    // When a task is re-queued (cancelled → pending), the execution-cycle
    // timestamps must be reset so the next run gets fresh timestamps.
    expect(content).toMatch(/updates\.status\s*===\s*'pending'[\s\S]{0,200}startedAt\s*=\s*undefined/);
  });

  it('should clear completedAt when transitioning to pending', () => {
    expect(content).toMatch(/updates\.status\s*===\s*'pending'[\s\S]{0,200}completedAt\s*=\s*undefined/);
  });

  it('should clear preparedAt when transitioning to pending', () => {
    // dispatch_prepared → pending rollback should not leave stale preparedAt
    expect(content).toMatch(/updates\.status\s*===\s*'pending'[\s\S]{0,300}preparedAt\s*=\s*undefined/);
  });
});
