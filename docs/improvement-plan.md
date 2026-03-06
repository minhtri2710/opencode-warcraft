# opencode-warcraft Improvement Plan

> Generated: 2026-03-06 | Scope: Architecture, Reliability, DX, Agent Effectiveness

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [Premortem: Why This Could Fail](#premortem-why-this-could-fail)
- [Revised Plan: Failure-Mode-First](#revised-plan-failure-mode-first)
- [Full Idea List (30)](#full-idea-list-30)
- [Evaluation Matrix](#evaluation-matrix)
- [Detailed Plans for Surviving Ideas](#detailed-plans-for-surviving-ideas)
- [Weakest Parts of the System](#weakest-parts-of-the-system)

---

## Executive Summary

After deep analysis of the entire codebase—types, services, tools, agents, hooks, guards, task dispatch, dependency graph, and storage abstraction—this document identifies **24 high-quality improvements** from an initial list of 30, with detailed implementation plans for each.

This revision adds a **premortem lens**: assume total failure in 6 months, then optimize for the most likely causes of that failure first (not just technical elegance).

**If you only do 5 things, do these:**
1. **Structured verification payload + strict fallback policy** — eliminate false-positive "pass" commits (#5)
2. **Lifecycle integration tests + golden-path/broken-path scenarios** — catch regressions before users do (#13, #29)
3. **OperationOutcome + structured logger + JSONL events** — make failures diagnosable instead of invisible (#3, #11, #23)
4. **Unified dispatch + per-task locking + explicit state transitions** — stop task corruption, races, and status drift (#4, #9, #27)
5. **Worktree hygiene + rollout safety rails** — prevent disk/tooling decay and risky refactors landing all at once (#7 + revised sequencing below)

---

## Premortem: Why This Could Fail

### Failure narrative (6 months later)

Adoption stalled. Teams initially liked the workflow, but confidence dropped after a few bad incidents: tasks marked done with weak evidence, duplicate dispatches creating inconsistent task state, and merges that looked successful but later broke mainline checks. Debugging was slow because warning-only degraded paths left almost no forensic trail. Worktrees accumulated until local environments were noisy and fragile. Operators started bypassing the tools and running manual git commands.

The system became "technically powerful but operationally untrusted." Users did not hate one big failure; they hated repeated small paper cuts: ambiguous blockers, unclear recovery steps, long prompts, and too many states that looked valid but behaved inconsistently.

### Assumptions that likely turn out false

1. **"Regex evidence is good enough for verification."**
   False when summaries are ambiguous, gameable, or stale.
2. **"Refactor safety can be inferred from unit tests."**
   False for cross-layer flows (feature/plan/task/worktree/merge).
3. **"Operators can manually recover from degraded states."**
   False under time pressure without structured diagnostics.
4. **"Duplicate dispatch is rare enough to ignore."**
   False in concurrent orchestration and retries.
5. **"Worktree cleanup is an ops nicety, not product behavior."**
   False once disk clutter and stale branches erode trust.
6. **"Prompt changes are low risk if behavior seems okay."**
   False; subtle regressions accumulate and are hard to detect.

### Edge cases and integration issues we would miss

- Partial verification payloads (`test` present, `build` missing) incorrectly treated as complete.
- Retry logic turning deterministic failures into slow, noisy failures without better diagnostics.
- Batch and single dispatch diverging in idempotency key semantics after one side changes.
- State transitions allowing illegal reopen paths (`done -> in_progress`) through legacy update calls.
- Worktree prune deleting still-useful contexts when status metadata is stale or inconsistent.
- beads mode on/off behavior drifting because key scenarios are not covered by lifecycle tests.

### What users would hate most

- "It said done, but it wasn't actually done."
- "I can't tell what failed or what to do next."
- "The same action behaves differently in batch vs single mode."
- "The tool keeps leaving mess in my repo/worktrees."
- "The system feels strict in the wrong places and vague in critical places."

---

## Revised Plan: Failure-Mode-First

### A. Immediate guardrails (ship first)

1. **Make verification trustworthy before adding new automation**
   - Ship #5 first, but require an explicit compatibility rule: if structured verification is missing for a required gate, mark as `degraded` and block `completed` in `enforce` mode.
   - Add test matrix for mixed payloads (none/partial/full) and contradictory summary text.

2. **Make failures visible before optimizing architecture**
   - Group #3 + #23 + #11 into one "diagnostics baseline" milestone.
   - Every degraded path must emit: machine code, human message, feature/task correlation id, actionable hint.

3. **Stabilize orchestration semantics before refactors**
   - Ship #27 and #9 alongside #4, not after it.
   - Block merge of unified dispatch unless both single and batch run through identical dispatch invariant tests.

### B. Integration confidence (ship second)

4. **Promote lifecycle tests to release gates**
   - Expand #13 to cover:
     - beadsMode `on` and `off`
     - blocked worker resume path
     - failed verification path and recovery
     - merge verification enforcement behavior
   - Add #29 minimal harness snapshots for agent prompt invariants used by these flows.

5. **Prevent operational decay**
   - Ship #7 with conservative defaults: `dryRun=true`, explicit `--confirm` style parameter for destructive prune.
   - Add stale-worktree warnings to `warcraft_status` before enabling automatic cleanup.

### C. Rollout strategy changes (new)

6. **Feature-flag high-risk behavior changes**
   - Add runtime flags for: structured-verification enforcement, unified dispatch path, and strict transition validation.
   - Roll out per-feature with opt-in first; promote to default only after lifecycle and snapshot pass rates are stable.

7. **Define "operator trust" success metrics**
   - Track locally (JSONL): reopen rate after `done`, blocked-task mean time to resolution, duplicate dispatch prevention count, prune dry-run acceptance rate.
   - A change is not "done" until these metrics improve or stay neutral over 2 release cycles.

### Revised sequencing (most likely to prevent failure)

1. #5 (structured verification), with strict fallback semantics and compatibility tests
2. #3 + #23 + #11 (diagnostics baseline)
3. #27 + #9 + #4 (orchestration integrity bundle)
4. #13 + #29 (integration + prompt regression gates)
5. #7 (worktree hygiene), then #24 (tight merge verification), then remaining medium/low-risk improvements

This sequence intentionally delays convenience features until correctness, observability, and orchestration integrity are stable.

---

## Full Idea List (30)

| # | Idea | Category |
|---|------|----------|
| 1 | Typed DI builder for `container.ts` | Architecture |
| 2 | `RuntimeContext` object to stop flag threading | Architecture |
| 3 | Adopt `OperationOutcome` end-to-end for degraded paths | Reliability |
| 4 | Unify batch + single dispatch into one shared module | Architecture |
| 5 | Structured verification payload (replace regex gating) | Reliability |
| 6 | Tool-level retry + backoff for transient operations | Reliability |
| 7 | Automatic worktree cleanup + `warcraft_worktree_prune` tool | Operations |
| 8 | Plan versioning (snapshots on write/approve) | Features |
| 9 | Explicit task state machine (transition rules + timestamps) | Reliability |
| 10 | Worker heartbeat tracking surfaced in `warcraft_status` | Observability |
| 11 | Local analytics via JSONL event log | Observability |
| 12 | Prompt regression snapshot tests | Testing |
| 13 | Full plugin lifecycle integration tests | Testing |
| 14 | Security hardening for file writes (path validation) | Security |
| 15 | Reduce system prompt bloat (move tables behind skills) | Agent UX |
| 16 | Token/cost estimation surfaced in tool responses | Observability |
| 17 | Rollback merged task via `git revert` | Features |
| 18 | Task quarantine after N failures | Reliability |
| 19 | Push `beadsMode` branching down into stores | Architecture |
| 20 | Explicit artifact index per task | Architecture |
| 21 | `warcraft_plan_lint` validation tool | Features |
| 22 | Non-numeric stable task IDs | Architecture |
| 23 | Replace `console.warn` with structured logger | Observability |
| 24 | Tighten merge verification rules | Reliability |
| 25 | Dry-run mode for worktree commit/merge | Features |
| 26 | Auto-run Biome on changed files before commit | DX |
| 27 | Per-task concurrency lock (prevent duplicate dispatch) | Reliability |
| 28 | Standardize blocker schema + next-action suggestions | Agent UX |
| 29 | Minimal agent effectiveness harness | Testing |
| 30 | Documentation & DX quickstart guide | DX |

---

## Evaluation Matrix

| # | Verdict | Rationale |
|---|---------|-----------|
| 1 | ✅ KEEP | DI pain is real; improvement is mostly refactor-only and reduces bugs |
| 2 | ✅ KEEP | Flag threading (`beadsMode`, verification) is a cross-cutting concern; a context object is cheap |
| 3 | ✅ KEEP | `outcomes.ts` already exists but is underutilized; adopting it eliminates "silent degrade" |
| 4 | ✅ KEEP | Clear duplication between `WorktreeTools` and `BatchTools`; unifying prevents drift |
| 5 | ✅ KEEP | Regex evidence gates are the single biggest correctness hole in the system |
| 6 | ✅ KEEP | Transient failures (git/fs/beads) are common; retries reduce flakiness cheaply |
| 7 | ✅ KEEP | "Worktrees never cleaned up" is a concrete operational footgun |
| 8 | ✅ KEEP | Plan approval is hash-based but not versioned; snapshots enable safe iteration |
| 9 | ✅ KEEP | State transitions are implicit; explicit transitions prevent stuck/illegal states |
| 10 | ✅ KEEP | `WorkerSession` type already exists but is barely used; surfacing it enables stuck-worker detection |
| 11 | ✅ KEEP | "No structured telemetry" is a core blind spot; local JSONL is low friction |
| 12 | ✅ KEEP | Prompts are production code; snapshot tests prevent accidental degradations |
| 13 | ✅ KEEP | Plugin lifecycle correctness is core; current tests are service-focused, not system-focused |
| 14 | ✅ KEEP | Tools are a write-capable automation interface; path traversal is a real risk |
| 15 | ❌ REJECT | Risky without an effectiveness harness to measure impact; do after #29 |
| 16 | ✅ KEEP | Token/cost visibility is practical; already computing prompt sizes |
| 17 | ✅ KEEP | Missing rollback capability; `git revert` implementation is minimal |
| 18 | ❌ REJECT | Overlaps with existing "3 failures" heuristic; do after task state machine cleanup (#9) |
| 19 | ❌ REJECT | Higher-risk refactor touching many layers; defer until pain is acute |
| 20 | ❌ REJECT | Mostly organizational; less urgent than verification/logging improvements |
| 21 | ✅ KEEP | Plan quality drives everything; linter prevents downstream execution failures |
| 22 | ❌ REJECT | Bigger format migration; only worth it if renumber churn is actually painful |
| 23 | ✅ KEEP | Structured logging is prerequisite for diagnosing tool issues |
| 24 | ✅ KEEP | Merge verification is currently optional; tightening improves correctness cheaply |
| 25 | ❌ REJECT | Adds surface area with less value than structured verification and tests |
| 26 | ✅ KEEP | Auto-format-on-commit reduces noise and review friction; aligns with Biome usage |
| 27 | ✅ KEEP | Concurrency bugs are subtle; a per-task lock is small and prevents corruption |
| 28 | ✅ KEEP | Blockers are central to workflow; standardization improves operator decisions |
| 29 | ✅ KEEP | Start tiny: canned scenarios + snapshot outputs; enables future prompt optimization |
| 30 | ✅ KEEP | Docs reduce onboarding cost; easy win reducing "tribal knowledge" prompts |

**Survivors: 24 ideas** — #1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 21, 23, 24, 26, 27, 28, 29, 30

---

## Detailed Plans for Surviving Ideas

### #5 — Structured Verification Payload (replace regex gating)

**Confidence: 92%** | Effort: L | Priority: 🔴 Critical

**The Problem:**
`hasCompletionGateEvidence()` in `guards.ts` checks for build/test/lint pass signals via regex matching on summary text:
```typescript
// Current: brittle, gameable, ambiguous
export const COMPLETION_PASS_SIGNAL =
  /\b(exit(?:\s+code)?\s*0|pass(?:ed|es)?|success(?:ful|fully)?|ok)\b/i;
```
A summary like "test failed, then I fixed it and tests pass" could match both fail and pass signals depending on line splitting. This gates the most critical operation (committing completed work).

**The Plan:**

1. Extend `warcraft_worktree_commit` args with structured verification:
```typescript
// In worktree-tools.ts
verification: tool.schema.object({
  build: tool.schema.object({
    cmd: tool.schema.string(),
    exitCode: tool.schema.number(),
    output: tool.schema.string().optional(),
  }).optional(),
  test: tool.schema.object({
    cmd: tool.schema.string(),
    exitCode: tool.schema.number(),
    output: tool.schema.string().optional(),
  }).optional(),
  lint: tool.schema.object({
    cmd: tool.schema.string(),
    exitCode: tool.schema.number(),
    output: tool.schema.string().optional(),
  }).optional(),
}).optional().describe('Structured verification results (preferred over summary regex)')
```

2. Update gate logic to prefer structured data:
```typescript
function checkVerificationGates(
  verification: StructuredVerification | undefined,
  summary: string,
  gates: readonly CompletionGate[],
): { passed: boolean; missing: CompletionGate[] } {
  const missing: CompletionGate[] = [];

  for (const gate of gates) {
    // Prefer structured verification
    if (verification?.[gate]) {
      if (verification[gate].exitCode !== 0) missing.push(gate);
      continue;
    }
    // Fallback to regex for backward compat
    if (!hasCompletionGateEvidence(summary, gate)) missing.push(gate);
  }

  return { passed: missing.length === 0, missing };
}
```

3. Update Mekkatorque prompt to report structured verification:
```
warcraft_worktree_commit({
  task: "current-task",
  summary: "Implemented X.",
  status: "completed",
  verification: {
    build: { cmd: "bun run build", exitCode: 0 },
    test: { cmd: "bun test", exitCode: 0 },
    lint: { cmd: "bun run lint", exitCode: 0 }
  }
})
```

**Why good:** Eliminates the single biggest correctness hole. Structured data is unambiguous, testable, and auditable.
**Downsides:** Requires updating Mekkatorque prompt + tool schema; transitional period where both regex and structured exist.

---

### #4 — Unify Batch + Single Dispatch

**Confidence: 88%** | Effort: M | Priority: 🔴 Critical

**The Problem:**
`WorktreeTools.createWorktreeTool` and `BatchTools.batchExecuteTool` both implement task dispatch with subtle differences: idempotency key handling, session patching, prompt meta computation, and error handling diverge.

**The Plan:**

1. Create `packages/opencode-warcraft/src/tools/dispatch-task.ts`:
```typescript
export interface DispatchOptions {
  feature: string;
  task: string;
  continueFrom?: ContinueFromBlocked;
}

export interface DispatchResult {
  worktree: { path: string; branch: string; commit: string };
  taskToolCall: { subagent_type: string; description: string; prompt: string };
  specContent: string;
  promptMeta: PromptMeta;
  budgetApplied: BudgetInfo;
  warnings: Warning[];
}

export async function dispatchOneTask(
  options: DispatchOptions,
  deps: DispatchDependencies,
  shared?: SharedDispatchData,
): Promise<DispatchResult> {
  // 1. Check task exists & status
  // 2. Create or reuse worktree
  // 3. Mark in_progress + set baseCommit
  // 4. Assign idempotency key
  // 5. Build spec + worker prompt via prepareTaskDispatch
  // 6. Return unified DispatchResult
}
```

2. Simplify `WorktreeTools.createWorktreeTool` to: validate → check blocked/deps → `dispatchOneTask()` → format response.
3. Simplify `BatchTools.batchExecuteTool` execute path to: validate → `map(dispatchOneTask)` → aggregate results.

**Why good:** Single source of truth for dispatch logic; all future improvements (retries, logging, verification) apply uniformly.
**Downsides:** Refactor risk; careful test migration needed.

---

### #3 — Adopt `OperationOutcome` End-to-End

**Confidence: 90%** | Effort: L | Priority: 🔴 Critical

**The Problem:**
`outcomes.ts` defines a clean `ok/degraded/fatal` envelope, but services still use `try/catch + console.warn` as the primary degraded-path mechanism. Degraded behavior is invisible to operators.

**The Plan:**

1. Add a convenience wrapper:
```typescript
// warcraft-core/src/services/outcomes.ts (extend existing)
export async function outcomeify<T>(
  fn: () => Promise<T>,
  code: string,
  context?: Record<string, unknown>,
): Promise<OperationOutcome<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fatal([diagnostic(code, msg, 'fatal', context)]);
  }
}
```

2. Convert key degraded paths (currently `console.warn + continue`):
```typescript
// Before (taskService.ts sync):
try {
  this.store.syncDependencies(featureName);
} catch (depError) {
  console.warn(`[warcraft] Dependency sync failed...`);
}

// After:
const depSync = await outcomeify(
  () => this.store.syncDependencies(featureName),
  'dependency_sync_failed',
  { featureName },
);
if (depSync.severity !== 'ok') {
  syncDiagnostics.push(...depSync.diagnostics);
}
```

3. Include diagnostics in tool responses:
```typescript
return toolSuccess({
  ...result,
  diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
});
```

**Why good:** Makes degraded behavior visible, testable, and actionable. Leverages existing infrastructure.
**Downsides:** Response schema changes (additive, non-breaking).

---

### #7 — Automatic Worktree Cleanup + Prune Tool

**Confidence: 90%** | Effort: M | Priority: 🟠 High

**The Problem:**
From AGENTS.md: "Worktrees persist until manually removed." No automatic cleanup exists. Disk bloat and confusion accumulate over time.

**The Plan:**

1. Add `WorktreeService.listAll(feature?)`:
```typescript
async listAll(feature?: string): Promise<Array<WorktreeInfo & { taskStatus: TaskStatusType }>> {
  const worktreesDir = this.getWorktreesDir();
  const features = feature ? [feature] : await fs.readdir(worktreesDir).catch(() => []);
  const results: Array<WorktreeInfo & { taskStatus: TaskStatusType }> = [];

  for (const feat of features) {
    const featurePath = path.join(worktreesDir, feat);
    const steps = await fs.readdir(featurePath).catch(() => []);
    for (const step of steps) {
      const info = await this.get(feat, step);
      if (info) {
        const statusPath = this.getStepStatusPath(feat, step);
        const status = JSON.parse(await fs.readFile(statusPath, 'utf-8').catch(() => '{}'));
        results.push({ ...info, taskStatus: status.status || 'unknown' });
      }
    }
  }
  return results;
}
```

2. Implement prune policy:
```typescript
async prune(options: {
  feature?: string;
  olderThanDays?: number;
  dryRun?: boolean;
  statusFilter?: TaskStatusType[];
}): Promise<{ pruned: string[]; skipped: string[] }> {
  const { olderThanDays = 7, dryRun = false, statusFilter = ['done', 'cancelled'] } = options;
  const cutoff = Date.now() - olderThanDays * 86_400_000;
  const all = await this.listAll(options.feature);

  const pruned: string[] = [];
  const skipped: string[] = [];

  for (const wt of all) {
    if (!statusFilter.includes(wt.taskStatus)) { skipped.push(wt.path); continue; }
    // Check age via commit timestamp
    if (dryRun) { pruned.push(wt.path); continue; }
    await this.remove(wt.feature, wt.step);
    pruned.push(wt.path);
  }
  return { pruned, skipped };
}
```

3. Expose tool:
```typescript
warcraft_worktree_prune({
  feature?: string,
  olderThanDays?: number,  // default: 7
  dryRun?: boolean,         // default: true (safe by default)
})
```

**Why good:** Solves a concrete operational footgun; safe with dry-run default.
**Downsides:** Risk of deleting something wanted; mitigated by dry-run default and status filter.

---

### #13 — Full Plugin Lifecycle Integration Tests

**Confidence: 85%** | Effort: L | Priority: 🟠 High

**The Problem:**
Current tests are unit-level (service methods, individual tools). No test exercises the full workflow: feature create → plan write → approve → tasks sync → worktree create → commit → merge.

**The Plan:**

1. Create `packages/opencode-warcraft/src/e2e/lifecycle.test.ts`:
```typescript
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { setupTempGitProject, cleanupTempDir } from './helpers/test-env.js';
import { ConfigService } from 'warcraft-core';
import { createWarcraftContainer } from '../container.js';

describe('full feature lifecycle', () => {
  let tempDir: string;
  let container: WarcraftContainer;

  beforeEach(async () => {
    tempDir = await setupTempGitProject();
    const configService = new ConfigService();
    container = createWarcraftContainer(tempDir, configService);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it('create → plan → approve → sync → worktree → commit → merge', async () => {
    // 1. Create feature
    const createTool = container.featureTools.createFeatureTool();
    const createResult = await createTool.execute({ name: 'test-feature' }, {});
    expect(createResult.ok).toBe(true);

    // 2. Write plan
    const plan = `## Plan\n\n### 1. Setup\nCreate config file.\nDepends on: none\n`;
    const writeResult = await container.planTools
      .writePlanTool(() => 'test-feature')
      .execute({ content: plan }, {});
    expect(writeResult.ok).toBe(true);

    // 3. Approve
    const approveResult = await container.planTools
      .approvePlanTool(() => 'test-feature')
      .execute({}, {});
    expect(approveResult.ok).toBe(true);

    // 4. Sync tasks
    const syncResult = await container.taskTools
      .syncTasksTool(() => 'test-feature')
      .execute({}, {});
    expect(syncResult.data.created.length).toBe(1);

    // 5-7. Worktree create → simulate changes → commit → merge
    // ...assert task statuses transition correctly
  });
});
```

**Why good:** Catches cross-layer bugs (stores, worktrees, tools, guards) that unit tests miss.
**Downsides:** Slower tests; needs careful temp cleanup.

---

### #9 — Explicit Task State Machine

**Confidence: 88%** | Effort: M | Priority: 🟠 High

**The Problem:**
Task status transitions are implicit—any code can set any status via `taskService.update(feature, task, { status: 'done' })`. No validation of `from → to` transitions, no automatic timestamp stamping.

**The Plan:**

1. Define allowed transitions:
```typescript
// warcraft-core/src/services/task-state-machine.ts
const ALLOWED_TRANSITIONS: Record<TaskStatusType, TaskStatusType[]> = {
  pending:     ['in_progress', 'cancelled'],
  in_progress: ['done', 'blocked', 'failed', 'partial', 'cancelled', 'pending'],
  blocked:     ['in_progress', 'cancelled'],
  failed:      ['pending', 'in_progress', 'cancelled'],
  partial:     ['in_progress', 'cancelled'],
  done:        [],  // terminal (no transitions out)
  cancelled:   ['pending'],  // can reopen
};

export function validateTransition(from: TaskStatusType, to: TaskStatusType): void {
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new Error(
      `Invalid task transition: ${from} → ${to}. ` +
      `Allowed from '${from}': [${ALLOWED_TRANSITIONS[from].join(', ')}]`
    );
  }
}
```

2. Add `TaskService.transition()`:
```typescript
transition(feature: string, task: string, to: TaskStatusType, patch?: Partial<TaskStatus>): void {
  const current = this.getRawStatus(feature, task);
  if (!current) throw new Error(`Task '${task}' not found`);

  validateTransition(current.status, to);

  const timestamps: Partial<TaskStatus> = {};
  if (to === 'in_progress' && !current.startedAt) timestamps.startedAt = new Date().toISOString();
  if (to === 'done' && !current.completedAt) timestamps.completedAt = new Date().toISOString();

  this.update(feature, task, { ...patch, ...timestamps, status: to });
}
```

3. Replace all `taskService.update(feature, task, { status: X })` calls in tools with `taskService.transition(feature, task, X)`.

**Why good:** Prevents stuck tasks, illegal states (e.g., done→in_progress), and ensures timestamps are consistent.
**Downsides:** Touches many call sites; needs careful migration.

---

### #1 — Typed DI Builder for `container.ts`

**Confidence: 85%** | Effort: M | Priority: 🟡 Medium

**The Problem:**
`createWarcraftContainer` is a 300-line function that manually wires ~15 services and ~7 tool modules with positional dependencies. Adding a new service requires touching many places.

**The Plan:**

1. Extract service creation into `createServices()`:
```typescript
// opencode-warcraft/src/services.ts
export function createServices(directory: string, configService: ConfigService) {
  const beadsMode = configService.getBeadsMode();
  const repository = new BeadsRepository(directory, {}, beadsMode);
  const stores = createStores(directory, beadsMode, repository);

  const planService = new PlanService(directory, stores.planStore, beadsMode);
  const taskService = new TaskService(directory, stores.taskStore, beadsMode);
  const featureService = new FeatureService(
    directory, stores.featureStore, planService, beadsMode, taskService,
  );
  const contextService = new ContextService(directory, configService);
  const agentsMdService = new AgentsMdService(directory, contextService);
  const worktreeService = createWorktreeService(directory);
  const bvTriageService = new BvTriageService(directory, beadsMode !== 'off');

  return {
    beadsMode, stores, repository,
    planService, taskService, featureService,
    contextService, agentsMdService, worktreeService,
    bvTriageService,
  };
}
```

2. Simplify `container.ts` to: `createServices()` → wire helpers → wire tool modules → return.

**Why good:** Reduces wiring mistakes, makes refactors safer, separates "what exists" from "how it's wired."
**Downsides:** Mostly refactor churn; some merge conflicts.

---

### #2 — `RuntimeContext` Object

**Confidence: 80%** | Effort: M | Priority: 🟡 Medium

**The Problem:**
`beadsMode`, `verificationModel`, `workflowGatesMode` are threaded individually through constructors and tool deps. Adding a new cross-cutting config requires touching every layer.

**The Plan:**
```typescript
// warcraft-core/src/types.ts
export interface RuntimeContext {
  directory: string;
  beadsMode: BeadsMode;
  verificationModel: 'tdd' | 'best-effort';
  workflowGatesMode: 'enforce' | 'warn';
}
```

Pass this single object instead of individual flags. Services and tools destructure what they need.

**Why good:** Reduces accidental inconsistencies; simplifies signatures.
**Downsides:** Signature churn across the codebase.

---

### #6 — Tool-Level Retry + Backoff

**Confidence: 85%** | Effort: M | Priority: 🟡 Medium

**The Plan:**
```typescript
// warcraft-core/src/utils/retry.ts
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const { attempts = 3, baseMs = 200, label = 'operation' } = opts;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await Bun.sleep(baseMs * (i + 1));
    }
  }
  throw lastErr;
}
```

Apply to: `worktreeService.create()` (around `git.worktreeAdd`), beads sync calls, plan sync to external store.

**Why good:** Reduces flake from transient git/fs issues without changing behavior.
**Downsides:** Can hide persistent failures if not surfaced (pair with diagnostics logging).

---

### #8 — Plan Versioning (Snapshots)

**Confidence: 83%** | Effort: M | Priority: 🟡 Medium

**The Plan:**

1. On every `PlanService.write`, save a snapshot:
```typescript
write(featureName: string, content: string): string {
  const planPath = getPlanPath(this.projectRoot, featureName, this.beadsMode);
  writeText(planPath, content);

  // Snapshot
  const hash = computePlanHash(content).slice(0, 8);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotDir = path.join(
    getFeaturePath(this.projectRoot, featureName, this.beadsMode),
    'plan', 'versions',
  );
  fs.mkdirSync(snapshotDir, { recursive: true });
  writeText(path.join(snapshotDir, `${timestamp}-${hash}.md`), content);

  // ... rest of existing logic
}
```

2. Add `warcraft_plan_versions` tool to list versions and diff two hashes using `git diff --no-index`.

**Why good:** Improves auditability, reduces fear of editing plans, makes approvals more meaningful.
**Downsides:** More files; needs pruning policy later.

---

### #10 — Worker Heartbeat Tracking

**Confidence: 75%** | Effort: M | Priority: 🟡 Medium

**The Plan:**

1. Initialize full `workerSession` on dispatch:
```typescript
taskService.patchBackgroundFields(feature, task, {
  workerSession: {
    sessionId: ctx.sessionID,
    agent: 'mekkatorque',
    mode: 'delegate',
    lastHeartbeatAt: new Date().toISOString(),
    attempt,
  },
});
```

2. In `warcraft_status`, show staleness:
```typescript
const lastHeartbeat = rawStatus?.workerSession?.lastHeartbeatAt;
const staleMinutes = lastHeartbeat
  ? Math.floor((Date.now() - new Date(lastHeartbeat).getTime()) / 60000)
  : null;
```

**Why good:** Makes "hung worker" diagnosable; enables future timeout policies.
**Downsides:** Depends on worker compliance for periodic updates.

---

### #11 — Local Analytics via JSONL Event Log

**Confidence: 82%** | Effort: S/M | Priority: 🟡 Medium

**The Plan:**
```typescript
// warcraft-core/src/services/event-logger.ts
export class EventLogger {
  private stream: fs.WriteStream;

  constructor(logDir: string) {
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'events.jsonl');
    this.stream = fs.createWriteStream(logPath, { flags: 'a' });
  }

  log(event: {
    type: string;           // 'task.dispatched' | 'task.committed' | 'task.merged' | 'task.blocked'
    feature: string;
    task?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const entry = { ...event, timestamp: new Date().toISOString() };
    this.stream.write(JSON.stringify(entry) + '\n');
  }
}
```

Log key events: dispatch, commit, merge, blocked, retry. Include correlation IDs.

**Why good:** "No structured telemetry" is a core blind spot; JSONL is zero-dependency.
**Downsides:** Log growth; add max size or date-based rotation later.

---

### #12 — Prompt Regression Snapshot Tests

**Confidence: 87%** | Effort: S | Priority: 🟡 Medium

**The Plan:**
```typescript
// opencode-warcraft/src/agents/prompts.test.ts (extend existing)
import { expect, it } from 'bun:test';
import { buildKhadgarPrompt } from './khadgar.js';
import { buildSaurfangPrompt } from './saurfang.js';
import { buildMekkatorquePrompt } from './mekkatorque.js';

it('khadgar prompt (tdd) snapshot', () => {
  expect(buildKhadgarPrompt({ verificationModel: 'tdd' })).toMatchSnapshot();
});

it('khadgar prompt (best-effort) snapshot', () => {
  expect(buildKhadgarPrompt({ verificationModel: 'best-effort' })).toMatchSnapshot();
});

it('mekkatorque prompt (tdd) snapshot', () => {
  expect(buildMekkatorquePrompt({ verificationModel: 'tdd' })).toMatchSnapshot();
});

// ... same for all agents and modes
```

Require explicit `bun test --update-snapshots` when prompts change intentionally.

**Why good:** Prompts are production code; prevents accidental degradations during refactors.
**Downsides:** Snapshots can be noisy if prompts churn often (acceptable tradeoff).

---

### #14 — Security Hardening for File Writes

**Confidence: 90%** | Effort: S/M | Priority: 🟡 Medium

**The Plan:**

1. Strengthen `validatePathSegment` to reject traversal:
```typescript
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

export function validatePathSegment(value: string, label: string): void {
  if (!value || value.includes('/') || value.includes('\\') || value === '..' || value === '.') {
    throw new Error(`Invalid ${label}: must not contain path separators or traversal`);
  }
  if (!SAFE_NAME.test(value)) {
    throw new Error(`Invalid ${label}: must match ${SAFE_NAME.source}`);
  }
}
```

2. In `ContextService.write`, enforce final path is inside feature context dir:
```typescript
const resolvedPath = path.resolve(contextDir, `${name}.md`);
if (!isPathInside(resolvedPath, contextDir)) {
  throw new Error(`Context file path escapes feature directory: ${resolvedPath}`);
}
```

3. Add tests for traversal attempts (`../etc/passwd`, absolute paths, unicode).

**Why good:** Tools are a write-capable automation interface; path traversal is a real risk.
**Downsides:** Could break existing "creative" context names; provide migration note.

---

### #16 — Token/Cost Estimation

**Confidence: 78%** | Effort: S | Priority: 🟢 Low

**The Plan:**
```typescript
// Extend existing promptMeta calculation
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

// In prompt-observability.ts, add to PromptMeta:
export interface PromptMeta {
  totalChars: number;
  estimatedTokens: number;  // NEW
  // ... existing fields
}
```

Surface in `warcraft_worktree_create` and `warcraft_batch_execute` responses.

**Why good:** Helps operators budget concurrency and avoid overlong contexts.
**Downsides:** Heuristic isn't exact; still directionally useful.

---

### #17 — Rollback Merged Task

**Confidence: 80%** | Effort: M | Priority: 🟢 Low

**The Plan:**
```typescript
// WorktreeService
async rollbackMerge(sha: string): Promise<{ success: boolean; revertSha?: string; error?: string }> {
  const git = this.getGit();
  try {
    // -m 1 for merge commits (mainline parent)
    await git.raw(['revert', '-m', '1', '--no-edit', sha]);
    const head = await git.revparse(['HEAD']);
    return { success: true, revertSha: head };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await git.raw(['revert', '--abort']).catch(() => {});
    return { success: false, error: msg };
  }
}
```

Expose as `warcraft_merge({ task, rollback: true })` or a dedicated `warcraft_merge_rollback`.

**Why good:** Reduces fear of merging; enables safer automation.
**Downsides:** Revert can conflict; need to surface conflicts clearly.

---

### #21 — `warcraft_plan_lint` Tool

**Confidence: 88%** | Effort: M | Priority: 🟠 High

**The Plan:**
```typescript
interface LintIssue {
  line: number;
  severity: 'error' | 'warning';
  rule: string;
  message: string;
}

function lintPlan(content: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const lines = content.split('\n');

  // Check: task headers parse correctly (### N. Name)
  // Check: dependency lines valid + no unknown numbers
  // Check: unique numeric prefixes
  // Check: required sections per task: "Verify", "Must NOT", "Files"
  // Check: no orphaned dependencies
  // Check: no cycles (reuse detectCycles)

  return issues;
}
```

Expose as `warcraft_plan_lint({ feature })` returning `{ ok: boolean, issues: LintIssue[] }`.

**Why good:** Plan quality is the root of agent success; catches problems before they cascade into execution failures.
**Downsides:** May be annoying if too strict; start as warn-only.

---

### #23 — Structured Logger

**Confidence: 86%** | Effort: S/M | Priority: 🟡 Medium

**The Plan:**
```typescript
// warcraft-core/src/utils/logger.ts
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  code?: string;
  message: string;
  feature?: string;
  task?: string;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(entry: Omit<LogEntry, 'level'>): void;
  info(entry: Omit<LogEntry, 'level'>): void;
  warn(entry: Omit<LogEntry, 'level'>): void;
  error(entry: Omit<LogEntry, 'level'>): void;
}

export function createLogger(sink?: (entry: LogEntry) => void): Logger {
  const emit = sink ?? ((entry) => {
    const fn = entry.level === 'error' ? console.error
             : entry.level === 'warn' ? console.warn
             : console.log;
    fn(`[warcraft:${entry.level}] ${entry.code ? `(${entry.code}) ` : ''}${entry.message}`);
  });

  return {
    debug: (e) => emit({ ...e, level: 'debug' }),
    info:  (e) => emit({ ...e, level: 'info' }),
    warn:  (e) => emit({ ...e, level: 'warn' }),
    error: (e) => emit({ ...e, level: 'error' }),
  };
}
```

Inject via DI; replace all `console.warn('[warcraft]...')` calls.

**Why good:** Makes diagnosing degraded paths realistic; pairs with `OperationOutcome` and event logging.
**Downsides:** Minor churn; avoid over-logging.

---

### #24 — Tighten Merge Verification

**Confidence: 84%** | Effort: S/M | Priority: 🟢 Low

**The Plan:**
In `warcraft_merge`, when `verificationModel === 'tdd'`, default `verify: true`:
```typescript
const effectiveVerify = verify ?? (verificationModel === 'tdd');
```

Ensure verification uses repo root commands and includes outputs in tool response.

**Why good:** Integration failures caught right after merge reduce downstream breakage.
**Downsides:** Slower merges; allow explicit override.

---

### #26 — Auto-Run Biome Before Commit

**Confidence: 77%** | Effort: M | Priority: 🟢 Low

**The Plan:**
In `WorktreeService.commitChanges`, before `git add`:
```typescript
try {
  const status = await worktreeGit.status(worktreePath);
  const changedFiles = [...status.modified, ...status.not_added, ...status.created]
    .filter(f => /\.(ts|tsx|js|jsx|json)$/.test(f));

  if (changedFiles.length > 0) {
    await execAsync(`bunx biome check --write ${changedFiles.join(' ')}`, { cwd: worktreePath });
  }
} catch { /* non-fatal */ }
```

**Why good:** Reduces style noise and review friction; keeps diffs clean.
**Downsides:** Needs Biome installed; can be slow on many files.

---

### #27 — Per-Task Concurrency Lock

**Confidence: 89%** | Effort: S | Priority: 🟡 Medium

**The Plan:**
Reuse existing `acquireLock` from `json-lock.ts`:
```typescript
// In dispatchOneTask (unified dispatch):
const lockPath = path.join(warcraftDir, '.locks', feature, `${task}.dispatch`);
const release = await acquireLock(lockPath, { timeout: 5000 });
try {
  // Check task not already in_progress
  // Create worktree, update status, build prompt
  return result;
} finally {
  release();
}
```

**Why good:** Prevents duplicate worktrees / clobbered artifacts when operators accidentally dispatch twice.
**Downsides:** Deadlocks if lock not released; `finally` block prevents this.

---

### #28 — Standardize Blocker Schema

**Confidence: 82%** | Effort: S/M | Priority: 🟡 Medium

**The Plan:**
```typescript
// warcraft-core/src/types.ts
export type BlockerCategory =
  | 'requirements'    // Need clarification on business logic
  | 'environment'     // Missing dependency, broken tooling
  | 'merge-conflict'  // Git conflicts
  | 'test-failure'    // Tests fail after implementation
  | 'dependency'      // Blocked by another task
  | 'other';

export interface TaskBlocker {
  category: BlockerCategory;
  reason: string;
  detail?: string;
  options?: string[];
  recommendation?: string;
  suggestedTools?: string[];
}
```

Update Mekkatorque prompt to always include `category` and `suggestedTools` in blocker reports.

**Why good:** Reduces operator cognitive load; enables automated blocker routing.
**Downsides:** Schema migration (additive, non-breaking).

---

### #29 — Minimal Agent Effectiveness Harness

**Confidence: 70%** | Effort: M (start tiny) | Priority: 🟢 Low

**The Plan:**
```
eval/
├── scenarios/
│   ├── simple-feature.md       # Input + expected tool sequence
│   ├── blocked-worker.md       # Input + expected blocker handling
│   └── parallel-batch.md       # Input + expected batch dispatch
├── snapshots/                  # Captured prompt outputs
└── run-eval.ts                 # Bun script to generate + compare
```

Start with static evaluations: prompt builders include required invariants, tool responses include required fields, no regressions via snapshots. Enables safely evolving prompts later.

**Why good:** Gives a path to safely reduce prompt bloat (rejected #15) once measurement exists.
**Downsides:** Doesn't fully measure real-world performance yet.

---

### #30 — Documentation & DX Quickstart

**Confidence: 85%** | Effort: S | Priority: 🟡 Medium

**The Plan:**
Add to `docs/`:
- `quickstart.md` — How to: create feature → write plan → approve → sync tasks → execute → merge
- `troubleshooting.md` — Common issues: worktrees, sandbox, beads on/off, dependency resolution
- `plan-authoring.md` — Task header format, `Depends on:` syntax, required sections (Verify, Must NOT, Files)

Link from README.md.

**Why good:** Reduces onboarding cost and prompt burden; improves plan quality via documentation.
**Downsides:** Needs maintenance as system evolves.

---

## Weakest Parts of the System

### 1. 🔴 Verification & Gating Correctness
The regex-evidence approach in `hasCompletionGateEvidence` is the **single biggest "looks safe but isn't" mechanism**. It gates commits and merges based on untrusted natural language pattern matching. A summary like "test failed, then I fixed it and tests pass" can match both fail and pass signals. **Fix: #5 (structured verification).**

### 2. 🔴 Observability & Diagnosability
Degraded behavior is mostly `console.warn` and disappears. When beads are unavailable, dependency sync fails, or git operations are flaky, there's no post-mortem data. The `OperationOutcome` module exists but is barely used. **Fix: #3 + #23 + #11.**

### 3. 🔴 Dispatch Path Duplication
Batch and single dispatch implement the same logic with subtle differences. Every improvement (retries, verification, heartbeats, logging) must be applied in two places. **Fix: #4.**

### 4. 🟠 Operational Hygiene
"Worktrees persist until manually removed" combined with no cleanup tooling is an accumulating tax that will cause disk bloat and developer confusion. **Fix: #7 + #27.**

### 5. 🟠 Prompt Quality Control
Sophisticated agent prompts have no regression protection. Any refactor could subtly break agent behavior with no way to detect it. **Fix: #12 + #29.**

### 6. 🟠 Task Lifecycle Integrity
No explicit state machine means any code can set any status. Missing timestamps, illegal transitions (done→in_progress), and stuck states are possible. **Fix: #9.**

---

## Rollout Status & Trust Metrics

> Added during task 10 implementation. This section tracks the phased rollout of strict modes and compatibility debt removal.

### Current Rollout Phase: Compatibility (Phase 1)

All new strict behaviors ship behind compatibility flags. Existing behavior is preserved by default.

| Flag | Default | Strict Value | Status |
|------|---------|--------------|--------|
| `structuredVerificationMode` | `'compat'` | `'enforce'` | Compat — regex fallback active |
| `unifiedDispatchEnabled` | `false` | `true` | Compat — dual dispatch paths |
| `strictTaskTransitionsEnabled` | `false` | `true` | Compat — permissive transitions |

### Trust Metrics (JSONL Events)

The following metrics are tracked via `.beads/events.jsonl` and can be computed with `computeTrustMetrics()`:

| Metric | Event Type | Description | Rollout Gate |
|--------|-----------|-------------|--------------|
| **Reopen rate** | `reopen` | Tasks marked done then reopened / total completions | < 5% over 2 release cycles |
| **Blocked-task MTTR** | `blocked` → `commit` | Mean time from blocked to resolution | Trending down or stable |
| **Duplicate dispatch prevention** | `duplicate_dispatch_prevented` | Concurrent dispatch attempts caught by lock | Count > 0 confirms lock is working |
| **Prune acceptance rate** | `prune` | Dry-run → confirmed prune ratio | > 50% acceptance indicates trust in prune tool |

### Promotion Criteria (Phase 1 → Phase 2)

Before promoting strict defaults:

1. **CI gates hold**: All lifecycle tests, prompt snapshot invariants, and eval scenarios pass for 2 consecutive releases.
2. **Reopen rate < 5%**: Structured verification catches false completions effectively.
3. **Blocked MTTR stable or improving**: Recovery paths work without manual intervention.
4. **No duplicate dispatch incidents**: Per-task lock prevents all concurrent dispatch attempts.
5. **Prune acceptance > 50%**: Operators trust dry-run output enough to confirm destructive prunes.

### Phase 2: Promote Strict Defaults

After criteria met:
- Set `structuredVerificationMode` default to `'enforce'`
- Set `unifiedDispatchEnabled` default to `true`
- Set `strictTaskTransitionsEnabled` default to `true`

### Phase 3: Remove Compatibility Debt

After 2 stable release cycles on strict defaults:
- Remove regex fallback verification path
- Remove dual dispatch implementation
- Remove permissive transition logic
- Remove compatibility flags from config schema
