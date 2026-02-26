import * as path from 'path';
import * as fs from 'fs';
import type { BeadsMode } from '../types.js';

const WARCRAFT_DIR_BEADS_ON = '.beads/artifacts';
const WARCRAFT_DIR_BEADS_OFF = 'docs';
const TASKS_DIR = 'tasks';
const CONTEXT_DIR = 'context';
const PLAN_FILE = 'plan.md';
const FEATURE_FILE = 'feature.json';
const STATUS_FILE = 'status.json';
const REPORT_FILE = 'report.md';
const WORKTREES_DIR = '.worktrees';

/**
 * Validate and sanitize a name used as a filesystem path segment.
 * Rejects path traversal attempts and dangerous characters.
 * @throws Error if name contains invalid characters
 */
export function sanitizeName(name: string): string {
  if (!name || name.trim().length === 0) {
    throw new Error('Name cannot be empty');
  }
  if (/[/\\]/.test(name)) {
    throw new Error(`Name cannot contain path separators: "${name}"`);
  }
  if (name === '..' || name === '.' || name.startsWith('..')) {
    throw new Error(`Name cannot be a relative path reference: "${name}"`);
  }
  if (name.startsWith('.')) {
    throw new Error(`Name cannot start with a dot: "${name}"`);
  }
  if (/[\x00-\x1f\x7f]/.test(name)) {
    throw new Error(`Name cannot contain control characters: "${name}"`);
  }
  return name;
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

/**
 * Get the base warcraft directory name based on beadsMode.
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 * @returns The directory name segment(s)
 */
export function getWarcraftDir(beadsMode: BeadsMode = 'off'): string {
  return beadsMode === 'on' ? WARCRAFT_DIR_BEADS_ON : WARCRAFT_DIR_BEADS_OFF;
}

/**
 * Get the full warcraft path based on beadsMode.
 * @param projectRoot - The project root directory
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 * @returns The full path to the warcraft directory
 */
export function getWarcraftPath(projectRoot: string, beadsMode: BeadsMode = 'off'): string {
  return path.join(projectRoot, getWarcraftDir(beadsMode));
}

/**
 * Get the canonical feature path.
 * Uses flat layout: <warcraftDir>/<featureName>
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 * @returns The canonical feature path
 */
export function getFeaturePath(projectRoot: string, featureName: string, beadsMode: BeadsMode = 'off'): string {
  return path.join(getWarcraftPath(projectRoot, beadsMode), featureName);
}

/**
 * List all feature directories in the warcraft artifacts directory.
 * Uses canonical flat layout only.
 * Excludes special directories like .worktrees and internal files.
 * @param projectRoot - The project root directory
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 */
export function listFeatureDirectories(projectRoot: string, beadsMode: BeadsMode = 'off'): string[] {
  const warcraftPath = getWarcraftPath(projectRoot, beadsMode);
  const features = new Set<string>();

  // Scan canonical flat location only
  if (fs.existsSync(warcraftPath)) {
    const entries = fs.readdirSync(warcraftPath, { withFileTypes: true })
      .filter(entry => {
        // Must be a directory
        if (!entry.isDirectory()) return false;
        // Exclude special directories
        if (entry.name === WORKTREES_DIR) return false;
        if (entry.name.startsWith('.')) return false;
        return true;
      })
      .map(entry => entry.name);

    for (const entry of entries) {
      features.add(entry);
    }
  }

  return Array.from(features);
}

/**
 * Get the plan.md path for a feature.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 */
export function getPlanPath(projectRoot: string, featureName: string, beadsMode: BeadsMode = 'off'): string {
  return path.join(getFeaturePath(projectRoot, featureName, beadsMode), PLAN_FILE);
}

/**
 * Get the feature.json path for a feature.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs
 */
export function getFeatureJsonPath(projectRoot: string, featureName: string, beadsMode: BeadsMode): string {
  return path.join(getFeaturePath(projectRoot, featureName, beadsMode), FEATURE_FILE);
}

/**
 * Get the context directory path for a feature.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param beadsMode - 'on' for .beads/artifacts, 'off' for docs (default: 'off')
 */
export function getContextPath(projectRoot: string, featureName: string, beadsMode: BeadsMode = 'off'): string {
  return path.join(getFeaturePath(projectRoot, featureName, beadsMode), CONTEXT_DIR);
}

/**
 * Get the tasks directory path for a feature.
 * Always resolves via off-mode (docs-based) path tree.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 */
export function getTasksPath(
  projectRoot: string,
  featureName: string,
): string {
  return path.join(getFeaturePath(projectRoot, featureName, 'off'), TASKS_DIR);
}

/**
 * Get the path for a specific task folder.
 * Always resolves via off-mode (docs-based) path tree.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param taskFolder - The task folder name
 */
export function getTaskPath(
  projectRoot: string,
  featureName: string,
  taskFolder: string,
): string {
  return path.join(getTasksPath(projectRoot, featureName), taskFolder);
}

/**
 * Get the status.json path for a task.
 * Always resolves via off-mode (docs-based) path tree.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param taskFolder - The task folder name
 */
export function getTaskStatusPath(
  projectRoot: string,
  featureName: string,
  taskFolder: string,
): string {
  return path.join(getTaskPath(projectRoot, featureName, taskFolder), STATUS_FILE);
}

/**
 * Get the report.md path for a task.
 * Always resolves via off-mode (docs-based) path tree.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param taskFolder - The task folder name
 */
export function getTaskReportPath(
  projectRoot: string,
  featureName: string,
  taskFolder: string,
): string {
  return path.join(getTaskPath(projectRoot, featureName, taskFolder), REPORT_FILE);
}

/**
 * Get the spec.md path for a task.
 * Always resolves via off-mode (docs-based) path tree.
 * @param projectRoot - The project root directory
 * @param featureName - The feature name
 * @param taskFolder - The task folder name
 */
export function getTaskSpecPath(
  projectRoot: string,
  featureName: string,
  taskFolder: string,
): string {
  return path.join(getTaskPath(projectRoot, featureName, taskFolder), 'spec.md');
}
