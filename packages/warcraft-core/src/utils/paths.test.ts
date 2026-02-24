import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  acquireLock,
  acquireLockSync,
  writeAtomic,
  writeJsonAtomic,
  writeJsonLocked,
  writeJsonLockedSync,
  patchJsonLocked,
  patchJsonLockedSync,
  deepMerge,
  getLockPath,
  readJson,
  normalizePath,
  getFeaturePath,
  sanitizeName,
  ensureDir,
  getWarcraftDir,
  getWarcraftPath,
  getCanonicalFeaturePath,
  getPlanPath,
  getFeatureJsonPath,
  getContextPath,
  getTasksPath,
  getTaskPath,
  getTaskStatusPath,
  getTaskReportPath,
  listFeatureDirectories,
} from "./paths";

const TEST_DIR = "/tmp/warcraft-core-test-" + process.pid;

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true });
  }
}

describe("Atomic + Locked JSON Utilities", () => {
  beforeEach(() => {
    cleanup();
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    cleanup();
  });

  describe("acquireLock", () => {
    it("creates lock file and returns release function", async () => {
      const filePath = path.join(TEST_DIR, "test.json");
      const lockPath = getLockPath(filePath);

      const release = await acquireLock(filePath);

      expect(fs.existsSync(lockPath)).toBe(true);

      release();

      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it("blocks second acquirer until lock is released", async () => {
      const filePath = path.join(TEST_DIR, "test.json");
      const order: string[] = [];

      const release1 = await acquireLock(filePath);
      order.push("lock1-acquired");

      // Start second lock attempt (will wait)
      const lock2Promise = acquireLock(filePath, { timeout: 1000 }).then(
        (release) => {
          order.push("lock2-acquired");
          return release;
        }
      );

      // Give lock2 a chance to attempt
      await new Promise((r) => setTimeout(r, 100));

      // Release first lock
      release1();
      order.push("lock1-released");

      // Wait for lock2
      const release2 = await lock2Promise;
      release2();
      order.push("lock2-released");

      expect(order).toEqual([
        "lock1-acquired",
        "lock1-released",
        "lock2-acquired",
        "lock2-released",
      ]);
    });

    it("times out when lock cannot be acquired", async () => {
      const filePath = path.join(TEST_DIR, "test.json");

      const release = await acquireLock(filePath);

      await expect(
        acquireLock(filePath, { timeout: 100, retryInterval: 10 })
      ).rejects.toThrow(/Failed to acquire lock/);

      release();
    });

    it("breaks stale lock after TTL", async () => {
      const filePath = path.join(TEST_DIR, "test.json");
      const lockPath = getLockPath(filePath);

      // Create a stale lock manually
      fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999, stale: true }));
      // Set mtime to past
      const pastTime = new Date(Date.now() - 60000);
      fs.utimesSync(lockPath, pastTime, pastTime);

      // Should break stale lock and acquire
      const release = await acquireLock(filePath, { staleLockTTL: 1000 });

      expect(fs.existsSync(lockPath)).toBe(true);

      // Verify it's our lock (has current timestamp)
      const lockContent = JSON.parse(fs.readFileSync(lockPath, "utf-8"));
      expect(lockContent.pid).toBe(process.pid);

      release();
    });
  });

  describe("acquireLockSync", () => {
    it("creates lock file synchronously", () => {
      const filePath = path.join(TEST_DIR, "test.json");
      const lockPath = getLockPath(filePath);

      const release = acquireLockSync(filePath);

      expect(fs.existsSync(lockPath)).toBe(true);

      release();

      expect(fs.existsSync(lockPath)).toBe(false);
    });

    it("times out synchronously when lock held", () => {
      const filePath = path.join(TEST_DIR, "test.json");

      const release = acquireLockSync(filePath);

      expect(() =>
        acquireLockSync(filePath, { timeout: 100, retryInterval: 10 })
      ).toThrow(/Failed to acquire lock/);

      release();
    });
  });

  describe("writeAtomic", () => {
    it("writes file atomically via temp+rename", () => {
      const filePath = path.join(TEST_DIR, "atomic.txt");

      writeAtomic(filePath, "hello world");

      expect(fs.readFileSync(filePath, "utf-8")).toBe("hello world");
    });

    it("creates parent directories", () => {
      const filePath = path.join(TEST_DIR, "nested", "dir", "atomic.txt");

      writeAtomic(filePath, "nested content");

      expect(fs.readFileSync(filePath, "utf-8")).toBe("nested content");
    });

    it("cleans up temp file on failure", () => {
      const filePath = path.join(TEST_DIR, "readonly", "fail.txt");

      // Create readonly directory
      const readonlyDir = path.join(TEST_DIR, "readonly");
      fs.mkdirSync(readonlyDir);
      fs.chmodSync(readonlyDir, 0o444);

      try {
        expect(() => writeAtomic(filePath, "should fail")).toThrow();
      } finally {
        fs.chmodSync(readonlyDir, 0o755);
      }

      // No temp files should remain
      const files = fs.readdirSync(readonlyDir);
      expect(files.filter((f) => f.includes(".tmp."))).toHaveLength(0);
    });
  });

  describe("writeJsonAtomic", () => {
    it("writes JSON atomically with formatting", () => {
      const filePath = path.join(TEST_DIR, "data.json");
      const data = { foo: "bar", num: 42 };

      writeJsonAtomic(filePath, data);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(JSON.parse(content)).toEqual(data);
      expect(content).toContain("\n"); // Formatted
    });
  });

  describe("writeJsonLocked", () => {
    it("writes JSON with lock protection", async () => {
      const filePath = path.join(TEST_DIR, "locked.json");
      const data = { key: "value" };

      await writeJsonLocked(filePath, data);

      expect(readJson<typeof data>(filePath)).toEqual(data);
      expect(fs.existsSync(getLockPath(filePath))).toBe(false);
    });

    it("serializes concurrent writes", async () => {
      const filePath = path.join(TEST_DIR, "concurrent.json");
      const writes: number[] = [];

      // Start multiple concurrent writes
      const promises = [1, 2, 3, 4, 5].map(async (n) => {
        await writeJsonLocked(filePath, { value: n });
        writes.push(n);
      });

      await Promise.all(promises);

      // All writes completed
      expect(writes).toHaveLength(5);

      // File has valid JSON (last writer wins)
      const final = readJson<{ value: number }>(filePath);
      expect(final?.value).toBeGreaterThanOrEqual(1);
      expect(final?.value).toBeLessThanOrEqual(5);
    });
  });

  describe("writeJsonLockedSync", () => {
    it("writes JSON with lock protection synchronously", () => {
      const filePath = path.join(TEST_DIR, "locked-sync.json");
      const data = { sync: true };

      writeJsonLockedSync(filePath, data);

      expect(readJson<typeof data>(filePath)).toEqual(data);
      expect(fs.existsSync(getLockPath(filePath))).toBe(false);
    });
  });

  describe("deepMerge", () => {
    it("merges top-level fields", () => {
      const target: Record<string, unknown> = { a: 1, b: 2 };
      const patch: Record<string, unknown> = { b: 3, c: 4 };

      const result = deepMerge(target, patch);

      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it("deep merges nested objects", () => {
      const target: Record<string, unknown> = {
        outer: { inner1: "a", inner2: "b" },
        other: "x",
      };
      const patch: Record<string, unknown> = {
        outer: { inner2: "c", inner3: "d" },
      };

      const result = deepMerge(target, patch);

      expect(result).toEqual({
        outer: { inner1: "a", inner2: "c", inner3: "d" },
        other: "x",
      });
    });

    it("replaces arrays (no merge)", () => {
      const target: Record<string, unknown> = { arr: [1, 2, 3] };
      const patch: Record<string, unknown> = { arr: [4, 5] };

      const result = deepMerge(target, patch);

      expect(result).toEqual({ arr: [4, 5] });
    });

    it("ignores undefined values in patch", () => {
      const target: Record<string, unknown> = { a: 1, b: 2 };
      const patch: Record<string, unknown> = { a: undefined, c: 3 };

      const result = deepMerge(target, patch);

      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    it("allows null to overwrite", () => {
      const target: Record<string, unknown> = { a: { nested: true } };
      const patch: Record<string, unknown> = { a: null };

      const result = deepMerge(target, patch);

      expect(result).toEqual({ a: null });
    });

    it("handles deeply nested objects", () => {
      const target: Record<string, unknown> = {
        level1: {
          level2: {
            level3: { keep: true, update: "old" },
          },
        },
      };
      const patch: Record<string, unknown> = {
        level1: {
          level2: {
            level3: { update: "new", add: true },
          },
        },
      };

      const result = deepMerge(target, patch);

      expect(result).toEqual({
        level1: {
          level2: {
            level3: { keep: true, update: "new", add: true },
          },
        },
      });
    });
  });

  describe("patchJsonLocked", () => {
    it("patches existing JSON file", async () => {
      const filePath = path.join(TEST_DIR, "patch.json");
      fs.writeFileSync(filePath, JSON.stringify({ a: 1, b: 2 }));

      const result = await patchJsonLocked<{ a: number; b: number; c?: number }>(
        filePath,
        { b: 3, c: 4 }
      );

      expect(result).toEqual({ a: 1, b: 3, c: 4 });
      expect(readJson<typeof result>(filePath)).toEqual({ a: 1, b: 3, c: 4 });
    });

    it("creates file if not exists", async () => {
      const filePath = path.join(TEST_DIR, "new-patch.json");

      const result = await patchJsonLocked<{ x: number }>(filePath, { x: 1 });

      expect(result).toEqual({ x: 1 });
    });

    it("deep merges nested objects in patch", async () => {
      const filePath = path.join(TEST_DIR, "nested-patch.json");
      fs.writeFileSync(
        filePath,
        JSON.stringify({
          status: "pending",
          workerSession: { sessionId: "abc", attempt: 1 },
        })
      );

      await patchJsonLocked(filePath, {
        workerSession: { lastHeartbeatAt: "2025-01-01T00:00:00Z" },
      });

      const result = readJson<Record<string, unknown>>(filePath);
      expect(result).toEqual({
        status: "pending",
        workerSession: {
          sessionId: "abc",
          attempt: 1,
          lastHeartbeatAt: "2025-01-01T00:00:00Z",
        },
      });
    });
  });

  describe("patchJsonLockedSync", () => {
    it("patches synchronously", () => {
      const filePath = path.join(TEST_DIR, "patch-sync.json");
      fs.writeFileSync(filePath, JSON.stringify({ x: 1 }));

      const result = patchJsonLockedSync<{ x: number; y?: number }>(filePath, {
        y: 2,
      });

      expect(result).toEqual({ x: 1, y: 2 });
    });
  });

  describe("normalizePath", () => {
    it("converts Windows backslashes to forward slashes", () => {
      expect(normalizePath("C:\\Users\\test\\project")).toBe("C:/Users/test/project");
    });

    it("leaves Unix paths unchanged", () => {
      expect(normalizePath("/home/user/project")).toBe("/home/user/project");
    });
  });



  describe("getFeaturePath flat layout (canonical)", () => {
    it("returns canonical flat path when feature exists at new location", () => {
      const flatPath = path.join(TEST_DIR, '.beads', 'artifacts', 'my-feature');
      fs.mkdirSync(flatPath, { recursive: true });
      fs.writeFileSync(
        path.join(flatPath, 'feature.json'),
        JSON.stringify({ name: 'my-feature', epicBeadId: 'bd-1', status: 'planning', createdAt: new Date().toISOString() })
      );

      expect(getFeaturePath(TEST_DIR, 'my-feature')).toBe(flatPath);
    });

    it("returns canonical path even if legacy nested path exists", () => {
      const oldPath = path.join(TEST_DIR, '.beads', 'artifacts', 'features', 'legacy-feature');
      fs.mkdirSync(oldPath, { recursive: true });
      fs.writeFileSync(
        path.join(oldPath, 'feature.json'),
        JSON.stringify({ name: 'legacy-feature', epicBeadId: 'bd-2', status: 'planning', createdAt: new Date().toISOString() })
      );

      const result = getFeaturePath(TEST_DIR, 'legacy-feature');

      expect(result).toBe(path.join(TEST_DIR, '.beads', 'artifacts', 'legacy-feature'));
      expect(fs.existsSync(oldPath)).toBe(true);
    });

    it("returns canonical path when both canonical and legacy paths exist", () => {
      const oldPath = path.join(TEST_DIR, '.beads', 'artifacts', 'features', 'conflict-feature');
      const newPath = path.join(TEST_DIR, '.beads', 'artifacts', 'conflict-feature');

      fs.mkdirSync(oldPath, { recursive: true });
      fs.mkdirSync(newPath, { recursive: true });

      expect(getFeaturePath(TEST_DIR, 'conflict-feature')).toBe(newPath);
    });

    it("returns new canonical path when feature doesn't exist", () => {
      const result = getFeaturePath(TEST_DIR, 'nonexistent-feature');
      const expectedPath = path.join(TEST_DIR, '.beads', 'artifacts', 'nonexistent-feature');
      expect(result).toBe(expectedPath);
    });
  });

  describe("sanitizeName", () => {
    it("allows valid names", () => {
      expect(sanitizeName("my-feature")).toBe("my-feature");
      expect(sanitizeName("task_01")).toBe("task_01");
      expect(sanitizeName("Feature Name")).toBe("Feature Name");
      expect(sanitizeName("a")).toBe("a");
    });

    it("rejects empty names", () => {
      expect(() => sanitizeName("")).toThrow("cannot be empty");
      expect(() => sanitizeName("   ")).toThrow("cannot be empty");
    });

    it("rejects path separators", () => {
      expect(() => sanitizeName("../../etc/passwd")).toThrow("path separators");
      expect(() => sanitizeName("a/b")).toThrow("path separators");
      expect(() => sanitizeName("a\\b")).toThrow("path separators");
    });

    it("rejects relative path references", () => {
      expect(() => sanitizeName("..")).toThrow("relative path");
      expect(() => sanitizeName("..foo")).toThrow("relative path");
    });

    it("rejects dot-prefixed names", () => {
      expect(() => sanitizeName(".")).toThrow("relative path");
      expect(() => sanitizeName(".hidden")).toThrow("dot");
    });

    it("rejects control characters", () => {
      expect(() => sanitizeName("foo\x00bar")).toThrow("control characters");
      expect(() => sanitizeName("foo\nbar")).toThrow("control characters");
    });
  });

  describe("readJson safety", () => {
    it("returns null for malformed JSON", () => {
      const tmpDir = fs.mkdtempSync(path.join(TEST_DIR, "readjson-test-"));
      const filePath = path.join(tmpDir, "bad.json");
      fs.writeFileSync(filePath, "{ invalid json !!!");

      expect(readJson(filePath)).toBeNull();
    });

    it("returns null for missing file", () => {
      expect(readJson("/nonexistent/path/file.json")).toBeNull();
    });

    it("returns parsed data for valid JSON", () => {
      const tmpDir = fs.mkdtempSync(path.join(TEST_DIR, "readjson-test-"));
      const filePath = path.join(tmpDir, "good.json");
      fs.writeFileSync(filePath, '{"name": "test"}');

      expect(readJson<{ name: string }>(filePath)).toEqual({ name: "test" });
    });
  });

  describe("acquireLock PID awareness", () => {
    it("breaks lock with dead PID", async () => {
      const filePath = path.join(TEST_DIR, "pid-lock-test.json");
      const lockPath = getLockPath(filePath);

      // Create a fake stale lock with a dead PID
      ensureDir(TEST_DIR);
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: 999999999,
          timestamp: new Date(Date.now() - 60000).toISOString(),
          filePath,
        })
      );
      // Backdate the lock file
      const oldTime = new Date(Date.now() - 60000);
      fs.utimesSync(lockPath, oldTime, oldTime);

      // Should be able to acquire despite existing lock (PID is dead, lock is old)
      const release = await acquireLock(filePath, {
        staleLockTTL: 1000,
        timeout: 2000,
      });
      expect(typeof release).toBe("function");
      release();
    });
  });



  describe("beadsMode path resolution", () => {

    describe("getWarcraftDir", () => {
      it("returns '.beads/artifacts' when beadsMode is 'on'", () => {
        expect(getWarcraftDir('on')).toBe('.beads/artifacts');
      });

      it("returns 'docs' when beadsMode is 'off'", () => {
        expect(getWarcraftDir('off')).toBe('docs');
      });

      it("defaults to 'on' behavior when beadsMode not specified", () => {
        expect(getWarcraftDir()).toBe('.beads/artifacts');
      });
    });

    describe("getWarcraftPath", () => {
      it("returns beads artifacts path when beadsMode is 'on'", () => {
        const result = getWarcraftPath('/project', 'on');
        expect(result).toBe(path.join('/project', '.beads', 'artifacts'));
      });

      it("returns docs path when beadsMode is 'off'", () => {
        const result = getWarcraftPath('/project', 'off');
        expect(result).toBe(path.join('/project', 'docs'));
      });

      it("defaults to 'on' behavior when beadsMode not specified", () => {
        const result = getWarcraftPath('/project');
        expect(result).toBe(path.join('/project', '.beads', 'artifacts'));
      });
    });

    describe("getCanonicalFeaturePath", () => {
      it("returns flat path under beads when beadsMode is 'on'", () => {
        const result = getCanonicalFeaturePath('/project', 'my-feature', 'on');
        expect(result).toBe(path.join('/project', '.beads', 'artifacts', 'my-feature'));
      });

      it("returns flat path under docs when beadsMode is 'off'", () => {
        const result = getCanonicalFeaturePath('/project', 'my-feature', 'off');
        expect(result).toBe(path.join('/project', 'docs', 'my-feature'));
      });
    });

    describe("getFeaturePath with beadsMode", () => {
      it("resolves to beads path when feature exists at canonical beads location", () => {
        const beadsPath = path.join(TEST_DIR, '.beads', 'artifacts', 'test-feat');
        fs.mkdirSync(beadsPath, { recursive: true });
        fs.writeFileSync(
          path.join(beadsPath, 'feature.json'),
          JSON.stringify({ name: 'test-feat', status: 'planning', createdAt: new Date().toISOString() })
        );

        expect(getFeaturePath(TEST_DIR, 'test-feat', 'on')).toBe(beadsPath);
      });

      it("resolves to docs path when feature exists at canonical path", () => {
        const docsPath = path.join(TEST_DIR, 'docs', 'test-feat');
        fs.mkdirSync(docsPath, { recursive: true });
        fs.writeFileSync(
          path.join(docsPath, 'feature.json'),
          JSON.stringify({ name: 'test-feat', status: 'planning', createdAt: new Date().toISOString() })
        );

        expect(getFeaturePath(TEST_DIR, 'test-feat', 'off')).toBe(docsPath);
      });

      it("returns canonical docs path for new features when beadsMode is 'off'", () => {
        const result = getFeaturePath(TEST_DIR, 'new-feature', 'off');
        expect(result).toBe(path.join(TEST_DIR, 'docs', 'new-feature'));
      });
    });

    describe("getPlanPath with beadsMode", () => {
      it("returns plan.md path under beads when beadsMode is 'on'", () => {
        const result = getPlanPath('/project', 'my-feature', 'on');
        expect(result).toBe(path.join('/project', '.beads', 'artifacts', 'my-feature', 'plan.md'));
      });

      it("returns plan.md path under docs when beadsMode is 'off'", () => {
        const result = getPlanPath('/project', 'my-feature', 'off');
        expect(result).toBe(path.join('/project', 'docs', 'my-feature', 'plan.md'));
      });
    });

    describe("getFeatureJsonPath with beadsMode", () => {
      it("returns feature.json path under beads when beadsMode is 'on'", () => {
        const result = getFeatureJsonPath('/project', 'my-feature', 'on');
        expect(result).toBe(path.join('/project', '.beads', 'artifacts', 'my-feature', 'feature.json'));
      });

      it("returns feature.json path under docs when beadsMode is 'off'", () => {
        const result = getFeatureJsonPath('/project', 'my-feature', 'off');
        expect(result).toBe(path.join('/project', 'docs', 'my-feature', 'feature.json'));
      });
    });

    describe("listFeatureDirectories with beadsMode", () => {
      it("lists features from beads location when beadsMode is 'on'", () => {
        // Create features at beads location
        const beadsPath = path.join(TEST_DIR, '.beads', 'artifacts');
        fs.mkdirSync(path.join(beadsPath, 'feat-a'), { recursive: true });
        fs.mkdirSync(path.join(beadsPath, 'feat-b'), { recursive: true });
        fs.writeFileSync(path.join(beadsPath, 'feat-a', 'feature.json'), '{}');
        fs.writeFileSync(path.join(beadsPath, 'feat-b', 'feature.json'), '{}');

        const features = listFeatureDirectories(TEST_DIR, 'on');
        expect(features).toContain('feat-a');
        expect(features).toContain('feat-b');
      });

      it("lists features from docs location when beadsMode is 'off'", () => {
        // Create features at docs location
        const docsPath = path.join(TEST_DIR, 'docs');
        fs.mkdirSync(path.join(docsPath, 'docs-feat-1'), { recursive: true });
        fs.mkdirSync(path.join(docsPath, 'docs-feat-2'), { recursive: true });
        fs.writeFileSync(path.join(docsPath, 'docs-feat-1', 'feature.json'), '{}');
        fs.writeFileSync(path.join(docsPath, 'docs-feat-2', 'feature.json'), '{}');
        const features = listFeatureDirectories(TEST_DIR, 'off');
        expect(features).toContain('docs-feat-1');
        expect(features).toContain('docs-feat-2');
      });
    });


  });
});
