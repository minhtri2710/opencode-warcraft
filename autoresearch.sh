#!/bin/bash
set -euo pipefail
bun run --filter warcraft-core build >/dev/null
bun eval/instant-workflow-score.ts
