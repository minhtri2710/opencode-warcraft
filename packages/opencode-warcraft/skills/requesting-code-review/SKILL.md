---
name: requesting-code-review
description: Use when finishing a task or milestone and you need an explicit review pass before merge or handoff.
---

# Requesting Code Review

## Overview

Ask for review before merge so defects are caught while context is fresh.

## When to Trigger

Mandatory:
- After significant task implementation
- Before `warcraft_merge`
- When changing workflow-critical behavior

Optional but useful:
- After complex refactors
- When uncertain about edge cases or scope drift

## Review Request Pattern

1. Summarize intent and constraints
   - Task/plan goal
   - Files changed
   - Verification already run

2. Dispatch reviewer
   - Use an Algalon/reviewer subagent for critical review
   - Ask for: correctness, requirement coverage, risk, and YAGNI

3. Apply feedback by severity
   - Critical/high: fix before merge
   - Medium/low: fix or document why deferred

4. Re-verify after fixes

## Minimal Review Prompt Template

- Requirement: <what had to be built>
- Scope: <changed files>
- Verification: <commands + result>
- Ask: Identify correctness gaps, missing requirements, risky patterns, and unnecessary complexity.

## Red Flags

Never:
- Skip review because a change “looks small”
- Merge with unresolved critical feedback

Always:
- Review against requirements first
- Include concrete evidence in the request
- Re-run relevant verification after applying fixes
