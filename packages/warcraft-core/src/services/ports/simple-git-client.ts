/**
 * SimpleGitClient - Adapter for simple-git library implementing GitClient port.
 *
 * This class wraps a SimpleGit instance and adapts its API to the GitClient interface,
 * enabling dependency injection and testability.
 *
 * For operations that need a specific working directory (like operations on worktrees),
 * the client creates a new SimpleGit instance for that directory.
 */

import simpleGit, { type MergeResult, type SimpleGit, type StatusResult as SimpleGitStatusResult } from 'simple-git';
import type { BranchResult, CommitResult, GitClient, GitClientFactory, LogResult, StatusResult } from './git-client.js';

export class SimpleGitClient implements GitClient {
  private readonly git: SimpleGit;

  constructor(git: SimpleGit) {
    this.git = git;
  }

  static createFactory(git: SimpleGit): GitClientFactory {
    return (cwd?: string) => new SimpleGitClient(cwd ? simpleGit(cwd) : git);
  }

  private withCwd(cwd: string): SimpleGit {
    return simpleGit(cwd);
  }

  // -------------------------------------------------------------------------
  // Worktree Operations
  // -------------------------------------------------------------------------

  async worktreeAdd(options: { path: string; branch: string; commit: string }): Promise<void> {
    await this.git.raw(['worktree', 'add', '-b', options.branch, options.path, options.commit]);
  }

  async worktreeAddWithBranch(options: { path: string; branch: string }): Promise<void> {
    await this.git.raw(['worktree', 'add', options.path, options.branch]);
  }

  async worktreeRemove(path: string): Promise<void> {
    await this.git.raw(['worktree', 'remove', path, '--force']);
  }

  async worktreePrune(): Promise<void> {
    await this.git.raw(['worktree', 'prune']);
  }

  // -------------------------------------------------------------------------
  // Diff Operations
  // -------------------------------------------------------------------------

  async diff(refspec: string, cwd?: string): Promise<string> {
    const gitInstance = cwd ? this.withCwd(cwd) : this.git;
    return gitInstance.diff([refspec]);
  }

  async diffStat(refspec: string, cwd?: string): Promise<string> {
    const gitInstance = cwd ? this.withCwd(cwd) : this.git;
    return gitInstance.diff([refspec, '--stat']);
  }

  async diffCached(cwd?: string): Promise<string> {
    const gitInstance = cwd ? this.withCwd(cwd) : this.git;
    return gitInstance.diff(['--cached']);
  }

  async diffCachedStat(cwd?: string): Promise<string> {
    const gitInstance = cwd ? this.withCwd(cwd) : this.git;
    return gitInstance.diff(['--cached', '--stat']);
  }

  // -------------------------------------------------------------------------
  // Status Operations
  // -------------------------------------------------------------------------

  async status(cwd?: string): Promise<StatusResult> {
    const gitInstance = cwd ? this.withCwd(cwd) : this.git;
    const result: SimpleGitStatusResult = await gitInstance.status();
    return {
      modified: result.modified,
      staged: result.staged,
      not_added: result.not_added,
      deleted: result.deleted,
      created: result.created,
    };
  }

  // -------------------------------------------------------------------------
  // Patch Operations
  // -------------------------------------------------------------------------

  async applyPatch(patchPath: string, options?: { reverse?: boolean; check?: boolean }): Promise<void> {
    const args: string[] = [];
    if (options?.reverse) {
      args.push('-R');
    }
    if (options?.check) {
      args.push('--check');
    }
    if (args.length > 0) {
      await this.git.applyPatch(patchPath, args);
    } else {
      await this.git.applyPatch(patchPath);
    }
  }

  // -------------------------------------------------------------------------
  // Commit Operations
  // -------------------------------------------------------------------------

  async add(paths: string[], exclude?: string[], cwd?: string): Promise<void> {
    const addPaths = exclude && exclude.length > 0 ? [...paths, '--', ...exclude.map((value) => `:!${value}`)] : paths;
    const gitInstance = cwd ? this.withCwd(cwd) : this.git;
    await gitInstance.add(addPaths);
  }

  async commit(message: string, options?: { allowEmptyMessage?: boolean }, cwd?: string): Promise<CommitResult> {
    const gitInstance = cwd ? this.withCwd(cwd) : this.git;
    const args: string[] = [];
    if (options?.allowEmptyMessage) {
      args.push('--allow-empty-message');
    }
    const result = await gitInstance.commit(message, args.length > 0 ? args : undefined);
    return { commit: result.commit };
  }

  async revparse(ref: string | string[], cwd?: string): Promise<string> {
    const gitInstance = cwd ? this.withCwd(cwd) : this.git;
    if (Array.isArray(ref)) {
      const result = await gitInstance.raw(['rev-parse', ...ref]);
      return result.trim();
    }
    const result = await gitInstance.revparse(ref);
    return result.trim();
  }

  // -------------------------------------------------------------------------
  // Branch Operations
  // -------------------------------------------------------------------------

  async branch(): Promise<BranchResult> {
    const result = await this.git.branch();
    return {
      current: result.current,
      all: result.all,
    };
  }

  async deleteBranch(branchName: string, force?: boolean): Promise<void> {
    await this.git.deleteLocalBranch(branchName, force);
  }

  // -------------------------------------------------------------------------
  // Merge Operations
  // -------------------------------------------------------------------------

  async merge(branch: string, options?: { noFastForward?: boolean; message?: string }): Promise<MergeResult> {
    const args: string[] = [branch];
    if (options?.noFastForward) {
      args.push('--no-ff');
    }
    if (options?.message) {
      args.push('-m', options.message);
    }
    return this.git.merge(args);
  }

  async mergeSquash(branch: string): Promise<void> {
    await this.git.raw(['merge', '--squash', branch]);
  }

  async mergeAbort(): Promise<void> {
    await this.git.raw(['merge', '--abort']);
  }

  async rebaseAbort(): Promise<void> {
    await this.git.raw(['rebase', '--abort']);
  }

  async cherryPickAbort(): Promise<void> {
    await this.git.raw(['cherry-pick', '--abort']);
  }

  // -------------------------------------------------------------------------
  // Log Operations
  // -------------------------------------------------------------------------

  async log(refspec: string, cwd?: string): Promise<LogResult> {
    const gitInstance = cwd ? this.withCwd(cwd) : this.git;
    const result = await gitInstance.log([refspec]);
    return { all: result.all.map((c) => ({ hash: c.hash })) };
  }

  // -------------------------------------------------------------------------
  // Cherry-pick Operations
  // -------------------------------------------------------------------------

  async cherryPick(commitHash: string): Promise<void> {
    await this.git.raw(['cherry-pick', commitHash]);
  }
}
