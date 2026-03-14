/**
 * Audit: TaskStateArtifact must include preparedAt for beads-mode persistence.
 *
 * Bug: TaskStateArtifact interface and its encode/decode functions did NOT include
 * preparedAt. This caused preparedAt to be silently dropped during bead persistence
 * (taskStateFromTaskStatus strips unknown fields). In beads mode, stale dispatch
 * detection (doctor-tool, context-tools) would fail after process restart because
 * preparedAt wasn't round-tripped through the artifact schema.
 *
 * Filesystem mode was unaffected because it serializes the full TaskStatus object.
 *
 * Fix: Added preparedAt to TaskStateArtifact, LegacyTaskState, and all conversion
 * functions (taskStateFromTaskStatus, taskStateToTaskStatus, decodeTaskState legacy path).
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';

describe('TaskStateArtifact preparedAt round-trip audit', () => {
  const schemaPath = 'packages/warcraft-core/src/services/beads/artifactSchemas.ts';
  const source = fs.readFileSync(schemaPath, 'utf-8');

  it('should include preparedAt in TaskStateArtifact interface', () => {
    // The interface must have a preparedAt field for stale dispatch detection to survive bead round-trips
    expect(source).toMatch(/interface TaskStateArtifact[\s\S]*?preparedAt\?:\s*string/);
  });

  it('should copy preparedAt in taskStateFromTaskStatus', () => {
    // The encoder must not silently drop preparedAt
    const fromStatusFn = source.match(/function taskStateFromTaskStatus[\s\S]*?return\s*\{[\s\S]*?\}/);
    expect(fromStatusFn).not.toBeNull();
    expect(fromStatusFn![0]).toContain('preparedAt');
  });

  it('should copy preparedAt in taskStateToTaskStatus', () => {
    // The decoder must restore preparedAt into TaskStatus
    const toStatusFn = source.match(/function taskStateToTaskStatus[\s\S]*?return\s*\{[\s\S]*?\}/);
    expect(toStatusFn).not.toBeNull();
    expect(toStatusFn![0]).toContain('preparedAt');
  });

  it('should include preparedAt in legacy migration path', () => {
    // The legacy decoder must also migrate preparedAt
    expect(source).toMatch(/legacy\.preparedAt/);
  });
});
