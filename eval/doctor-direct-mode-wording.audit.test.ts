/**
 * Audit: DoctorTools should not treat direct mode as a degradation since it's a supported runtime path.
 *
 * The doctor tool's direct_mode_degradation check labels direct mode as "degradation"
 * and says "Worktree isolation is missing" — but direct mode is an intentional, supported
 * configuration, not a failure state.
 */
import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const DOCTOR_TOOL_PATH = path.resolve('packages/opencode-warcraft/src/tools/doctor-tool.ts');
const doctorToolSrc = fs.readFileSync(DOCTOR_TOOL_PATH, 'utf-8');

describe('DoctorTools direct-mode wording', () => {
  it('should not call direct mode a "degradation"', () => {
    // The check name and messaging should not frame direct mode as degraded
    expect(doctorToolSrc).not.toMatch(/direct_mode_degradation/);
  });

  it('should not say worktree isolation is "missing" for direct mode tasks', () => {
    expect(doctorToolSrc).not.toMatch(/[Ii]solation is missing/);
  });

  it('should not claim "All active tasks use worktree isolation" as the OK state', () => {
    // Direct mode is valid — the OK state should not claim all tasks are in worktree mode
    expect(doctorToolSrc).not.toMatch(/All active tasks use worktree isolation/);
  });
});
