#!/bin/bash
set -euo pipefail

LINT_LOG="$(mktemp)"
TEST_LOG="$(mktemp)"

if ! bun run lint >"$LINT_LOG" 2>&1; then
  tail -80 "$LINT_LOG"
  exit 1
fi

if ! bun run test >"$TEST_LOG" 2>&1; then
  tail -80 "$TEST_LOG"
  exit 1
fi
