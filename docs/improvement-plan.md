# Opencode-Warcraft: Critical Improvement Plan

> Deep system analysis — weaknesses ranked by impact, with innovative solutions.

---

## Executive Summary

The biggest systemic issue is **split-brain orchestration**: workflow truth is scattered across markdown, task JSON, feature status, git worktrees, beads state, and prompt-following behavior. The highest-leverage upgrade is building a **single workflow kernel** — one dispatch path, one enforced state machine, one lease/heartbeat model for workers — with prompts/status derived from that state instead of maintained in parallel.

**If you only do three things:**
1. Unify dispatch into a single path
2. Enforce the task state machine in production
3. Make worker lifecycle real (lease/heartbeat/watchdog)

---

## 1. No Single Source of Truth for Workflow State

**Impact:** 🔴 Very High  
**Categories:** Architecture, Reliability, DX

### The Problem

State is fragmented across 5+ systems with no atomic coordination:

| State Fragment | Location | Owner |
|---|---|---|
| Feature status | `featureService.ts` | FeatureStore |
| Plan approval | `planService.ts` | PlanStore (hash-based) |
| Task status / artifacts | `taskService.ts` | TaskStore |
| Worktree existence | `worktreeService.ts` | Git + filesystem |
| Beads state | `BeadsRepository` | `br` CLI |
| Transient behavior | Agent prompts | LLM following instructions |

**Concrete failure mode:** `warcraft_worktree_create` marks a task `in_progress` *before* prompt preparation completes (`worktree-tools.ts:118-156`). If prompt generation fails, the task is stranded in-progress with no actual worker. Same pattern in `dispatch-task.ts:229-265`.

### The Fix: Workflow Kernel

Build a small **command/event workflow kernel**:

```
Commands:  StartTask → BlockTask → CompleteTask → MergeTask → ReopenTask
Events:    TaskStarted → WorkerLeased → TaskBlocked → TaskCommitted → TaskMerged
State:     Derived from event log (projections)
```

**Pragmatic v1** (no full event sourcing needed):
- One authoritative `transitionTask(feature, task, command)` function
- One authoritative `startDispatch(feature, task)` that creates a **dispatch transaction** persisted before returning
- Compensating actions on partial failure (rollback in-progress if prompt fails)

**Effort:** L (1–2 days for v1)

---

## 2. Two Dispatch Paths = Core Architectural Fragility

**Impact:** 🔴 Very High  
**Categories:** Architecture, Reliability, DX

### The Problem

There are **two ways to start a task**:
- `worktree-tools.ts:createWorktreeTool` (single task path)
- `dispatch-task.ts:dispatchOneTask` (batch path)

They duplicate: blocked check → dep check → create/reuse worktree → set in_progress → prepare prompt.

**Critical gap:** Only the batch path uses per-task dispatch locks. The single-task path bypasses them entirely.

**Deeper issue:** The system prompt claims `warcraft_worktree_create` "spawns worker automatically" (`index.ts:49-52`), but it actually returns a `taskToolCall` payload and instructions for the outer agent to invoke. Orchestration-by-prompt, not actual orchestration.

### The Fix: Plugin-Managed Executor

```typescript
// Single dispatch path for all callers
async function dispatchTask(feature: string, task: string, opts?: DispatchOpts): Promise<DispatchRecord> {
  // 1. Acquire lock
  // 2. Validate invariants (blocked, deps, state)
  // 3. Create/reuse worktree
  // 4. Transition state atomically
  // 5. Prepare prompt
  // 6. Return durable dispatch record
}
```

Both `createWorktreeTool` and `batchExecuteTool` call this single function. The LLM's only job becomes "approve these tasks," not "reconstruct exact dispatch mechanics."

**Effort:** M–L (1 day)

---

## 3. The Task State Machine Exists but Is Bypassed in Production

**Impact:** 🔴 Very High  
**Categories:** Reliability, Architecture

### The Problem

