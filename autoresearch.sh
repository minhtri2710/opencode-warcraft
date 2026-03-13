#!/bin/bash
set -euo pipefail

TMP_OUTPUT="$(mktemp)"
START_MS="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"

# Fast audit suite for current fresh-eye bug-hunt scope.
set +e
bun test \
  packages/opencode-warcraft/src/tools/feature-tools.test.ts \
  packages/opencode-warcraft/src/tools/worktree-tools.test.ts \
  packages/opencode-warcraft/src/services/dispatch-coordinator.test.ts \
  packages/opencode-warcraft/src/tools/dispatch-task.test.ts \
  ./eval/doctor-tool.audit.test.ts \
  ./eval/context-tools.audit.test.ts \
  ./eval/context-tools-workspace.audit.test.ts \
  packages/opencode-warcraft/src/index.test.ts \
  >"$TMP_OUTPUT" 2>&1
STATUS=$?
set -e

cat "$TMP_OUTPUT"

FAILURES=0
if [ "$STATUS" -ne 0 ]; then
  FAILURES="$(python3 - "$TMP_OUTPUT" <<'PY'
import re
import sys
text = open(sys.argv[1], 'r', encoding='utf-8').read()
match = re.search(r'\n\s*(\d+) fail\b', text)
print(match.group(1) if match else 1)
PY
)"
fi

END_MS="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
RUNTIME_MS=$((END_MS - START_MS))

echo "METRIC audit_failures=${FAILURES}"
echo "METRIC audit_runtime_ms=${RUNTIME_MS}"

# The autoresearch harness always exits successfully and lets the metric capture
# the number of failing audit assertions. Correctness backpressure comes from
# autoresearch.checks.sh, which runs after passing benchmark executions.
exit 0
