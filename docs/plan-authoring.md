# Plan Authoring Guide

How to write plans that produce reliable, executable task specifications.

## Plan Structure

Every plan must follow this structure:

```markdown
# Feature Name

## Discovery

### Original Request
- What the user asked for

### Interview Summary
- Key decisions made during planning
- Constraints identified

### Research Findings
- Codebase patterns discovered
- API/library documentation referenced
- File:line references to relevant code

---

## Non-Goals (What we're NOT building)
- Explicit scope boundaries

## Ghost Diffs (Alternatives considered and rejected)
- What was considered and why it was rejected

---

## Tasks

### 1. Task Name

**Depends on**: (none | comma-separated task numbers)

**Files:**
- Modify: `path/to/file.ts`
- Create: `path/to/new-file.ts`
- Test: `path/to/file.test.ts`

**What to do**:
- Step 1: ...
- Step 2: ...

**Must NOT do**:
- Guardrails the worker must respect

**References**:
- `file:line` -- why this reference matters

**Verify**:
- [ ] Run: `bun test path/to/test.ts` -> PASS
- [ ] Run: `bun run lint` -> PASS
```

## Required Sections

### Discovery (Required)

The `## Discovery` section proves the plan is grounded in research, not guesswork. Plans missing substantive Discovery are rejected by `warcraft_plan_write`.

Include:
- **Original Request**: What was asked, in the user's words
- **Interview Summary**: Decisions made, trade-offs accepted, constraints discovered
- **Research Findings**: File:line references, API patterns, library docs consulted

### Non-Goals (Recommended)

Explicit scope boundaries prevent workers from gold-plating. List what you intentionally chose not to build and why.

### Ghost Diffs (Recommended)

Document alternatives you considered and rejected. This prevents future workers from re-exploring dead ends and provides rationale for architectural decisions.

## Task Format

### Task Header

Tasks are parsed from `### N. Task Name` headers. The numeric prefix determines ordering.

```markdown
### 1. Add configuration flags
### 2. Implement core logic
### 3. Wire up integration
```

### Dependencies

Express dependencies with `**Depends on**: task-numbers`:

```markdown
### 3. Wire up integration

**Depends on**: 1, 2
```

Rules:
- Tasks can only start when all dependencies have `status: done`
- Circular dependencies are rejected at sync time
- If `Depends on` is omitted, implicit sequential ordering applies (task N depends on N-1)

### Files Section

List every file the worker will touch:

```markdown
**Files:**
- Modify: `packages/warcraft-core/src/services/taskService.ts`
- Create: `packages/warcraft-core/src/services/task-state-machine.ts`
- Test: `packages/warcraft-core/src/services/taskService.test.ts`
```

Use `Modify`, `Create`, or `Test` prefixes. This helps workers orient and prevents scope creep.

### What to Do (Step-by-Step)

Write concrete, ordered steps. Each step should be one logical change:

```markdown
**What to do**:
- Step 1: Add `retryCount` field to `TaskStatus` type in `types.ts`
- Step 2: Implement retry logic in `taskService.ts` using existing `acquireLock` pattern
- Step 3: Add tests for retry behavior (success after N attempts, max retries exceeded)
- Step 4: Update worker prompt to include retry count in status reports
```

Avoid vague steps like "implement the feature" or "add tests". Workers execute literally.

### Must NOT Do (Guardrails)

Prevent workers from exceeding scope:

```markdown
**Must NOT do**:
- Must NOT remove the regex fallback until migration is complete
- Must NOT change default behavior when flags are unset
- Must NOT allow `done -> in_progress` transitions in strict mode
```

### References

Link to specific code or documentation:

```markdown
**References**:
- `docs/improvement-plan.md:80` -- verification must be trustworthy first
- `packages/warcraft-core/src/services/taskService.ts:45` -- existing transition logic
```

Workers use these to find patterns and understand context before implementing.

### Verify (Acceptance Criteria)

Define exactly how to verify the task:

```markdown
**Verify**:
- [ ] Run: `bun test packages/warcraft-core/src/services/taskService.test.ts` -> PASS
- [ ] Run: `bun run lint` -> PASS
```

Workers must run these commands and report results in their commit summary. The verification model (`tdd` or `best-effort`) controls how strictly this is enforced.

## Lightweight Plans

For small, low-risk changes, use the lightweight workflow path (`workflowPath: "lightweight"`). The Discovery section is shorter but must still include mini-record fields:

```markdown
## Discovery

- **Impact**: Which files/behaviors change
- **Safety**: What could go wrong
- **Verify**: How to confirm correctness
- **Rollback**: How to undo if needed
```

Lightweight plans are constrained to a maximum of 2 tasks.

## Tips for Effective Plans

### Be Specific About File Paths

Workers operate in isolated worktrees. Ambiguous paths cause confusion:

```markdown
<!-- Bad -->
- Modify: the config service

<!-- Good -->
- Modify: `packages/warcraft-core/src/services/configService.ts`
```

### Include Context Files

During planning, save research findings using `warcraft_context_write`:

```
warcraft_context_write({
  name: "architecture",
  content: "Auth lives in /lib/auth. Uses JWT, not sessions."
})
```

Workers can read these for background on decisions made during planning.

### Order Tasks by Risk

Put high-risk, foundational tasks first. If task 3 is the riskiest, make it task 1 so failures surface early.

### Keep Tasks Independent When Possible

Independent tasks can execute in parallel via `warcraft_batch_execute`. Minimize unnecessary dependencies to maximize throughput.

### Test Commands Must Be Exact

Workers run verification commands literally. Include the full path:

```markdown
<!-- Bad -->
- [ ] Run: `bun test` -> PASS

<!-- Good -->
- [ ] Run: `bun test packages/warcraft-core/src/services/taskService.test.ts` -> PASS
```

## Rollout and Compatibility Flags

When introducing behavior changes, use feature flags for safe rollout:

```markdown
**What to do**:
- Step 1: Add `strictTaskTransitionsEnabled: boolean` flag to config
- Step 2: Implement new behavior behind the flag
- Step 3: Default to `false` (backward compatible)
- Step 4: Add tests for both flag states
```

Currently supported rollout flags:

| Flag | Type | Default | Purpose |
|------|------|---------|---------|
| `verificationModel` | `'tdd'` \| `'best-effort'` | `'tdd'` | Controls completion gate enforcement |
| `workflowGatesMode` | `'enforce'` \| `'warn'` | `'warn'` | Strictness of workflow gates |

### Migration Recommendations

When rolling out new behavior:

1. Start with compatibility mode (flags off / `warn` mode)
2. Run the change through a full feature lifecycle (plan, approve, execute, merge)
3. Monitor for regressions in existing workflows
4. Promote to strict mode after confidence is established

## See Also

- [Quickstart](quickstart.md) -- End-to-end workflow overview
- [Troubleshooting](troubleshooting.md) -- Common issues and recovery
- [WARCRAFT-TOOLS.md](../packages/opencode-warcraft/docs/WARCRAFT-TOOLS.md) -- Tool parameter reference
- [DATA-MODEL.md](../packages/opencode-warcraft/docs/DATA-MODEL.md) -- Artifact layout and data model
