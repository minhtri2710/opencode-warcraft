#!/bin/bash
set -e
cd /Users/beowulf/Work/personal/opencode-warcraft
bun test packages/warcraft-core/ 2>&1 | tail -5
bun run lint 2>&1 | tail -10
