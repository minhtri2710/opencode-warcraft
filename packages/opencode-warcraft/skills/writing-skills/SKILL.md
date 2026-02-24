---
name: writing-skills
description: Use when creating or updating built-in skills so they remain discoverable, testable, and aligned with both upstream superpowers and Warcraft workflows.
---

# Writing Skills

## Overview

A skill exists to produce repeatable behavior in repeatable situations.

In this repository, skill sources live at:
- `packages/opencode-warcraft/skills/<skill-id>/SKILL.md`

Generated registry target:
- `packages/opencode-warcraft/src/skills/registry.generated.ts`

## Authoring Rules

1. Use valid frontmatter:
   - `name`: kebab-case skill id
   - `description`: starts with `Use when ...` and describes trigger conditions only

2. Keep content actionable:
   - clear trigger conditions
   - deterministic process/checklist
   - red flags and common mistakes

3. Align with Warcraft behavior:
   - prefer `warcraft_*` tools for workflow operations
   - keep instructions compatible with this repo's plan-first guardrails

## Upgrading from Upstream Superpowers

When refreshing skills from `obra/superpowers`:

1. Compare upstream skill directories with local `skills/`.
2. Sync overlapping skill content where it improves guidance.
3. Preserve Warcraft-specific behavior in workflow skills (for example: `warcraft_*` tool usage, runnable-task logic, worktree lifecycle).
4. Keep project-only skills intact (`warcraft`, `parallel-exploration`, `agents-md-mastery`, etc.).
5. Re-run generation and tests before handoff.

Rule of thumb: upstream provides process quality; local overrides provide project fit.

## Validation Workflow

After adding/updating skills:

1. Regenerate registry:
   - `bun run --filter opencode-warcraft generate-skills`
2. Run targeted tests:
   - `bun test src/skills`

If tests fail, fix skill content or metadata and regenerate.

## Red Flags

Never:
- Add vague descriptions that do not signal clear trigger conditions
- Copy upstream instructions that reference unavailable tools/workflows
- Edit `registry.generated.ts` manually

Always:
- Keep skill names unique
- Regenerate registry after skill edits
- Verify through tests before handoff