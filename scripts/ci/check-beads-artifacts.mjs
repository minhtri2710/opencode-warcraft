#!/usr/bin/env node

import { execSync } from 'node:child_process';

function run(command) {
  return execSync(command, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  }).trim();
}

try {
  run('br sync --flush-only');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[beads:verify] Failed to run `br sync --flush-only`.');
  console.error(message);
  process.exit(1);
}

let status = '';
try {
  status = run('git status --porcelain -- .beads/artifacts');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[beads:verify] Failed to inspect .beads/artifacts diff.');
  console.error(message);
  process.exit(1);
}

if (!status) {
  console.log('[beads:verify] OK: .beads/artifacts is in sync.');
  process.exit(0);
}

console.error('[beads:verify] Drift detected after sync. Commit updated artifacts:');
console.error(status);
process.exit(1);
