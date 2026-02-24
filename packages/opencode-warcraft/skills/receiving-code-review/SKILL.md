---
name: receiving-code-review
description: Use when review feedback arrives and you must evaluate, clarify, and apply it with technical rigor.
---

# Receiving Code Review

## Overview

Treat review as technical input, not ceremony.

Core loop:
1. Understand each comment
2. Verify against code and requirements
3. Apply or push back with evidence
4. Re-test

## Response Rules

For every review item:
- Restate the technical claim
- Confirm whether it is valid in this codebase
- Make the smallest correct change
- Show verification evidence

If unclear:
- Pause implementation
- Ask precise clarification questions

If you disagree:
- Explain with concrete evidence (code path, tests, constraints)
- Propose a safer alternative

## Priority Order

1. Correctness and safety defects
2. Requirement mismatches
3. Maintainability and simplification
4. Cosmetic/style suggestions

## Red Flags

Never:
- Blindly implement unverified suggestions
- Ignore critical findings because tests are currently green
- Continue when requirements are still ambiguous

Always:
- Resolve ambiguity first
- Verify each meaningful fix
- Keep a short audit trail of what changed and why
