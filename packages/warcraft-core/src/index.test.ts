import { describe, expect, it } from "bun:test";
import { getWarcraftPath } from "./utils/paths";
import { detectContext } from "./utils/detection";

describe("warcraft-core", () => {
  it("exports path helpers", () => {
    expect(getWarcraftPath("/tmp/project", "on")).toBe("/tmp/project/.beads/artifacts");
  });

  it("exports docs path for beadsMode off", () => {
    expect(getWarcraftPath('/tmp/project', 'off')).toBe('/tmp/project/docs');
  });

  it("detects worktree paths on Windows", () => {
    const result = detectContext("C:\\repo\\.beads/artifacts\\.worktrees\\feature-x\\01-task");

    expect(result.isWorktree).toBe(true);
    expect(result.feature).toBe("feature-x");
    expect(result.task).toBe("01-task");
    expect(result.projectRoot).toBe("C:/repo");
  });

  it('detects docs worktree paths on Windows', () => {
    const result = detectContext('C:\\repo\\docs\\.worktrees\\feature-x\\01-task');

    expect(result.isWorktree).toBe(true);
    expect(result.feature).toBe('feature-x');
    expect(result.task).toBe('01-task');
    expect(result.projectRoot).toBe('C:/repo');
  });
});