- `task-state-machine.ts` defines allowed transitions and `validateTransition()` exists.
- `TaskService` is created **without** `strictTaskTransitions` in production (`container.ts:80`).
- Most code paths call `taskService.update(...)` (free-form patch), not `transition(...)` (validated).
- `WorkerSession.attempt` / `lastHeartbeatAt` / `idempotencyKey` is mostly aspirational — `attempt` is read to compute next key but never properly advanced.

### The Fix: Semantic Transitions Only

```typescript
// Replace free-form update() with semantic methods:
taskService.startTask(feature, task, { baseCommit, workerSession });
taskService.markBlocked(feature, task, { reason, options });
taskService.markDone(feature, task, { summary, sha });
taskService.reopenTask(feature, task, { reason, actor });

// Every transition records: actor, timestamp, reason, sessionId
```

- Make `update()` private/internal
- Enable `strictTaskTransitions` in production
- Add transition reasons + actor to every mutation

**Effort:** M (0.5–1 day)

---

## 4. Prompt Stack Is Redundant, Over-Prescriptive, and Drifting

**Impact:** 🟠 High  
**Categories:** Prompt Engineering, DX, Performance

### The Problem

| Layer | Approximate Size | Content |
|---|---|---|
| Static system prompt | `index.ts:14-104` | Tool table, workflow, batch, research |
| Khadgar role prompt | ~250 lines | Phase detection, planning, orchestration, iron laws |
| Saurfang role prompt | ~150 lines | Intent gate, delegation, merge, iron laws |
| Mekkatorque role prompt | ~200 lines | Execution flow, verification, completion checklist |

**Repeated rules across multiple prompts:**
- "use `question()`" — 4× across Khadgar, Saurfang, system prompt
- "call `warcraft_status()`" — 5× total
- "`task()` is BLOCKING" — 3×
- "delegate by default" — repeated in Khadgar + Saurfang

**Over-prescriptive:** Brann: "ALWAYS run 3+ tools simultaneously" — this makes Brann busy, not smart.

**Drifting:** System prompt says "spawns worker automatically" vs implementation returns `taskToolCall`.

### The Fix: Prompt Compiler

```
┌─────────────────┐
│  Core Laws       │  ~20 lines, universal, stable
├─────────────────┤
│  Role Fragment   │  What this agent IS (identity)
├─────────────────┤
│  State Fragment  │  Planning? Executing? Blocked? (dynamic)
├─────────────────┤
│  Capability Frag │  Only tools available to THIS agent
├─────────────────┤
│  Risk Fragment   │  Only when: truncation, parallel, risky files
└─────────────────┘
```

Replace hard rules with **goal-conditioned heuristics:**
- ❌ "ALWAYS run 3+ tools simultaneously"
- ✅ "Use the minimum number of sources needed to establish confidence. When uncertain, prefer parallel evidence gathering."

**Effort:** M (1 day)

---

## 5. Markdown Is Acting as a Control Plane

**Impact:** 🟠 High  
**Categories:** Architecture, Reliability, DX

### The Problem

Task extraction is regex-driven from `### N. Task Name` and `Depends on:` lines (`taskService.ts:809-879`). Tiny markdown drift can silently alter task identity, dependencies, parallelism, and ordering.

**Hidden contracts:**
- Exact `### N. ` format required
- `Depends on:` with specific formatting
- No validation of markdown structure before parse

### The Fix: Dual-Format Plans

Keep human-readable markdown, but embed structured blocks:

```markdown
### 1. Setup Authentication

<!-- warcraft:task
id: setup-auth
depends_on: []
files:
  - create: src/auth/provider.ts
  - modify: src/app.ts:10-25
verify: "bun test --filter auth"
risk: low
parallelizable: true
-->

Implementation details in natural language...
```

Parse the structured section for orchestration; render markdown from it when needed. Deterministic orchestration, human-friendly UX.

**Effort:** M (1 day)

---

## 6. Observability Is Aspirational, Not Operational

**Impact:** 🟡 Medium-High  
**Categories:** Reliability, DX, Performance

### The Problem

