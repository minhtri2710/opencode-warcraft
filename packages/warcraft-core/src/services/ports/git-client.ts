/**
 * GitClient port interface for git operations.
 *
 * This abstracts the git implementation (simple-git) behind a clean contract,
 * enabling dependency injection and testability.
 */

import type { MergeResult, StatusResult as SimpleGitStatusResult } from 'simple-git';

// Re-export MergeResult for use in GitClient implementations
export type { MergeResult };

/**
 * Factory function to create a GitClient for a specific directory.
 * Used by WorktreeService to create git instances for worktree-specific operations.
 */
export type GitClientFactory = (cwd?: string) => GitClient;

// ============================================================================
// Result Types
// ============================================================================

/** Result from git status operation (simplified for port interface). */
export interface StatusResult {
  modified: string[];
  staged: string[];
  not_added: string[];
  deleted: string[];
  created: string[];
}

/** Result from git branch operation. */
export interface BranchResult {
  current: string;
  all: string[];
}

/** Result from git commit operation. */
export interface CommitResult {
  commit: string;
}

/** Result from git log operation. */
export interface LogResult {
  all: Array<{ hash: string }>;
}

// ============================================================================
// Git Client Interface
// ============================================================================

/**
 * GitClient defines the contract for git operations used by WorktreeService.
 *
 * Implementations:
 * - SimpleGitClient: Wraps simple-git library
 */
export interface GitClient {
  // -------------------------------------------------------------------------
  // Worktree Operations
  // -------------------------------------------------------------------------

  /**
   * Add a new worktree.
   * @param options - Worktree options
   */
  worktreeAdd(options: {
    path: string;
    branch: string;
    commit: string;
  }): Promise<void>;

  /**
   * Add a new worktree (with existing branch).
   * @param options - Worktree options
   */
  worktreeAddWithBranch(options: {
    path: string;
    branch: string;
  }): Promise<void>;

  /**
   * Remove a worktree.
   * @param path - Worktree path
   */
  worktreeRemove(path: string): Promise<void>;

  /**
   * Prune stale worktree entries.
   */
  worktreePrune(): Promise<void>;

  // -------------------------------------------------------------------------
  // Diff Operations
  // -------------------------------------------------------------------------

  /**
   * Get diff between refs.
   * @param refspec - Git refspec (e.g., 'HEAD~1..HEAD')
   * @param cwd - Working directory (optional, for worktree operations)
   * @returns Diff content
   */
  diff(refspec: string, cwd?: string): Promise<string>;

  /**
   * Get diff statistics between refs.
   * @param refspec - Git refspec (e.g., 'HEAD~1..HEAD')
   * @param cwd - Working directory (optional, for worktree operations)
   * @returns Diff statistics
   */
  diffStat(refspec: string, cwd?: string): Promise<string>;

  /**
   * Get staged diff.
   * @param cwd - Working directory (optional, for worktree operations)
   * @returns Staged diff content
   */
  diffCached(cwd?: string): Promise<string>;

  /**
   * Get staged diff statistics.
   * @param cwd - Working directory (optional, for worktree operations)
   * @returns Staged diff statistics
   */
  diffCachedStat(cwd?: string): Promise<string>;

  // -------------------------------------------------------------------------
  // Status Operations
  // -------------------------------------------------------------------------

  /**
   * Get repository status.
   * @param cwd - Working directory (optional, uses base if not provided)
   */
  status(cwd?: string): Promise<StatusResult>;

  // -------------------------------------------------------------------------
  // Patch Operations
  // -------------------------------------------------------------------------

  /**
   * Apply a patch file.
   * @param patchPath - Path to patch file
   * @param options - Apply options
   */
  applyPatch(patchPath: string, options?: { reverse?: boolean; check?: boolean }): Promise<void>;

  // -------------------------------------------------------------------------
  // Commit Operations
  // -------------------------------------------------------------------------

  /**
   * Stage files for commit.
   * @param paths - File paths to stage
   * @param exclude - Paths to exclude
   * @param cwd - Working directory (optional, for worktree operations)
   */
  add(paths: string[], exclude?: string[], cwd?: string): Promise<void>;

  /**
   * Commit staged changes.
   * @param message - Commit message
   * @param options - Commit options
   * @param cwd - Working directory (optional, for worktree operations)
   */
  commit(message: string, options?: { allowEmptyMessage?: boolean }, cwd?: string): Promise<CommitResult>;

  /**
   * Resolve a git reference.
   * @param ref - Git reference (e.g., 'HEAD', 'HEAD~1')
   * @param cwd - Working directory (optional, for worktree operations)
   * @returns Resolved commit hash
   */
  revparse(ref: string | string[], cwd?: string): Promise<string>;

  // -------------------------------------------------------------------------
  // Branch Operations
  // -------------------------------------------------------------------------

  /**
   * Get branch information.
   * @returns Branch result with current branch and all branches
   */
  branch(): Promise<BranchResult>;

  /**
   * Delete a local branch.
   * @param branchName - Branch name to delete
   * @param force - Force delete
   */
  deleteBranch(branchName: string, force?: boolean): Promise<void>;

  // -------------------------------------------------------------------------
  // Merge Operations
  // -------------------------------------------------------------------------

  /**
   * Merge a branch.
   * @param branch - Branch to merge
   * @param options - Merge options
   */
  merge(branch: string, options?: { noFastForward?: boolean; message?: string }): Promise<MergeResult>;

  /**
   * Squash merge a branch.
   * @param branch - Branch to merge
   */
  mergeSquash(branch: string): Promise<void>;

  /**
   * Abort current merge.
   */
  mergeAbort(): Promise<void>;

  /**
   * Abort current rebase.
   */
  rebaseAbort(): Promise<void>;

  /**
   * Abort current cherry-pick.
   */
  cherryPickAbort(): Promise<void>;

  // -------------------------------------------------------------------------
  // Log Operations
  // -------------------------------------------------------------------------

  /**
   * Get commit log.
   * @param refspec - Git refspec (e.g., 'HEAD~1..HEAD')
   * @returns Log result
   */
  log(refspec: string): Promise<LogResult>;

  // -------------------------------------------------------------------------
  // Cherry-pick Operations
  // -------------------------------------------------------------------------

  /**
   * Cherry-pick a commit.
   * @param commitHash - Commit hash to cherry-pick
   */
  cherryPick(commitHash: string): Promise<void>;
}
