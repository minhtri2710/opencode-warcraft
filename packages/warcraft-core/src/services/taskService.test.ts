import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as child_process from "child_process";
import { TaskService, TASK_STATUS_SCHEMA_VERSION } from "./taskService";
import { BeadsRepository } from "./beads/BeadsRepository";
import { TaskStatus } from "../types";
import { getLockPath, readJson } from "../utils/paths";

const TEST_DIR = "/tmp/warcraft-core-taskservice-test-" + process.pid;
const PROJECT_ROOT = TEST_DIR;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}


function createRepository(mode: 'on' | 'off' = 'off'): BeadsRepository {
  return new BeadsRepository(PROJECT_ROOT, {}, mode);
}

function setupFeature(featureName: string): void {
  const featurePath = path.join(TEST_DIR, "docs", featureName);
  fs.mkdirSync(featurePath, { recursive: true });

  // Create a minimal feature.json
  fs.writeFileSync(
    path.join(featurePath, "feature.json"),
    JSON.stringify({
      name: featureName,
      epicBeadId: "bd-epic-test",
      status: "executing",
      createdAt: new Date().toISOString(),
    })
  );

  // Create plan.md with a task
  fs.writeFileSync(
    path.join(featurePath, "plan.md"),
    `# Plan\n\n### 1. Test Task\n\nDescription of the test task.\n`
  );
}

function setupTask(featureName: string, taskFolder: string, status: Partial<TaskStatus> = {}): void {
  const taskPath = path.join(TEST_DIR, ".beads/artifacts", featureName, "tasks", taskFolder);
  fs.mkdirSync(taskPath, { recursive: true });

  const taskStatus: TaskStatus = {
    status: "pending",
    origin: "plan",
    planTitle: "Test Task",
    ...status,
  };

  fs.writeFileSync(path.join(taskPath, "status.json"), JSON.stringify(taskStatus, null, 2));
}

