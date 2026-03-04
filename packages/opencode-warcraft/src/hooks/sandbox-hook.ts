import * as path from 'path';
import type { BeadsMode, SandboxConfig } from 'warcraft-core';
import { DockerSandboxService, getWarcraftPath, structuredToCommandString } from 'warcraft-core';
import { isPathInside } from '../guards.js';

// ============================================================================
// Sandbox Hook — Pure function for Docker command wrapping
// Extracted from index.ts for testability.
// ============================================================================

/**
 * Hook input from the `tool.execute.before` event.
 */
export interface SandboxHookInput {
  tool: string;
  [key: string]: unknown;
}

/**
 * Hook output from the `tool.execute.before` event.
 * The `args` object is mutated in-place when wrapping is applied.
 */
export interface SandboxHookOutput {
  args: { command?: string; workdir?: string; [key: string]: unknown } | undefined;
}

/**
 * Applies Docker sandbox wrapping to bash commands targeting warcraft worktrees.
 *
 * This is a pure function (no service dependencies) that implements the
 * `tool.execute.before` hook logic for sandbox mode.
 *
 * When sandbox is enabled and the command targets a worktree path,
 * the command is wrapped with `docker run` and the workdir is cleared
 * (since docker runs on the host).
 *
 * @param input - Hook input (must have `tool` field)
 * @param output - Hook output with mutable `args` (command, workdir)
 * @param sandboxConfig - Sandbox configuration from ConfigService
 * @param directory - Project root directory
 * @param beadsMode - Current beads mode ('on' | 'off')
 */
export function applySandboxHook(
  input: SandboxHookInput,
  output: SandboxHookOutput,
  sandboxConfig: SandboxConfig,
  directory: string,
  beadsMode: BeadsMode,
): void {
  if (input.tool !== 'bash') return;

  if (sandboxConfig.mode === 'none') return;

  const command = output.args?.command?.trim();
  if (!command) return;

  const workdir = output.args?.workdir;
  if (!workdir) return;

  const warcraftWorktreeBase = path.join(getWarcraftPath(directory, beadsMode), '.worktrees');
  if (!isPathInside(workdir, warcraftWorktreeBase)) return;

  const wrapped = DockerSandboxService.wrapCommand(workdir, command, sandboxConfig);
  output.args!.command =
    typeof wrapped === 'string' ? wrapped : structuredToCommandString(wrapped.command, wrapped.args);
  output.args!.workdir = undefined;
}