- Event logger defines types for `merge`, `retry`, `degraded`, `duplicate_dispatch_prevented` — but code mostly emits `dispatch`, `blocked`, `commit`
- Logging is **synchronous file append** (`appendFileSync`) on hot paths
- `computeTrustMetrics()` exists but isn't surfaced anywhere in normal operation
- When behavior is weird, operators must inspect feature files + worktree state + git status + prompt output + beads state

### The Fix: Operation Traces

```
┌────────────────────────────────────────────────────┐
│  Correlation ID per feature/task/dispatch attempt   │
├────────────────────────────────────────────────────┤
│  Async append queue (not appendFileSync)            │
├────────────────────────────────────────────────────┤
│  Event spans: dispatch → worker → commit → merge    │
├────────────────────────────────────────────────────┤
│  Health views:                                      │
│  • Stuck in-progress tasks                          │
│  • Retries by task                                  │
│  • Merge conflict rate                              │
│  • Prompt truncation rate                           │
│  • Blocked MTTR by agent                            │
│  • Worker session duration histogram                │
└────────────────────────────────────────────────────┘
```

Think "mini-OpenTelemetry for local agent workflows." Surface trust metrics in `warcraft_status` output so agents and operators can see system health.

**Effort:** M (1 day)

---

## 7. Status and Verification Paths Do Too Much Expensive I/O

**Impact:** 🟡 Medium-High  
**Categories:** Performance, Reliability

### The Problem

- `warcraft_status` does per-task `worktreeService.get()` → fs access + `git revparse`
- `hasUncommittedChanges()` → full `git status` per worktree
- `mergeTaskTool` verifies using `process.cwd()` (`worktree-tools.ts:590`) — **correctness bug** if plugin cwd ≠ repo root

### The Fix: Repo Snapshot Cache

```typescript
class RepoSnapshot {
  private cache: Map<string, WorktreeState>;
  private ttl = 5_000; // 5s

  async getWorktreeState(feature: string, task: string): Promise<WorktreeState> {
    // Single git operation, cache all worktree info
    // Invalidate on mutations (create, commit, merge)
  }
}
```

Also fix merge verification to use `directory` (container-scoped project root) instead of `process.cwd()`.

**Effort:** S–M (0.5 day)

---

## 8. Config and Lifecycle State Are Not Team-Scalable

**Impact:** 🟡 Medium  
**Categories:** DX, Reliability

### The Problem

- Config is user-global at `~/.config/opencode/opencode_warcraft.json`
- Manual external edits require session restart (cached, no file watcher)
- `cachedStatusHint` and hook counters are **module-level globals** (`index.ts:106-107`)
- No repo-local config override — teams can't share project-specific settings

### The Fix: Layered Config + Container-Scoped State

```
Config resolution:
  1. .warcraft/config.json     (repo-local, committed)
  2. ~/.config/.../config.json (user-global)
  3. DEFAULT_WARCRAFT_CONFIG   (built-in defaults)
```

Move all mutable state (status hint cache, hook counters) into the `WarcraftContainer` instance, not module globals:

```typescript
// Before (fragile):
let cachedStatusHint: { ... } | null = null;  // module global

// After (robust):
class WarcraftContainer {
  private statusHintCache: StatusHintCache;  // instance-scoped
  private hookCounters: HookCounters;        // instance-scoped
}
```

**Effort:** M (0.5–1 day)

---

## 9. Scheduler Is Dependency-Aware, Not Contention-Aware

**Impact:** 🟡 Medium  
**Categories:** Innovation, Architecture, Performance

### The Problem

The system already asks plans to specify files/references, but execution only checks dependency readiness. It ignores predicted merge conflict risk.

"Parallel" is based on dependency graph only, not:
- Predicted file overlap between tasks
- Shared module coupling
- Historical churn hotspots
- Test suite interdependencies

### The Fix: Conflict-Aware Scheduler