describe("TaskService", () => {
  let service: TaskService;
  let execFileSyncSpy: ReturnType<typeof spyOn>;
  let childCounter = 0;

  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const beadsArtifactsPath = path.join(TEST_DIR, '.beads', 'artifacts');
    fs.mkdirSync(beadsArtifactsPath, { recursive: true });
    const docsPath = path.join(TEST_DIR, 'docs');
    if (!fs.existsSync(docsPath)) {
      fs.symlinkSync(beadsArtifactsPath, docsPath, 'dir');
    }
    childCounter = 0;
    execFileSyncSpy = spyOn(child_process, 'execFileSync').mockImplementation((...execArgs: any[]) => {
      const [command, args] = execArgs;
      if (command !== 'br') {
        throw new Error(`Unexpected command: ${String(command)}`);
      }
      const argList = Array.isArray(args) ? args.map(String) : [];
      if (argList[0] === '--version') {
        return 'beads_rust 1.2.3' as any;
      }
      if (argList[0] === 'create') {
        childCounter += 1;
        return JSON.stringify({ id: `bd-task-${childCounter}` }) as any;
      }
      if (argList[0] === 'update' || argList[0] === 'close') {
        return '' as any;
      }
      if (argList[0] === 'show') {
        return JSON.stringify({ description: '' }) as any;
      }
      if (argList[0] === 'sync') {
        // Handle sync --flush-only and sync --import-only
        return '' as any;
      }
      if (argList[0] === 'list') {
        // Return epic list for getEpicByFeatureName and task list for listFromBeads
        if (argList.includes('--type') && argList[argList.indexOf('--type') + 1] === 'epic') {
          return JSON.stringify([{ id: 'bd-epic-test', title: 'test-feature', type: 'epic', status: 'open' }]) as any;
        }
        // Task listing: return empty by default (tests override with spies)
        return JSON.stringify([]) as any;
      }
      throw new Error(`Unexpected br args: ${argList.join(' ')}`);
    });
    service = new TaskService(PROJECT_ROOT, createRepository());
  });

  afterEach(() => {
    execFileSyncSpy.mockRestore();
    cleanup();
  });

  describe("update", () => {
    it("updates task status with locked atomic write", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task");

      const result = service.update(featureName, "01-test-task", {
        status: "in_progress",
      });

      expect(result.status).toBe("in_progress");
      expect(result.startedAt).toBeDefined();
      expect(result.schemaVersion).toBe(TASK_STATUS_SCHEMA_VERSION);

      // Verify no lock file remains
      const statusPath = path.join(
        TEST_DIR,
        ".beads/artifacts",
        featureName,
        "tasks",
        "01-test-task",
        "status.json"
      );
      expect(fs.existsSync(getLockPath(statusPath))).toBe(false);
    });

    it("sets completedAt when status is done", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", { startedAt: new Date().toISOString() });

      const result = service.update(featureName, "01-test-task", {
        status: "done",
        summary: "Task completed successfully",
      });

      expect(result.status).toBe("done");
      expect(result.completedAt).toBeDefined();
      expect(result.summary).toBe("Task completed successfully");
    });

    it("throws error for non-existent task", () => {
      const featureName = "test-feature";
      setupFeature(featureName);

      expect(() =>
        service.update(featureName, "nonexistent-task", { status: "in_progress" })
      ).toThrow(/not found/);
    });

    it("preserves existing fields on update", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", {
        planTitle: "Original Title",
        baseCommit: "abc123",
      });

      const result = service.update(featureName, "01-test-task", {
        status: "in_progress",
      });

      expect(result.planTitle).toBe("Original Title");
      expect(result.baseCommit).toBe("abc123");
    });
  });

  describe("patchBackgroundFields", () => {
    it("patches only background-owned fields", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", {
        status: "in_progress",
        summary: "Working on it",
      });

      const result = service.patchBackgroundFields(featureName, "01-test-task", {
        idempotencyKey: "key-123",
        workerSession: {
          sessionId: "session-abc",
          agent: "forager",
          mode: "delegate",
        },
      });

      // Background fields updated
      expect(result.idempotencyKey).toBe("key-123");
      expect(result.workerSession?.sessionId).toBe("session-abc");
      expect(result.workerSession?.agent).toBe("forager");
      expect(result.workerSession?.mode).toBe("delegate");

      // Completion-owned fields preserved
      expect(result.status).toBe("in_progress");
      expect(result.summary).toBe("Working on it");
    });

    it("deep merges workerSession fields", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", {
        workerSession: {
          sessionId: "session-abc",
          attempt: 1,
          messageCount: 5,
        },
      });

      // Use off-mode service: setupTask writes to local filesystem,
      // and getRawStatus in on-mode reads from bead state (which has no patched session).
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });

      // Patch only lastHeartbeatAt
      offModeService.patchBackgroundFields(featureName, "01-test-task", {
        workerSession: {
          lastHeartbeatAt: "2025-01-23T00:00:00Z",
        } as any,
      });

      const result = offModeService.getRawStatus(featureName, "01-test-task");

      // Original workerSession fields preserved
      expect(result?.workerSession?.sessionId).toBe("session-abc");
      expect(result?.workerSession?.attempt).toBe(1);
      expect(result?.workerSession?.messageCount).toBe(5);
      // New field added
      expect(result?.workerSession?.lastHeartbeatAt).toBe("2025-01-23T00:00:00Z");
    });

    it("does not clobber completion-owned fields", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", {
        status: "done",
        summary: "Completed successfully",
        completedAt: "2025-01-22T00:00:00Z",
      });

      // Background patch should not touch these
      service.patchBackgroundFields(featureName, "01-test-task", {
        workerSession: { sessionId: "new-session" },
      });

      const result = service.getRawStatus(featureName, "01-test-task");

      expect(result?.status).toBe("done");
      expect(result?.summary).toBe("Completed successfully");
      expect(result?.completedAt).toBe("2025-01-22T00:00:00Z");
    });

    it("sets schemaVersion on patch", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task");

      const result = service.patchBackgroundFields(featureName, "01-test-task", {
        idempotencyKey: "key-456",
      });

      expect(result.schemaVersion).toBe(TASK_STATUS_SCHEMA_VERSION);
    });

    it("releases lock after patch", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task");

      service.patchBackgroundFields(featureName, "01-test-task", {
        idempotencyKey: "test",
      });

      const statusPath = path.join(
        TEST_DIR,
        ".beads/artifacts",
        featureName,
        "tasks",
        "01-test-task",
        "status.json"
      );
      expect(fs.existsSync(getLockPath(statusPath))).toBe(false);
    });
  });

  describe("getRawStatus", () => {
    it("returns full TaskStatus including new fields", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", {
        schemaVersion: 1,
        idempotencyKey: "key-789",
        workerSession: {
          sessionId: "session-xyz",
          taskId: "bg-task-1",
          agent: "forager",
          mode: "delegate",
          attempt: 2,
        },
      });

      const result = service.getRawStatus(featureName, "01-test-task");

      expect(result).not.toBeNull();
      expect(result?.schemaVersion).toBe(1);
      expect(result?.idempotencyKey).toBe("key-789");
      expect(result?.workerSession?.sessionId).toBe("session-xyz");
      expect(result?.workerSession?.taskId).toBe("bg-task-1");
      expect(result?.workerSession?.agent).toBe("forager");
      expect(result?.workerSession?.mode).toBe("delegate");
      expect(result?.workerSession?.attempt).toBe(2);
    });

    it("returns null for non-existent task", () => {
      const featureName = "test-feature";
      setupFeature(featureName);

      const result = service.getRawStatus(featureName, "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("dependsOn field", () => {
    it("existing tasks without dependsOn continue to load and display", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      // Create task without dependsOn (current format)
      setupTask(featureName, "01-test-task", {
        status: "pending",
        planTitle: "Test Task",
        // No dependsOn field
      });

      const result = service.getRawStatus(featureName, "01-test-task");

      expect(result).not.toBeNull();
      expect(result?.status).toBe("pending");
      expect(result?.planTitle).toBe("Test Task");
      // dependsOn should be undefined for current tasks
      expect(result?.dependsOn).toBeUndefined();
    });

    it("tasks with dependsOn array load correctly", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "02-dependent-task", {
        status: "pending",
        planTitle: "Dependent Task",
        dependsOn: ["01-setup", "01-core-api"],
      });

      const result = service.getRawStatus(featureName, "02-dependent-task");

      expect(result).not.toBeNull();
      expect(result?.dependsOn).toEqual(["01-setup", "01-core-api"]);
    });

    it("preserves dependsOn field on update", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "02-dependent-task", {
        status: "pending",
        dependsOn: ["01-setup"],
      });

      const result = service.update(featureName, "02-dependent-task", {
        status: "in_progress",
      });

      expect(result.status).toBe("in_progress");
      expect(result.dependsOn).toEqual(["01-setup"]);
    });

    it("handles empty dependsOn array", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-independent-task", {
        status: "pending",
        dependsOn: [],
      });

      const result = service.getRawStatus(featureName, "01-independent-task");

      expect(result).not.toBeNull();
      expect(result?.dependsOn).toEqual([]);
    });
  });

  describe("sync() - dependency parsing", () => {
    it("parses explicit Depends on: annotations and resolves to folder names (off-mode)", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Plan with explicit dependencies
      const planContent = `# Plan

### 1. Setup Base

Base setup task.

### 2. Build Core

**Depends on**: 1

Build the core module.

### 3. Build UI

**Depends on**: 1, 2

Build the UI layer.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      // Use off-mode service to test local file creation
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });
      const result = offModeService.sync(featureName);

      expect(result.created).toContain("01-setup-base");
      expect(result.created).toContain("02-build-core");
      expect(result.created).toContain("03-build-ui");

      // Check status.json for dependencies
      const task1Status = offModeService.getRawStatus(featureName, "01-setup-base");
      const task2Status = offModeService.getRawStatus(featureName, "02-build-core");
      const task3Status = offModeService.getRawStatus(featureName, "03-build-ui");

      // Task 1 has no dependencies (first task, implicit none)
      expect(task1Status?.dependsOn).toEqual([]);

      // Task 2 depends on task 1
      expect(task2Status?.dependsOn).toEqual(["01-setup-base"]);

      // Task 3 depends on tasks 1 and 2
      expect(task3Status?.dependsOn).toEqual(["01-setup-base", "02-build-core"]);
    });

    it("parses Depends on: none and produces empty dependency list (off-mode)", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      const planContent = `# Plan

### 1. Independent Task A

**Depends on**: none

Can run independently.

### 2. Independent Task B

Depends on: none

Also independent.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      // Use off-mode service to test local file creation
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });
      const result = offModeService.sync(featureName);

      const task1Status = offModeService.getRawStatus(featureName, "01-independent-task-a");
      const task2Status = offModeService.getRawStatus(featureName, "02-independent-task-b");

      expect(task1Status?.dependsOn).toEqual([]);
      expect(task2Status?.dependsOn).toEqual([]);
    });

    it("applies implicit sequential dependencies when Depends on: is missing (off-mode)", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Plan without any dependency annotations - should use implicit sequential
      const planContent = `# Plan

### 1. First Task

Do the first thing.

### 2. Second Task

Do the second thing.

### 3. Third Task

Do the third thing.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      // Use off-mode service to test local file creation
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });
      const result = offModeService.sync(featureName);

      const task1Status = offModeService.getRawStatus(featureName, "01-first-task");
      const task2Status = offModeService.getRawStatus(featureName, "02-second-task");
      const task3Status = offModeService.getRawStatus(featureName, "03-third-task");

      // Task 1 - no dependencies (first task)
      expect(task1Status?.dependsOn).toEqual([]);

      // Task 2 - implicit dependency on task 1
      expect(task2Status?.dependsOn).toEqual(["01-first-task"]);

      // Task 3 - implicit dependency on task 2
      expect(task3Status?.dependsOn).toEqual(["02-second-task"]);
    });

    it("stores generated spec in the main task bead", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      const planContent = `# Plan

### 1. Setup

Setup task.

### 2. Build

**Depends on**: 1

Build task.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      service.sync(featureName);

      expect(execFileSyncSpy).toHaveBeenCalledWith(
        'br',
        expect.arrayContaining(['update', expect.any(String), '--description', expect.any(String)]),
        expect.objectContaining({ cwd: TEST_DIR })
      );
    });

    it("stores spec in the main task bead when dependencies are explicitly none", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      const planContent = `# Plan

### 1. Independent Task

**Depends on**: none

Independent task.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      service.sync(featureName);

      expect(execFileSyncSpy).toHaveBeenCalledWith(
        'br',
        expect.arrayContaining(['update', expect.any(String), '--description', expect.any(String)]),
        expect.objectContaining({ cwd: TEST_DIR })
      );
    });

    it("handles mixed explicit and implicit dependencies (off-mode)", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      const planContent = `# Plan

### 1. Base

Base task.

### 2. Core

No dependency annotation - implicit sequential.

### 3. UI

**Depends on**: 1

Explicitly depends only on 1, not 2.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      // Use off-mode service to test local file creation
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });
      offModeService.sync(featureName);

      const task1Status = offModeService.getRawStatus(featureName, "01-base");
      const task2Status = offModeService.getRawStatus(featureName, "02-core");
      const task3Status = offModeService.getRawStatus(featureName, "03-ui");

      // Task 1 - no dependencies
      expect(task1Status?.dependsOn).toEqual([]);

      // Task 2 - implicit dependency on task 1
      expect(task2Status?.dependsOn).toEqual(["01-base"]);

      // Task 3 - explicit dependency on task 1 only (not 2)
      expect(task3Status?.dependsOn).toEqual(["01-base"]);
    });
  });

  describe("sync() - dependency validation", () => {
    it("throws error for unknown task numbers in dependencies", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Task 2 depends on non-existent task 99
      const planContent = `# Plan

### 1. First Task

First task description.

### 2. Second Task

**Depends on**: 1, 99

Second task depends on unknown task 99.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      expect(() => service.sync(featureName)).toThrow(/unknown task number.*99/i);
    });

    it("throws error for self-dependency", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Task 2 depends on itself
      const planContent = `# Plan

### 1. First Task

First task description.

### 2. Self Referential Task

**Depends on**: 2

This task depends on itself.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      expect(() => service.sync(featureName)).toThrow(/self-dependency.*task 2/i);
    });

    it("throws error for cyclic dependencies (simple A->B->A)", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Task 1 depends on task 2, task 2 depends on task 1
      const planContent = `# Plan

### 1. Task A

**Depends on**: 2

Task A depends on B.

### 2. Task B

**Depends on**: 1

Task B depends on A.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      expect(() => service.sync(featureName)).toThrow(/cycle.*1.*2/i);
    });

    it("throws error for cyclic dependencies (longer chain A->B->C->A)", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Cycle: 1->2->3->1
      const planContent = `# Plan

### 1. Task A

**Depends on**: 3

Task A depends on C.

### 2. Task B

**Depends on**: 1

Task B depends on A.

### 3. Task C

**Depends on**: 2

Task C depends on B.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      expect(() => service.sync(featureName)).toThrow(/cycle/i);
    });

    it("error message for unknown deps points to plan.md", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      const planContent = `# Plan

### 1. Only Task

**Depends on**: 5

Depends on non-existent task 5.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      expect(() => service.sync(featureName)).toThrow(/plan\.md/i);
    });

    it("error message for cycle points to plan.md", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      const planContent = `# Plan

### 1. Task A

**Depends on**: 2

Cycle with B.

### 2. Task B

**Depends on**: 1

Cycle with A.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      expect(() => service.sync(featureName)).toThrow(/plan\.md/i);
    });

    it("accepts valid dependency graphs without cycles", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Valid DAG: 1 <- 2, 1 <- 3, 2 <- 4, 3 <- 4
      const planContent = `# Plan

### 1. Base

**Depends on**: none

Base task.

### 2. Left Branch

**Depends on**: 1

Left branch.

### 3. Right Branch

**Depends on**: 1

Right branch.

### 4. Merge

**Depends on**: 2, 3

Merge both branches.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      // Should not throw
      const result = service.sync(featureName);
      expect(result.created).toContain("01-base");
      expect(result.created).toContain("02-left-branch");
      expect(result.created).toContain("03-right-branch");
      expect(result.created).toContain("04-merge");
    });
  });

  describe("concurrent access safety", () => {
    it("handles rapid sequential updates without corruption", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task");

      // Use off-mode service: setupTask writes to local filesystem,
      // and on-mode reads from bead state which doesn't reflect local patches.
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });

      // Rapid sequential updates
      for (let i = 0; i < 10; i++) {
        offModeService.patchBackgroundFields(featureName, "01-test-task", {
          workerSession: {
            sessionId: "session-1",
            messageCount: i,
          } as any,
        });
      }

      const result = offModeService.getRawStatus(featureName, "01-test-task");

      // Last write wins
      expect(result?.workerSession?.messageCount).toBe(9);
      // File should be valid JSON
      const statusPath = path.join(
        TEST_DIR,
        ".beads/artifacts",
        featureName,
        "tasks",
        "01-test-task",
        "status.json"
      );
      expect(() => JSON.parse(fs.readFileSync(statusPath, "utf-8"))).not.toThrow();
    });
  });

  describe("sync() - dependency parsing edge cases", () => {
    it("handles whitespace variations in Depends on line (off-mode)", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Whitespace variations: extra spaces, tabs, etc.
      const planContent = `# Plan

### 1. Base Task

Base task.

### 2. Task With Spaces

**Depends on**:   1

Task with extra spaces after colon.

### 3. Task With Comma Spaces

**Depends on**: 1 , 2

Task with spaces around comma.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      // Use off-mode service to test local file creation
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });
      const result = offModeService.sync(featureName);

      expect(result.created).toContain("01-base-task");
      expect(result.created).toContain("02-task-with-spaces");
      expect(result.created).toContain("03-task-with-comma-spaces");

      const task2Status = offModeService.getRawStatus(featureName, "02-task-with-spaces");
      const task3Status = offModeService.getRawStatus(featureName, "03-task-with-comma-spaces");

      expect(task2Status?.dependsOn).toEqual(["01-base-task"]);
      expect(task3Status?.dependsOn).toEqual(["01-base-task", "02-task-with-spaces"]);
    });

    it("handles non-bold Depends on format (off-mode)", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Non-bold format
      const planContent = `# Plan

### 1. First

First task.

### 2. Second

Depends on: 1

Second depends on first (non-bold format).
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      // Use off-mode service to test local file creation
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });
      const result = offModeService.sync(featureName);

      const task2Status = offModeService.getRawStatus(featureName, "02-second");
      expect(task2Status?.dependsOn).toEqual(["01-first"]);
    });

    it("handles case insensitive none keyword (off-mode)", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // "None" with capital N
      const planContent = `# Plan

### 1. Independent Task

**Depends on**: None

Independent task with capital None.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      // Use off-mode service to test local file creation
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });
      const result = offModeService.sync(featureName);

      const task1Status = offModeService.getRawStatus(featureName, "01-independent-task");
      expect(task1Status?.dependsOn).toEqual([]);
    });
  });

  describe("sync() - dependency validation edge cases", () => {
    it("allows forward dependencies (later task depending on earlier)", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Normal forward dependency
      const planContent = `# Plan

### 1. Foundation

**Depends on**: none

Foundation task.

### 2. Build

**Depends on**: 1

Build depends on foundation.

### 3. Test

**Depends on**: 2

Test depends on build.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      // Should not throw
      const result = service.sync(featureName);
      expect(result.created.length).toBe(3);
    });

    it("throws error for diamond with cycle", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Diamond with cycle: 1->2, 1->3, 2->4, 3->4, 4->1
      const planContent = `# Plan

### 1. Start

**Depends on**: 4

Start depends on end (creates cycle).

### 2. Left

**Depends on**: 1

Left branch.

### 3. Right

**Depends on**: 1

Right branch.

### 4. End

**Depends on**: 2, 3

End depends on both branches.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      expect(() => service.sync(featureName)).toThrow(/cycle/i);
    });

    it("provides clear error for multiple unknown dependencies", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      // Multiple unknown task numbers
      const planContent = `# Plan

### 1. Only Task

**Depends on**: 5, 10, 99

Depends on multiple non-existent tasks.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      expect(() => service.sync(featureName)).toThrow(/unknown.*task/i);
    });
  });

  describe("buildSpecData - structured data generation", () => {
    it("returns structured SpecData with all required fields", () => {
      const featureName = "test-feature";
      const planContent = `# Plan

### 1. Test Task

Description of the test task.
`;

      const result = service.buildSpecData({
        featureName,
        task: { folder: "01-test-task", name: "Test Task", order: 1 },
        dependsOn: [],
        allTasks: [{ folder: "01-test-task", name: "Test Task", order: 1 }],
        planContent,
        contextFiles: [],
        completedTasks: [],
      });

      expect(result.featureName).toBe(featureName);
      expect(result.task.folder).toBe("01-test-task");
      expect(result.task.name).toBe("Test Task");
      expect(result.task.order).toBe(1);
      expect(result.dependsOn).toEqual([]);
      expect(result.allTasks).toHaveLength(1);
      expect(result.planSection).toContain("Test Task");
      expect(result.contextFiles).toEqual([]);
      expect(result.completedTasks).toEqual([]);
    });

    it("includes dependencies in dependsOn", () => {
      const featureName = "test-feature";
      const planContent = `# Plan

### 1. First Task

First description.

### 2. Second Task

**Depends on**: 1

Second description.
`;

      const result = service.buildSpecData({
        featureName,
        task: { folder: "02-second-task", name: "Second Task", order: 2 },
        dependsOn: ["01-first-task"],
        allTasks: [
          { folder: "01-first-task", name: "First Task", order: 1 },
          { folder: "02-second-task", name: "Second Task", order: 2 },
        ],
        planContent,
      });

      expect(result.dependsOn).toEqual(["01-first-task"]);
    });

    it("extracts correct plan section for the task", () => {
      const featureName = "test-feature";
      const planContent = `# Plan

### 1. Setup

Setup the environment.

### 2. Build

Build the project.

### 3. Test

Run tests.
`;

      const result = service.buildSpecData({
        featureName,
        task: { folder: "02-build", name: "Build", order: 2 },
        dependsOn: ["01-setup"],
        allTasks: [
          { folder: "01-setup", name: "Setup", order: 1 },
          { folder: "02-build", name: "Build", order: 2 },
          { folder: "03-test", name: "Test", order: 3 },
        ],
        planContent,
      });

      expect(result.planSection).toContain("Build");
      expect(result.planSection).toContain("Build the project");
      expect(result.planSection).not.toContain("Setup");
      expect(result.planSection).not.toContain("Run tests");
    });

    it("returns null planSection when task not found in plan", () => {
      const featureName = "test-feature";
      const planContent = `# Plan

### 1. Only Task

Only task description.
`;

      const result = service.buildSpecData({
        featureName,
        task: { folder: "99-missing-task", name: "Missing Task", order: 99 },
        dependsOn: [],
        allTasks: [{ folder: "99-missing-task", name: "Missing Task", order: 99 }],
        planContent,
      });

      expect(result.planSection).toBeNull();
    });

    it("includes context files in SpecData", () => {
      const featureName = "test-feature";
      const planContent = `# Plan

### 1. Test Task

Description.
`;

      const contextFiles = [
        { name: "notes.md", content: "# Notes\nSome notes" },
        { name: "config.json", content: '{"key": "value"}' },
      ];

      const result = service.buildSpecData({
        featureName,
        task: { folder: "01-test-task", name: "Test Task", order: 1 },
        dependsOn: [],
        allTasks: [{ folder: "01-test-task", name: "Test Task", order: 1 }],
        planContent,
        contextFiles,
      });

      expect(result.contextFiles).toEqual(contextFiles);
    });

    it("includes completed tasks in SpecData", () => {
      const featureName = "test-feature";
      const planContent = `# Plan

### 1. Test Task

Description.
`;

      const completedTasks = [
        { name: "01-previous-task", summary: "Previous work done" },
        { name: "02-another-task", summary: "Another task completed" },
      ];

      const result = service.buildSpecData({
        featureName,
        task: { folder: "03-test-task", name: "Test Task", order: 3 },
        dependsOn: ["01-previous-task", "02-another-task"],
        allTasks: [
          { folder: "01-previous-task", name: "Previous Task", order: 1 },
          { folder: "02-another-task", name: "Another Task", order: 2 },
          { folder: "03-test-task", name: "Test Task", order: 3 },
        ],
        planContent,
        completedTasks,
      });

      expect(result.completedTasks).toEqual(completedTasks);
    });

    it("handles optional parameters with defaults", () => {
      const featureName = "test-feature";

      const result = service.buildSpecData({
        featureName,
        task: { folder: "01-test-task", name: "Test Task", order: 1 },
        dependsOn: [],
        allTasks: [{ folder: "01-test-task", name: "Test Task", order: 1 }],
        // No planContent, contextFiles, or completedTasks provided
      });

      expect(result.planSection).toBeNull();
      expect(result.contextFiles).toEqual([]);
      expect(result.completedTasks).toEqual([]);
    });
  });

  describe("buildSpecContent - task type inference", () => {
    it("should infer greenfield type when plan section has only Create: files", () => {
      const featureName = "test-feature";
      const planContent = `# Plan

### 1. Greenfield Task

**Depends on**: none

**Files:**
- Create: \`packages/warcraft-core/src/new-module.ts\`

Create the new module.
`;

      const specContent = service.buildSpecContent({
        featureName,
        task: { folder: "01-greenfield-task", name: "Greenfield Task", order: 1 },
        dependsOn: [],
        allTasks: [{ folder: "01-greenfield-task", name: "Greenfield Task", order: 1 }],
        planContent,
      });

      expect(specContent).toContain("## Task Type");
      expect(specContent).toContain("greenfield");
    });

    it("should infer testing type when plan section has only Test: files", () => {
      const featureName = "test-feature";
      const planContent = `# Plan

### 1. Coverage Update

**Depends on**: none

**Files:**
- Test: \`packages/warcraft-core/src/services/taskService.test.ts\`

Add coverage for task specs.
`;

      const specContent = service.buildSpecContent({
        featureName,
        task: { folder: "01-coverage-update", name: "Coverage Update", order: 1 },
        dependsOn: [],
        allTasks: [{ folder: "01-coverage-update", name: "Coverage Update", order: 1 }],
        planContent,
      });

      expect(specContent).toContain("## Task Type");
      expect(specContent).toContain("testing");
    });

    it("should infer modification type when plan section has Modify: files", () => {
      const featureName = "test-feature";
      const planContent = `# Plan

### 1. Update Worker Prompt

**Depends on**: none

**Files:**
- Modify: \`packages/opencode-warcraft/src/agents/forager.ts\`

Update prompt copy.
`;

      const specContent = service.buildSpecContent({
        featureName,
        task: { folder: "01-update-worker-prompt", name: "Update Worker Prompt", order: 1 },
        dependsOn: [],
        allTasks: [{ folder: "01-update-worker-prompt", name: "Update Worker Prompt", order: 1 }],
        planContent,
      });

      expect(specContent).toContain("## Task Type");
      expect(specContent).toContain("modification");
    });

    it("should omit task type when no inference signal is present", () => {
      const featureName = "test-feature";
      const planContent = `# Plan

### 1. Align Docs

**Depends on**: none

Align documentation wording.
`;

      const specContent = service.buildSpecContent({
        featureName,
        task: { folder: "01-align-docs", name: "Align Docs", order: 1 },
        dependsOn: [],
        allTasks: [{ folder: "01-align-docs", name: "Align Docs", order: 1 }],
        planContent,
      });

      expect(specContent).not.toContain("## Task Type");
    });
  });

  describe("import/flush lifecycle", () => {
    it("calls importArtifacts before readTaskBeadArtifact when beadsMode is on", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", { beadId: "bd-task-1" });

      // Create a new service with beadsMode on
      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });

      // Spy on importArtifacts
      const importSpy = spyOn((onModeService as any).repository.getGateway(), "importArtifacts").mockImplementation(() => {});
      const readArtifactSpy = spyOn((onModeService as any).repository.getGateway(), "readArtifact").mockReturnValue("spec content");

      const result = onModeService.readTaskBeadArtifact(featureName, "01-test-task", "spec");

      expect(importSpy).toHaveBeenCalled();
      expect(readArtifactSpy).toHaveBeenCalledWith("bd-task-1", "spec");
      expect(result).toBe("spec content");

      importSpy.mockRestore();
      readArtifactSpy.mockRestore();
    });

    it("does not call importArtifacts when beadsMode is off", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", { beadId: "bd-task-1" });

      // Create a new service with beadsMode off
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });

      // Spy on importArtifacts
      const importSpy = spyOn((offModeService as any).repository, "importArtifacts").mockImplementation(() => ({ success: true, value: undefined }));
      const readArtifactSpy = spyOn((offModeService as any).repository, "readTaskArtifact").mockReturnValue({ success: true, value: null });

      const result = offModeService.readTaskBeadArtifact(featureName, "01-test-task", "spec");

      expect(importSpy).not.toHaveBeenCalled();
      expect(readArtifactSpy).toHaveBeenCalledWith("bd-task-1", "spec");
      expect(result).toBeNull();

      importSpy.mockRestore();
      readArtifactSpy.mockRestore();
    });

    it("calls flushArtifacts after update when status changes and beadsMode is on", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", { beadId: "bd-task-1", status: "pending" });

      // Create a new service with beadsMode on
      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });

      // Spy on flushArtifacts
      const flushSpy = spyOn((onModeService as any).repository.getGateway(), "flushArtifacts").mockImplementation(() => {});
      const syncStatusSpy = spyOn((onModeService as any).repository.getGateway(), "syncTaskStatus").mockImplementation(() => {});

      const result = onModeService.update(featureName, "01-test-task", { status: "in_progress" });

      expect(syncStatusSpy).toHaveBeenCalledWith("bd-task-1", "in_progress");
      expect(flushSpy).toHaveBeenCalled();
      expect(result.status).toBe("in_progress");

      flushSpy.mockRestore();
      syncStatusSpy.mockRestore();
    });

    it("does not call flushArtifacts when status is unchanged", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", { beadId: "bd-task-1", status: "pending" });

      // Create a new service with beadsMode on
      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });

      // Spy on flushArtifacts
      const flushSpy = spyOn((onModeService as any).repository.getGateway(), "flushArtifacts").mockImplementation(() => {});

      // Update without changing status
      const result = onModeService.update(featureName, "01-test-task", { summary: "Updated summary" });

      expect(flushSpy).not.toHaveBeenCalled();
      expect(result.summary).toBe("Updated summary");

      flushSpy.mockRestore();
    });

    it("calls flushArtifacts after upsertTaskBeadArtifact when beadsMode is on", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", { beadId: "bd-task-1" });

      // Create a new service with beadsMode on
      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });

      // Spy on flushArtifacts
      const flushSpy = spyOn((onModeService as any).repository.getGateway(), "flushArtifacts").mockImplementation(() => {});
      const upsertSpy = spyOn((onModeService as any).repository.getGateway(), "upsertArtifact").mockImplementation(() => {});

      const beadId = onModeService.upsertTaskBeadArtifact(featureName, "01-test-task", "spec", "spec content");

      expect(upsertSpy).toHaveBeenCalledWith("bd-task-1", "spec", "spec content");
      expect(flushSpy).toHaveBeenCalled();
      expect(beadId).toBe("bd-task-1");

      flushSpy.mockRestore();
      upsertSpy.mockRestore();
    });

    it("does not call flushArtifacts in upsertTaskBeadArtifact when beadsMode is off", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", { beadId: "bd-task-1" });

      // Create a new service with beadsMode off
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });

      // Spy on flushArtifacts
      const flushSpy = spyOn((offModeService as any).repository, "flushArtifacts").mockImplementation(() => ({ success: true, value: undefined }));
      const upsertSpy = spyOn((offModeService as any).repository, "upsertTaskArtifact").mockImplementation(() => ({ success: true, value: undefined }));

      const beadId = offModeService.upsertTaskBeadArtifact(featureName, "01-test-task", "spec", "spec content");

      expect(upsertSpy).toHaveBeenCalledWith("bd-task-1", "spec", "spec content");
      expect(flushSpy).not.toHaveBeenCalled();
      expect(beadId).toBe("bd-task-1");

      flushSpy.mockRestore();
      upsertSpy.mockRestore();
    });
  });

  describe("writeReport - beadsMode integration", () => {
    it("writes report to bead artifact only (no filesystem) when beadsMode is on", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", { beadId: "bd-task-1" });

      // Create mock repository
      const mockRepository = {
        upsertTaskArtifact: () => ({ success: true, value: undefined }),
        flushArtifacts: () => ({ success: true, value: undefined }),
        importArtifacts: () => ({ success: true, value: undefined }),
        readTaskArtifact: () => ({ success: true, value: null }),
        getGateway: () => ({ list: () => [], readArtifact: () => null }),
        getEpicByFeatureName: () => ({ success: true, value: "bd-epic-test" }),
        listTaskBeadsForEpic: () => ({ success: true, value: [] }),
        getRobotPlan: () => null,
      };
      const upsertSpy = spyOn(mockRepository, "upsertTaskArtifact").mockImplementation(() => ({ success: true, value: undefined }));
      const flushSpy = spyOn(mockRepository, "flushArtifacts").mockImplementation(() => ({ success: true, value: undefined }));

      // Create service with beadsMode on and mock repository
      const onModeService = new TaskService(PROJECT_ROOT, mockRepository as any, { getBeadsMode: () => "on" });

      const reportContent = "# Task Report\n\nCompleted successfully.";
      const reportPath = onModeService.writeReport(featureName, "01-test-task", reportContent);

      // In on-mode, report is NOT written to filesystem (only bead artifacts)
      expect(fs.existsSync(reportPath)).toBe(false);

      // Verify bead artifact was upserted and flushed
      expect(upsertSpy).toHaveBeenCalledWith("bd-task-1", "report", reportContent);
      expect(flushSpy).toHaveBeenCalled();

      // Verify a virtual path is still returned
      expect(reportPath).toContain("01-test-task");

      upsertSpy.mockRestore();
      flushSpy.mockRestore();
    });

    it("writes report to filesystem only when beadsMode is off", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test-task", { beadId: "bd-task-1" });

      // Create mock repository
      const mockRepository = {
        upsertTaskArtifact: () => ({ success: true, value: undefined }),
        flushArtifacts: () => ({ success: true, value: undefined }),
        importArtifacts: () => ({ success: true, value: undefined }),
        readTaskArtifact: () => ({ success: true, value: null }),
        getGateway: () => ({ list: () => [], readArtifact: () => null }),
        getEpicByFeatureName: () => ({ success: true, value: "bd-epic-test" }),
        listTaskBeadsForEpic: () => ({ success: true, value: [] }),
        getRobotPlan: () => null,
      };
      const upsertSpy = spyOn(mockRepository, "upsertTaskArtifact").mockImplementation(() => ({ success: true, value: undefined }));
      const flushSpy = spyOn(mockRepository, "flushArtifacts").mockImplementation(() => ({ success: true, value: undefined }));

      // Create service with beadsMode off and mock repository
      const offModeService = new TaskService(PROJECT_ROOT, mockRepository as any, { getBeadsMode: () => "off" });

      const reportContent = "# Task Report\n\nCompleted successfully.";
      const reportPath = offModeService.writeReport(featureName, "01-test-task", reportContent);

      // Verify filesystem write
      expect(fs.existsSync(reportPath)).toBe(true);
      expect(fs.readFileSync(reportPath, "utf-8")).toBe(reportContent);

      // Verify bead methods not called
      expect(upsertSpy).not.toHaveBeenCalled();
      expect(flushSpy).not.toHaveBeenCalled();

      upsertSpy.mockRestore();
      flushSpy.mockRestore();
    });

    it("handles missing beadId gracefully when beadsMode is on", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      // Task without beadId
      setupTask(featureName, "01-test-task", { status: "pending" });

      // Create mock repository
      const mockRepository = {
        upsertTaskArtifact: () => ({ success: true, value: undefined }),
        flushArtifacts: () => ({ success: true, value: undefined }),
        importArtifacts: () => ({ success: true, value: undefined }),
        readTaskArtifact: () => ({ success: true, value: null }),
        getGateway: () => ({ list: () => [], readArtifact: () => null }),
        getEpicByFeatureName: () => ({ success: true, value: "bd-epic-test" }),
        listTaskBeadsForEpic: () => ({ success: true, value: [] }),
        getRobotPlan: () => null,
      };
      const upsertSpy = spyOn(mockRepository, "upsertTaskArtifact").mockImplementation(() => ({ success: true, value: undefined }));

      // Create service with beadsMode on and mock repository
      const onModeService = new TaskService(PROJECT_ROOT, mockRepository as any, { getBeadsMode: () => "on" });

      const reportContent = "# Task Report";
      const reportPath = onModeService.writeReport(featureName, "01-test-task", reportContent);

      // In on-mode, report is NOT written to filesystem
      expect(fs.existsSync(reportPath)).toBe(false);

      // Without beadId, upsert should not be called
      expect(upsertSpy).not.toHaveBeenCalled();

      // Virtual path is still returned
      expect(reportPath).toContain("01-test-task");

      upsertSpy.mockRestore();
    });
  });

  describe("getRunnableTasks - filesystem mode (beadsMode off)", () => {
    it("returns empty result when no tasks exist", () => {
      const featureName = "test-feature";
      setupFeature(featureName);

      // Create service with beadsMode off
      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });

      const result = offModeService.getRunnableTasks(featureName);

      expect(result.runnable).toEqual([]);
      expect(result.blocked).toEqual([]);
      expect(result.completed).toEqual([]);
      expect(result.inProgress).toEqual([]);
      expect(result.source).toBe("filesystem");
    });

    it("categorizes tasks by status correctly", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-pending", { status: "pending" });
      setupTask(featureName, "02-in-progress", { status: "in_progress" });
      setupTask(featureName, "03-done", { status: "done" });
      setupTask(featureName, "04-blocked", { status: "blocked" });

      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });

      const result = offModeService.getRunnableTasks(featureName);

      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].folder).toBe("01-pending");
      expect(result.inProgress).toHaveLength(1);
      expect(result.inProgress[0].folder).toBe("02-in-progress");
      expect(result.completed).toHaveLength(1);
      expect(result.completed[0].folder).toBe("03-done");
      expect(result.blocked).toHaveLength(1);
      expect(result.blocked[0].folder).toBe("04-blocked");
    });

    it("respects dependencies - task with incomplete deps is blocked", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-setup", { status: "pending" });
      setupTask(featureName, "02-dependent", { status: "pending", dependsOn: ["01-setup"] });

      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });

      const result = offModeService.getRunnableTasks(featureName);

      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].folder).toBe("01-setup");
      expect(result.blocked).toHaveLength(1);
      expect(result.blocked[0].folder).toBe("02-dependent");
    });

    it("task with completed deps is runnable", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-setup", { status: "done" });
      setupTask(featureName, "02-dependent", { status: "pending", dependsOn: ["01-setup"] });

      const offModeService = new TaskService(PROJECT_ROOT, createRepository("off"), { getBeadsMode: () => "off" });

      const result = offModeService.getRunnableTasks(featureName);

      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].folder).toBe("02-dependent");
      expect(result.blocked).toHaveLength(0);
    });
  });

  describe("getRunnableTasks - beads mode (beadsMode on)", () => {
    it("falls back to filesystem when robot plan fails", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test", { status: "pending", beadId: "bd-1" });

      // Create service with mocked robot plan that returns null
      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });
      // Mock getRobotPlan to simulate viewer failure
      spyOn((onModeService as any).repository, "getRobotPlan").mockImplementation(() => null);

      // Mock gateway list to return the task
      const listSpy = spyOn((onModeService as any).repository, "listTaskBeadsForEpic").mockReturnValue({ success: true, value: [
        { id: "bd-1", title: "Test", status: "open" },
      ]});

      const result = onModeService.getRunnableTasks(featureName);

      // Robot plan fails, falls back to filesystem-based dependency resolution
      // But tasks are listed from beads
      expect(result.source).toBe("filesystem");
      expect(result.runnable).toHaveLength(1);

      listSpy.mockRestore();
    });

    it("uses beads viewer when available", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-test", { status: "pending", beadId: "bd-task-1" });

      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });
      // Mock getRobotPlan to return a robot plan
      spyOn((onModeService as any).repository, "getRobotPlan").mockImplementation(() => ({
        summary: { total_tracks: 1, total_tasks: 1 },
        tracks: [{ track_id: 1, tasks: ["bd-task-1"] }],
      }));

      // Mock gateway list so listFromBeads can find the task
      const listSpy = spyOn((onModeService as any).repository, "listTaskBeadsForEpic").mockReturnValue({ success: true, value: [
        { id: "bd-task-1", title: "Test", status: "open" },
      ]});

      const result = onModeService.getRunnableTasks(featureName);

      expect(result.source).toBe("beads");
      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].folder).toBe("01-test");

      listSpy.mockRestore();
    });

    it("categorizes tasks from robot plan correctly", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-pending", { status: "pending", beadId: "bd-1" });
      setupTask(featureName, "02-in-progress", { status: "in_progress", beadId: "bd-2" });
      setupTask(featureName, "03-done", { status: "done", beadId: "bd-3" });

      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });
      // Mock getRobotPlan to return categorized tasks
      spyOn((onModeService as any).repository, "getRobotPlan").mockImplementation(() => ({
        summary: { total_tracks: 1, total_tasks: 3 },
        tracks: [{ track_id: 1, tasks: ["bd-1", "bd-2", "bd-3"] }],
      }));

      // Mock gateway list so listFromBeads resolves tasks
      const listSpy = spyOn((onModeService as any).repository, "listTaskBeadsForEpic").mockReturnValue({ success: true, value: [
        { id: "bd-1", title: "Pending", status: "open" },
        { id: "bd-2", title: "In Progress", status: "in_progress" },
        { id: "bd-3", title: "Done", status: "closed" },
      ]});

      const result = onModeService.getRunnableTasks(featureName);

      expect(result.source).toBe("beads");
      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].beadId).toBe("bd-1");
      expect(result.inProgress).toHaveLength(1);
      expect(result.inProgress[0].beadId).toBe("bd-2");
      expect(result.completed).toHaveLength(1);
      expect(result.completed[0].beadId).toBe("bd-3");

      listSpy.mockRestore();
    });
  });

  describe("beads-only mode (beadsMode: on)", () => {
    it("does NOT create local task cache during create()", () => {
      const featureName = "test-feature";
      setupFeature(featureName);

      // Create service with beadsMode on
      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });

      const taskFolder = onModeService.create(featureName, "test-task", 1, 3);

      // Verify task folder name is correct
      expect(taskFolder).toBe("01-test-task");

      // In on-mode, local task cache is NOT created (bead artifacts are canonical)
      const taskPath = path.join(TEST_DIR, ".beads/artifacts", featureName, "tasks", taskFolder);
      expect(fs.existsSync(taskPath)).toBe(false);
    });

    it("does NOT create local task cache during sync()", () => {
      const featureName = "test-feature";
      const featurePath = path.join(TEST_DIR, ".beads/artifacts", featureName);
      fs.mkdirSync(featurePath, { recursive: true });

      fs.writeFileSync(
        path.join(featurePath, "feature.json"),
        JSON.stringify({ name: featureName, epicBeadId: "bd-epic-test", status: "executing", createdAt: new Date().toISOString() })
      );

      const planContent = `# Plan

### 1. First Task

First task description.

### 2. Second Task

Second task description.
`;
      fs.writeFileSync(path.join(featurePath, "plan.md"), planContent);

      // Create service with beadsMode on
      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });
      const result = onModeService.sync(featureName);

      // Verify tasks were reported as created
      expect(result.created).toContain("01-first-task");
      expect(result.created).toContain("02-second-task");

      // In on-mode, local task cache directories are NOT created
      const tasksPath = path.join(featurePath, "tasks");
      expect(fs.existsSync(tasksPath)).toBe(false);
    });

    it("lists tasks from beads in on-mode", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      setupTask(featureName, "01-task-one", { status: "pending", beadId: "bd-task-1", planTitle: "Task One" });
      setupTask(featureName, "02-task-two", { status: "pending", beadId: "bd-task-2", planTitle: "Task Two" });

      // Create service with beadsMode on
      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });

      // Mock BeadGateway.list to return tasks
      const listSpy = spyOn((onModeService as any).repository, "listTaskBeadsForEpic").mockReturnValue({ success: true, value: [
        { id: "bd-task-1", title: "Task One", status: "closed" },
        { id: "bd-task-2", title: "Task Two", status: "closed" },
      ]});

      const tasks = onModeService.list(featureName);

      expect(tasks).toHaveLength(2);
      expect(tasks[0].folder).toBe("01-task-one");
      expect(tasks[0].beadId).toBe("bd-task-1");
      expect(tasks[0].status).toBe("done");
      expect(tasks[1].folder).toBe("02-task-two");
      expect(tasks[1].beadId).toBe("bd-task-2");
      expect(tasks[1].status).toBe("done");

      // In on-mode, list() returns from beads — no local cache write verification needed

      listSpy.mockRestore();
    });

    it("maps in-progress, deferred, and pinned bead statuses", () => {
      const featureName = "test-feature";
      setupFeature(featureName);

      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });
      const listSpy = spyOn((onModeService as any).repository, "listTaskBeadsForEpic").mockReturnValue({ success: true, value: [
        { id: "bd-task-1", title: "Task In Progress", status: "in_progress" },
        { id: "bd-task-2", title: "Task Deferred", status: "deferred" },
        { id: "bd-task-3", title: "Task Pinned", status: "pinned" },
      ]});

      const tasks = onModeService.list(featureName);

      expect(tasks).toHaveLength(3);
      expect(tasks.find((t) => t.beadId === "bd-task-1")?.status).toBe("in_progress");
      expect(tasks.find((t) => t.beadId === "bd-task-2")?.status).toBe("blocked");
      expect(tasks.find((t) => t.beadId === "bd-task-3")?.status).toBe("pending");

      listSpy.mockRestore();
    });

    it("returns empty when beads returns empty in on-mode", () => {
      const featureName = "test-feature";
      setupFeature(featureName);
      // Setup local task (legacy feature with local files)
      setupTask(featureName, "01-local-task", { status: "pending", beadId: "bd-local-1" });

      // Create service with beadsMode on, but beads returns empty
      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });
      const listSpy = spyOn((onModeService as any).repository, "listTaskBeadsForEpic").mockReturnValue({ success: true, value: []});

      const tasks = onModeService.list(featureName);

      // On-mode: beads is canonical — no filesystem fallback
      expect(tasks).toHaveLength(0);

      listSpy.mockRestore();
    });

    it("uses beads-based listing in getRunnableTasksFromBeads", () => {
      const featureName = "test-feature";
      setupFeature(featureName);

      // Create service with beadsMode on
      const onModeService = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });

      // Mock BeadGateway.list to return tasks
      const listSpy = spyOn((onModeService as any).repository, "listTaskBeadsForEpic").mockReturnValue({ success: true, value: [
        { id: "bd-task-1", title: "Pending Task", status: "open" },
      ]});

      // Mock robot plan viewer
      const serviceWithMockViewer = new TaskService(PROJECT_ROOT, createRepository("on"), { getBeadsMode: () => "on" });
      // Mock getRobotPlan
      spyOn((serviceWithMockViewer as any).repository, "getRobotPlan").mockImplementation(() => ({
        summary: { total_tracks: 1, total_tasks: 1 },
        tracks: [{ track_id: 1, tasks: ["bd-task-1"] }],
      }));

      // Apply the same list spy to the new service
      const listSpy2 = spyOn((serviceWithMockViewer as any).repository, "listTaskBeadsForEpic").mockReturnValue({ success: true, value: [
        { id: "bd-task-1", title: "Pending Task", status: "open" },
      ]});

      const result = serviceWithMockViewer.getRunnableTasks(featureName);

      expect(result.source).toBe("beads");
      expect(result.runnable).toHaveLength(1);
      expect(result.runnable[0].beadId).toBe("bd-task-1");

      listSpy.mockRestore();
      listSpy2.mockRestore();
    });
  });
});
