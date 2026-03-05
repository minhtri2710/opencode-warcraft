import { existsSync } from 'fs';
import { join } from 'path';

export type RuntimeKind = 'bun' | 'npm' | 'pnpm' | 'yarn';

export interface VerificationCommands {
  build: string;
  test: string;
}

const RUNTIME_COMMANDS: Record<RuntimeKind, VerificationCommands> = {
  bun: { build: 'bun run build', test: 'bun run test' },
  npm: { build: 'npm run build', test: 'npm run test' },
  pnpm: { build: 'pnpm run build', test: 'pnpm run test' },
  yarn: { build: 'yarn build', test: 'yarn test' },
};

export function detectRuntime(cwd: string): RuntimeKind {
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun';
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm';
  return 'bun';
}

export function getVerificationCommands(runtime: RuntimeKind): VerificationCommands {
  return RUNTIME_COMMANDS[runtime];
}

export function getVerificationCommandsForCwd(cwd: string): VerificationCommands {
  return getVerificationCommands(detectRuntime(cwd));
}
