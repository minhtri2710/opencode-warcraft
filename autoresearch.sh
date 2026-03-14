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
  ./eval/worktree-delegation.audit.test.ts \
  ./eval/worktree-tool-description.audit.test.ts \
  ./eval/agent-worktree-delegation.audit.test.ts \
  ./eval/blocked-resume-delegation.audit.test.ts \
  ./eval/blocker-protocol.audit.test.ts \
  ./eval/system-workflow-delegation.audit.test.ts \
  ./eval/saurfang-description.audit.test.ts \
  ./eval/mekkatorque-description.audit.test.ts \
  ./eval/skill-workspace-contract.audit.test.ts \
  ./eval/skill-direct-mode-compat.audit.test.ts \
  ./eval/skill-remaining-workspace-contract.audit.test.ts \
  ./eval/skill-final-workspace-wording.audit.test.ts \
  ./eval/context-next-action.audit.test.ts \
  ./eval/context-parallel-next-action.audit.test.ts \
  ./eval/task-tools-delegation.audit.test.ts \
  ./eval/worktree-tools-messaging.audit.test.ts \
  ./eval/worktree-response-blocked.audit.test.ts \
  ./eval/mekkatorque-residual.audit.test.ts \
  ./eval/mekkatorque-docker-sandbox.audit.test.ts \
  ./eval/batch-preview-next-action.audit.test.ts \
  ./eval/index-blocked-resume.audit.test.ts \
  ./eval/worker-prompt-blocker.audit.test.ts \
  ./eval/batch-jsdoc-workspace.audit.test.ts \
  ./eval/worker-prompt-jsdoc.audit.test.ts \
  ./eval/dispatch-coordinator-jsdoc.audit.test.ts \
  ./eval/worktree-commit-description.audit.test.ts \
  ./eval/merge-tool-description.audit.test.ts \
  ./eval/agents-jsdoc-isolation.audit.test.ts \
  ./eval/mekkatorque-isolation-claim.audit.test.ts \
  ./eval/tool-permissions-completeness.audit.test.ts \
  ./eval/index-tool-count.audit.test.ts \
  ./eval/turn-termination-delegation.audit.test.ts \
  ./eval/discard-description-accuracy.audit.test.ts \
  ./eval/workflow-branch-claims.audit.test.ts \
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
bun test eval/feature-complete-irreversible.audit.test.ts --no-cache 2>&1
bun test eval/warcraft-tools-docs-completeness.audit.test.ts --no-cache 2>&1
bun test eval/readme-tool-completeness.audit.test.ts --no-cache 2>&1
bun test eval/root-readme-tool-count.audit.test.ts --no-cache 2>&1
bun test eval/agents-md-tool-count.audit.test.ts --no-cache 2>&1
bun test eval/troubleshooting-blocked-resume.audit.test.ts --no-cache 2>&1
bun test eval/plan-authoring-workspace.audit.test.ts --no-cache 2>&1
bun test eval/docs-delegation-wording.audit.test.ts --no-cache 2>&1
