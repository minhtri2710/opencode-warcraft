import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type HostPreflightOptions = {
  requireGit?: boolean;
  requireBr?: boolean;
};

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

export function getHostPreflightSkipReason(options: HostPreflightOptions): string | null {
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

  if (missing.length === 0) {
    return null;
  }

  return `missing host prerequisites: ${missing.join(', ')}`;
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
