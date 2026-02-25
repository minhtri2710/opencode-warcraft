import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { join, sep } from 'path';
import { execFileSync } from 'child_process';

export interface SandboxConfig {
  mode: 'none' | 'docker';
  image?: string;
  persistent?: boolean;
}

/**
 * Structured command result that avoids shell interpretation.
 * Callers should use execFile(result.command, result.args) instead of exec(string).
 */
export interface StructuredCommand {
  command: string;
  args: string[];
}

/**
 * Strict allowlist pattern for Docker image names.
 * Allows: registry/namespace/image:tag with alphanumeric, dots, hyphens, underscores, slashes.
 */
const DOCKER_IMAGE_PATTERN = /^[a-z0-9][a-z0-9._\/-]*(?::[a-z0-9][a-z0-9._-]*)?$/;

/**
 * DockerSandboxService handles Level 1 Docker sandboxing for Warcraft workers.
 * Uses ephemeral containers (docker run --rm) with volume mounts.
 * 
 * Level 1: Lightweight docker run (no devcontainer.json, no persistent containers)
 */
export class DockerSandboxService {
  /**
   * Detects appropriate Docker image based on project files in worktree.
   * 
   * @param worktreePath - Path to the worktree directory
   * @returns Docker image name, or null if Dockerfile exists (user manages their own)
   */
  static detectImage(worktreePath: string): string | null {
    // Dockerfile exists → user builds their own container
    if (existsSync(join(worktreePath, 'Dockerfile'))) {
      return null;
    }

    // Node.js project
    if (existsSync(join(worktreePath, 'package.json'))) {
      return 'node:22-slim';
    }

    // Python project
    if (existsSync(join(worktreePath, 'requirements.txt')) || 
        existsSync(join(worktreePath, 'pyproject.toml'))) {
      return 'python:3.12-slim';
    }

    // Go project
    if (existsSync(join(worktreePath, 'go.mod'))) {
      return 'golang:1.22-slim';
    }

    // Rust project
    if (existsSync(join(worktreePath, 'Cargo.toml'))) {
      return 'rust:1.77-slim';
    }

    // Fallback
    return 'ubuntu:24.04';
  }

  /**
   * Validates a Docker image name against a strict allowlist pattern.
   * Prevents injection through maliciously crafted image names.
   * 
   * @param image - Docker image name to validate
   * @throws Error if image name contains disallowed characters
   */
  static validateImage(image: string): void {
    if (!DOCKER_IMAGE_PATTERN.test(image)) {
      throw new Error(
        `Invalid Docker image name: '${image}'. Image must match pattern: ${DOCKER_IMAGE_PATTERN}`,
      );
    }
  }

  /**
   * Builds docker run command with volume mount and working directory.
   * Returns a structured command to avoid shell injection.
   * 
   * @param worktreePath - Path to the worktree directory
   * @param command - Command to execute inside container
   * @param image - Docker image to use
   * @returns Structured command with args array for execFile usage
   */
  static buildRunCommand(worktreePath: string, command: string, image: string): StructuredCommand {
    this.validateImage(image);
    return {
      command: 'docker',
      args: ['run', '--rm', '-v', `${worktreePath}:/app`, '-w', '/app', image, 'sh', '-c', command],
    };
  }

  /**
   * Generates a container name from a worktree path.
   * Extracts feature and task from <warcraft-root>/.worktrees/<feature>/<task> path segments.
   * 
   * @param worktreePath - Path to the worktree directory
   * @returns Container name (e.g., 'warcraft-my-feature-my-task')
   */
  static containerName(worktreePath: string): string {
    const parts = worktreePath.split(sep);
    const worktreeIdx = parts.indexOf('.worktrees');

    if (worktreeIdx === -1 || worktreeIdx + 2 >= parts.length) {
      return `warcraft-sandbox-${Date.now()}`;
    }

    const feature = parts[worktreeIdx + 1];
    const task = parts[worktreeIdx + 2];
    const full = `warcraft-${feature}-${task}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const hash = createHash('sha256').update(full).digest('hex').slice(0, 7);
    return `${full.slice(0, 55)}-${hash}`;
  }

  /**
   * Ensures a persistent container exists for the worktree.
   * If container already running, returns its name.
   * Otherwise, creates a new detached container.
   * 
   * @param worktreePath - Path to the worktree directory
   * @param image - Docker image to use
   * @returns Container name
   */
  static ensureContainer(worktreePath: string, image: string): string {
    const name = this.containerName(worktreePath);

    try {
      execFileSync('docker', ['inspect', '--format={{.State.Running}}', name], { stdio: 'pipe', timeout: 15_000 });
      return name;
    } catch {
      // Container doesn't exist, create it
      try {
        execFileSync(
          'docker',
          ['run', '-d', '--name', name, '-v', `${worktreePath}:/app`, '-w', '/app', image, 'tail', '-f', '/dev/null'],
          { stdio: 'pipe', timeout: 60_000 }
        );
        return name;
      } catch (runError) {
        // Container may have been created by a concurrent call
        try {
          execFileSync('docker', ['inspect', '--format={{.State.Running}}', name], { stdio: 'pipe', timeout: 15_000 });
          return name;
        } catch {
          throw runError;
        }
      }
    }
  }

  /**
   * Builds a docker exec command for persistent containers.
   * Returns a structured command to avoid shell injection.
   * 
   * @param containerName - Name of the running container
   * @param command - Command to execute
   * @returns Structured command with args array for execFile usage
   */
  static buildExecCommand(containerName: string, command: string): StructuredCommand {
    return {
      command: 'docker',
      args: ['exec', containerName, 'sh', '-c', command],
    };
  }

  /**
   * Stops and removes a persistent container for a worktree.
   * 
   * @param worktreePath - Path to the worktree directory
   */
  static stopContainer(worktreePath: string): void {
    const name = this.containerName(worktreePath);
    try {
      execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore', timeout: 15_000 });
    } catch {
      // Ignore errors (container may not exist)
    }
  }

  /**
   * Checks if Docker is available on the system.
   * 
   * @returns true if docker is available, false otherwise
   */
  static isDockerAvailable(): boolean {
    try {
      execFileSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Wraps a command with Docker container execution based on config.
   * 
   * When sandbox mode is 'docker', returns a StructuredCommand for safe execution
   * via execFile. When mode is 'none' or no wrapping is needed, returns the
   * original command string.
   * 
   * @param worktreePath - Path to the worktree directory
   * @param command - Command to execute
   * @param config - Sandbox configuration
   * @returns StructuredCommand for Docker execution, or original command string
   */
  static wrapCommand(worktreePath: string, command: string, config: SandboxConfig): StructuredCommand | string {
    // Mode: none → no wrapping
    if (config.mode === 'none') {
      return command;
    }

    // Mode: docker
    let image: string | null;

    if (config.image) {
      // Explicit image override (overrides null detection too)
      image = config.image;
    } else {
      // Auto-detect image
      image = this.detectImage(worktreePath);

      // Dockerfile exists and no override → user manages their own container
      if (image === null) {
        return command;
      }
    }

    // Use persistent container (docker exec) or ephemeral (docker run --rm)
    if (config.persistent) {
      const containerName = this.ensureContainer(worktreePath, image);
      return this.buildExecCommand(containerName, command);
    } else {
      return this.buildRunCommand(worktreePath, command, image);
    }
  }
}