```typescript
interface TaskConflictGraph {
  // Extract touched files from task specs/plans
  predictedFiles: Map<string, Set<string>>;

  // Build overlap matrix
  overlapScore(taskA: string, taskB: string): number;

  // Graph-color compatible parallel sets
  getParallelSets(): string[][];

  // Risk ranking
  mergeRisk(task: string): 'low' | 'medium' | 'high';
}
```

Parallelize only graph-color-compatible task sets. Rank by expected merge pain. This is the jump from "functional parallelism" to "high-throughput safe parallelism."

**Effort:** L (2+ days)

---

## 10. Review Is Optional/Manual Instead of Risk-Triggered

**Impact:** 🟢 Medium-Low  
**Categories:** Prompt Engineering, Innovation

### The Problem

Algalon (reviewer) is invoked only by explicit user choice. That's polite but not optimal — risky changes get the same (lack of) review as trivial ones.

### The Fix: Adaptive Quality Control

Auto-trigger review when risk score crosses a threshold:

| Risk Signal | Weight |
|---|---|
| Prompt truncation occurred | High |
| Task touches critical files (config, auth, schema) | High |
| Verification deferred (best-effort mode) | Medium |
| Merge conflict likelihood > 50% | Medium |
| Worker had retries/blockers | Medium |
| Diff size > 200 lines | Low |
| Multiple dependencies fan-in | Low |

```typescript
function shouldAutoReview(task: TaskContext): boolean {
  const score = computeRiskScore(task);
  return score > REVIEW_THRESHOLD; // e.g., 0.6
}
```

Adaptive quality control instead of uniform process.

**Effort:** S–M (0.5 day)

---

## Implementation Roadmap

### Phase 1: Foundation Hardening (Week 1)
| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | Unify dispatch into single path | M | 🔴 Very High |
| 2 | Enforce task state machine | M | 🔴 Very High |
| 3 | Fix `process.cwd()` verification bug | S | 🟡 Med-High |
| 4 | Move module globals into container | S | 🟡 Medium |

### Phase 2: Reliability & Observability (Week 2)
| # | Item | Effort | Impact |
|---|------|--------|--------|
| 5 | Workflow kernel v1 (dispatch transactions) | L | 🔴 Very High |
| 6 | Async event logger with correlation IDs | M | 🟡 Med-High |
| 7 | Repo snapshot cache for status | S-M | 🟡 Med-High |
| 8 | Surface trust metrics in warcraft_status | S | 🟡 Medium |

### Phase 3: Intelligence & Innovation (Week 3+)
| # | Item | Effort | Impact |
|---|------|--------|--------|
| 9 | Prompt compiler (state/capability-aware) | M | 🟠 High |
| 10 | Dual-format plans (structured + markdown) | M | 🟠 High |
| 11 | Layered config (repo-local + user + defaults) | M | 🟡 Medium |
| 12 | Conflict-aware scheduler | L | 🟡 Medium |
| 13 | Risk-triggered auto-review | S-M | 🟢 Med-Low |

### "Moon Shot" Phase
| Item | What It Unlocks |
|---|---|
| Worker lease/heartbeat/watchdog | Detect and recover from stuck workers |
| Append-only command/event log | Full replay, audit trail, undo |
| Operational console | Feature timeline, blocked chains, confidence scores |
| ML-based routing | Task → best agent/model routing based on task characteristics |

---

## When to Accelerate

Adopt heavier workflow-kernel / scheduler work when you see:
- Tasks stuck `in_progress` without a living worker
- Confusing merge/dispatch races
- 10+ concurrent tasks per feature
- Frequent prompt truncation
- Operators needing to inspect raw files/git state to debug
- Parallel execution causing more merge pain than speedup

---

## Design Principles for All Changes

1. **One path, one truth** — Never duplicate dispatch/transition logic
2. **State derives behavior** — Prompts, status, scheduling all derive from authoritative state
3. **Fail loud, recover gracefully** — Compensating actions > silent corruption
4. **Observe everything, alarm on anomalies** — Trust metrics are not optional
5. **Human UX preserved** — Markdown plans stay human-friendly; structured data is additive
