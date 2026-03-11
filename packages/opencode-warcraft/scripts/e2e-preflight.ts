#!/usr/bin/env bun

import { spawnSync } from 'child_process';
import { type E2eLane, getHostPreflightResult, WARCRAFT_E2E_LANE_ENV } from '../src/e2e/helpers/test-env.ts';

type RunnableLane = Exclude<E2eLane, 'smoke'>;

type LaneConfig = {
  label: string;
  readinessNote?: string;
  testArgs?: string[];
};

const LANE_CONFIGS: Record<RunnableLane, LaneConfig> = {
  host: {
    label: 'host-backed plugin E2E',
    testArgs: ['--timeout', '30000'],
  },
  runtime: {
    label: 'runtime/provider smoke E2E',
    readinessNote:
      'Runtime-specific readiness is verified by opencode-runtime-smoke.test.ts after host prerequisites pass.',
  },
};

function isRunnableLane(value: string | undefined): value is RunnableLane {
  return value === 'host' || value === 'runtime';
}

function usage(): string {
  return 'Usage: bun run ./scripts/e2e-preflight.ts <host|runtime> <test-file> [<test-file> ...]';
}

function formatFailure(lane: RunnableLane, missing: readonly string[]): string {
  const config = LANE_CONFIGS[lane];
  const nextStep =
    lane === 'runtime'
      ? 'Install/configure git and br first, then rerun the runtime lane.'
      : 'Install/configure git and br first, then rerun the host lane.';

  const lines = [
    `[warcraft:e2e] Cannot run ${config.label}.`,
    `Missing prerequisites: ${missing.join(', ')}`,
    nextStep,
  ];

  if (config.readinessNote) {
    lines.push(config.readinessNote);
  }

  return lines.join('\n');
}

function main(): void {
  const [, , laneArg, ...files] = process.argv;

  if (!isRunnableLane(laneArg) || files.length === 0) {
    console.error(usage());
    process.exit(1);
  }

  const result = getHostPreflightResult({ requireGit: true, requireBr: true });
  if (result.reason) {
    console.error(formatFailure(laneArg, result.missing));
    process.exit(1);
  }

  const config = LANE_CONFIGS[laneArg];
  console.log(`[warcraft:e2e] Host prerequisites satisfied for ${config.label}.`);
  if (config.readinessNote) {
    console.log(`[warcraft:e2e] ${config.readinessNote}`);
  }

  const child = spawnSync(process.execPath, ['test', ...(config.testArgs ?? []), ...files], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      [WARCRAFT_E2E_LANE_ENV]: laneArg,
    },
  });

  if (child.error) {
    throw child.error;
  }

  process.exit(child.status ?? 1);
}

main();
