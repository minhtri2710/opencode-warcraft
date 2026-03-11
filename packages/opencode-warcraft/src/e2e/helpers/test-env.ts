import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type HostPreflightOptions = {
  requireGit?: boolean;
  requireBr?: boolean;
};

export type E2eLane = 'smoke' | 'host' | 'runtime';

export type HostPreflightResult = {
  missing: string[];
  reason: string | null;
};

export const WARCRAFT_E2E_LANE_ENV = 'WARCRAFT_E2E_LANE';

function commandExists(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function tempDirectoryIsWritable(): boolean {
  const base = os.tmpdir();
  let probeDir: string | null = null;

  try {
    probeDir = fs.mkdtempSync(path.join(base, 'warcraft-e2e-writable-'));
    const probeFile = path.join(probeDir, 'probe.txt');
    fs.writeFileSync(probeFile, 'ok');
    fs.rmSync(probeFile, { force: true });
    return true;
  } catch {
    return false;
  } finally {
    if (probeDir) {
      fs.rmSync(probeDir, { recursive: true, force: true });
    }
  }
}

function isE2eLane(value: string | undefined): value is E2eLane {
  return value === 'smoke' || value === 'host' || value === 'runtime';
}

export function getHostPreflightResult(options: HostPreflightOptions): HostPreflightResult {
  const missing: string[] = [];

  if (options.requireGit && !commandExists('git')) {
    missing.push('git');
  }

  if (options.requireBr && !commandExists('br')) {
    missing.push('br');
  }

  if (!tempDirectoryIsWritable()) {
    missing.push('writable temp directory');
  }

  return {
    missing,
    reason: missing.length === 0 ? null : `missing host prerequisites: ${missing.join(', ')}`,
  };
}

export function getHostPreflightSkipReason(options: HostPreflightOptions): string | null {
  return getHostPreflightResult(options).reason;
}

export function getRequestedE2eLane(): E2eLane | null {
  const requestedLane = process.env[WARCRAFT_E2E_LANE_ENV];
  return isE2eLane(requestedLane) ? requestedLane : null;
}

export function isRequestedE2eLane(lane: E2eLane): boolean {
  return getRequestedE2eLane() === lane;
}

export async function waitForCondition<T>(
  probe: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 5_000,
  intervalMs = 200,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue = await probe();

  while (!predicate(lastValue) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    lastValue = await probe();
  }

  return lastValue;
}

export function createTempProjectRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

export function setupGitProject(root: string): void {
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });

  fs.writeFileSync(path.join(root, 'README.md'), 'smoke test');
  execSync('git add README.md', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "init"', { cwd: root, stdio: 'ignore' });

  if (commandExists('br')) {
    execSync('br init', { cwd: root, stdio: 'ignore' });
  }
}

export function cleanupTempProjectRoot(root: string | null | undefined): void {
  if (!root) {
    return;
  }

  fs.rmSync(root, { recursive: true, force: true });
}

/**
 * Create a Warcraft config file specifying beads mode.
 * Config is written to `~/.config/opencode/opencode_warcraft.json` relative to
 * the provided `homeDir` (which should be set as `process.env.HOME` in the test).
 */
export function createBeadsModeConfig(homeDir: string, mode: 'on' | 'off'): void {
  const configDir = path.join(homeDir, '.config', 'opencode');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'opencode_warcraft.json'), JSON.stringify({ beadsMode: mode }));
}
