#!/bin/bash
set -euo pipefail
bun test \
  packages/warcraft-core/src/services/taskService.test.ts \
  packages/warcraft-core/src/services/specFormatter.test.ts \
  packages/warcraft-core/src/services/beads/artifactSchemas.test.ts \
  packages/warcraft-core/src/services/planGates/workflow-analysis.test.ts \
  packages/opencode-warcraft/src/tools/feature-tools.test.ts \
  packages/opencode-warcraft/src/tools/plan-tools.test.ts \
  packages/opencode-warcraft/src/tools/task-tools.test.ts \
  packages/opencode-warcraft/src/tools/context-tools.test.ts \
  packages/opencode-warcraft/src/agents/prompts.test.ts
