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
  ./eval/worker-prompt-tool-access.audit.test.ts \
  ./eval/warcraft-skill-error-recovery.audit.test.ts \
  ./eval/context-next-action-nonterminal.audit.test.ts \
  ./eval/doctor-direct-mode-wording.audit.test.ts \
  ./eval/warcraft-skill-discard-table.audit.test.ts \
  ./eval/batch-preview-nonterminal.audit.test.ts \
  ./eval/context-dead-review-branch.audit.test.ts \
  ./eval/discard-task-existence-check.audit.test.ts \
  ./eval/worktree-response-dead-code.audit.test.ts \
  ./eval/worker-prompt-tool-completeness.audit.test.ts \
  ./eval/batch-execute-nondispatchable-status.audit.test.ts \
  ./eval/mcp-esm-extensions.audit.test.ts \
  ./eval/quickstart-merge-description.audit.test.ts \
  ./eval/readme-skill-table-accuracy.audit.test.ts \
  ./eval/skill-docker-subagent-workspace.audit.test.ts \
  ./eval/skill-executing-plans-delegation.audit.test.ts \
  ./eval/skill-finishing-branch-workspace.audit.test.ts \
  ./eval/skill-parallel-exploration-ref.audit.test.ts \
  ./eval/skill-registry-freshness.audit.test.ts \
  ./eval/skill-warcraft-merge-description.audit.test.ts \
  ./eval/task-timestamp-reset.audit.test.ts \
  ./eval/feature-complete-irreversible.audit.test.ts \
  ./eval/warcraft-tools-docs-completeness.audit.test.ts \
  ./eval/readme-tool-completeness.audit.test.ts \
  ./eval/root-readme-tool-count.audit.test.ts \
  ./eval/agents-md-tool-count.audit.test.ts \
  ./eval/troubleshooting-blocked-resume.audit.test.ts \
  ./eval/plan-authoring-workspace.audit.test.ts \
  ./eval/docs-delegation-wording.audit.test.ts \
  ./eval/scenarios-wording.audit.test.ts \
  ./eval/task-preparedat-central-stamp.audit.test.ts \
  ./eval/artifact-schema-preparedat.audit.test.ts \
  ./eval/bead-decoder-status-mapping.audit.test.ts \
  ./eval/feature-patchmetadata-status-bypass.audit.test.ts \
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
