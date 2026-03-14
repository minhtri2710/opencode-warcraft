import * as fs from 'fs/promises';
import * as path from 'path';
import simpleGit, { type MergeResult as SimpleGitMergeResult } from 'simple-git';
import type { BeadsMode } from '../types.js';
import { acquireLock } from '../utils/json-lock.js';
import { getTaskStatusPath, getWarcraftPath, sanitizeName } from '../utils/paths.js';
import type { GitClient, GitClientFactory } from './ports/git-client.js';
import { SimpleGitClient } from './ports/simple-git-client.js';
export interface WorktreeInfo {
  mode: 'worktree' | 'direct';
  path: string;
  branch?: string;
  commit?: string;
  feature: string;
  step: string;
}

export interface StaleWorktreeInfo extends WorktreeInfo {
  isStale: boolean;
  lastCommitAge: number | null;
}

export interface DiffResult {
  hasDiff: boolean;
  diffContent: string;
  filesChanged: string[];
  insertions: number;
  deletions: number;
  error?: string;
}

export interface ApplyResult {
  success: boolean;
  error?: string;
  filesAffected: string[];
}

export interface CommitResult {
  committed: boolean;
  sha: string;
  message?: string;
}

export type MergeStrategy = 'merge' | 'squash' | 'rebase';
export type MergeSuccessOutcome = 'merged' | 'already-up-to-date' | 'no-commits-to-apply';
export type MergeFailureOutcome = 'conflicted' | 'failed';
export type MergeOutcome = MergeSuccessOutcome | MergeFailureOutcome;

export type MergeResult =
  | {
      success: true;
      outcome: MergeSuccessOutcome;
      strategy: MergeStrategy;
      sha: string;
      filesChanged: string[];
      conflicts: [];
    }
  | {
      success: false;
      outcome: MergeFailureOutcome;
      strategy: MergeStrategy;
      filesChanged: string[];
      conflicts: string[];
      error: string;
      sha?: string;
    };

export interface WorktreeConfig {
  baseDir: string;
  warcraftDir: string;
  beadsMode?: BeadsMode;
  gitFactory: GitClientFactory;
}

export interface PruneOptions {
  dryRun: boolean;
  confirm?: boolean;
  feature?: string;
}

export interface PruneResult {
  wouldRemove: StaleWorktreeInfo[];
  removed: string[];
  requiresConfirm?: boolean;
}

export class WorktreeService {
  private config: WorktreeConfig;

  constructor(config: WorktreeConfig) {
    this.config = { ...config, beadsMode: config.beadsMode ?? 'off' };
  }

  private getGit(cwd?: string): GitClient {
    return this.config.gitFactory(cwd);
  }

  private createDirectWorkspace(feature: string, step: string): WorktreeInfo {
    return {
      mode: 'direct',
      path: this.config.baseDir,
      feature,
      step,
    };
  }

  private shouldUseDirectWorkspace(error: unknown): boolean {
    const reason = error instanceof Error ? error.message : String(error);
    const normalized = reason.toLowerCase();
    return (
      normalized.includes('not a git repository') ||
      normalized.includes('not a git repo') ||
      normalized.includes('unknown subcommand') ||
      normalized.includes('worktree support is unavailable') ||
      normalized.includes('worktree is not supported') ||
      normalized.includes('worktree not supported')
    );
  }

  private getWorktreesDir(): string {
    return path.join(this.config.warcraftDir, '.worktrees');
  }

  private getWorktreePath(feature: string, step: string): string {
    return path.join(this.getWorktreesDir(), sanitizeName(feature), sanitizeName(step));
  }

  private getStepStatusPath(feature: string, step: string): string | null {
    if (this.config.beadsMode === 'on') {
      return null;
    }
    return getTaskStatusPath(this.config.baseDir, sanitizeName(feature), sanitizeName(step), this.config.beadsMode);
  }

  private getBranchName(feature: string, step: string): string {
    return `warcraft/${sanitizeName(feature)}/${sanitizeName(step)}`;
  }

  async create(feature: string, step: string, baseBranch?: string): Promise<WorktreeInfo> {
    const worktreePath = this.getWorktreePath(feature, step);
    const branchName = this.getBranchName(feature, step);
    const git = this.getGit();

    await fs.mkdir(path.dirname(worktreePath), { recursive: true });

    const lockPath = path.join(this.getWorktreesDir(), `${feature}-${step}.create`);
    const release = await acquireLock(lockPath, { timeout: 10000 });
    try {
      const existing = await this.get(feature, step);
      if (existing) {
        return existing;
      }

      let base: string;
      try {
        base = baseBranch || (await git.revparse(['HEAD']));
      } catch (error) {
        if (this.shouldUseDirectWorkspace(error)) {
          return this.createDirectWorkspace(feature, step);
        }
        throw error;
      }

      try {
        await git.worktreeAdd({ path: worktreePath, branch: branchName, commit: base });
      } catch (addError) {
        if (this.shouldUseDirectWorkspace(addError)) {
          return this.createDirectWorkspace(feature, step);
        }

        const reason = addError instanceof Error ? addError.message : String(addError);
        console.warn(`[warcraft] Primary worktree add failed, retrying with branch-only: ${reason}`);
        try {
          await git.worktreeAddWithBranch({ path: worktreePath, branch: branchName });
        } catch (retryError) {
          if (this.shouldUseDirectWorkspace(retryError)) {
            return this.createDirectWorkspace(feature, step);
          }
          throw new Error(`Failed to create worktree: ${retryError}`);
        }
      }

      const worktreeGit = this.getGit(worktreePath);
      const commit = await worktreeGit.revparse(['HEAD']);

      return {
        mode: 'worktree',
        path: worktreePath,
        branch: branchName,
        commit,
        feature,
        step,
      };
    } finally {
      release();
    }
  }

  async get(feature: string, step: string): Promise<WorktreeInfo | null> {
    const worktreePath = this.getWorktreePath(feature, step);
    const branchName = this.getBranchName(feature, step);

    try {
      await fs.access(worktreePath);
      const worktreeGit = this.getGit(worktreePath);
      const commit = await worktreeGit.revparse(['HEAD']);
      return {
        mode: 'worktree',
        path: worktreePath,
        branch: branchName,
        commit,
        feature,
        step,
      };
    } catch {
      return null;
    }
  }

  async getDiff(feature: string, step: string, baseCommit?: string): Promise<DiffResult> {
    const worktreePath = this.getWorktreePath(feature, step);
    const statusPath = this.getStepStatusPath(feature, step);

    let base = baseCommit;
    if (!base && this.config.beadsMode === 'off' && statusPath) {
      try {
        const status = JSON.parse(await fs.readFile(statusPath, 'utf-8')) as { baseCommit?: string };
        base = status.baseCommit;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[warcraft] Failed to read base commit from '${statusPath}' (falling back to HEAD): ${reason}`);
      }
    }

    const worktreeGit = this.getGit(worktreePath);
    if (!base) {
      if (this.config.beadsMode === 'on') {
        return {
          hasDiff: false,
          diffContent: '',
          filesChanged: [],
          insertions: 0,
          deletions: 0,
          error: `Missing base commit for '${feature}/${step}' in beads mode; pass baseCommit explicitly`,
        };
      }
      base = 'HEAD';
    }

    try {
      const status = await worktreeGit.status(worktreePath);
      const hasWorktreeChanges =
        status.staged.length > 0 ||
        status.modified.length > 0 ||
        status.not_added.length > 0 ||
        status.deleted.length > 0 ||
        status.created.length > 0;

      let diffContent = '';
      let stat = '';

      if (hasWorktreeChanges) {
        // Compare the current worktree/index state directly to the base so uncommitted
        // edits are not silently dropped from exported or conflict-checked patches.
        diffContent = await worktreeGit.diff(base, worktreePath).catch(() => '');
        stat = diffContent ? await worktreeGit.diffStat(base, worktreePath) : '';
      } else {
        diffContent = await worktreeGit.diff(`${base}..HEAD`, worktreePath).catch(() => '');
        stat = diffContent ? await worktreeGit.diffStat(`${base}..HEAD`, worktreePath) : '';
      }

      const statLines = stat.split('\n').filter((l) => l.trim());

      const filesChanged = this.parseFilesFromDiffStat(stat);

      const summaryLine = statLines[statLines.length - 1] || '';
      const insertMatch = summaryLine.match(/(\d+) insertion/);
      const deleteMatch = summaryLine.match(/(\d+) deletion/);

      return {
        hasDiff: diffContent.length > 0,
        diffContent,
        filesChanged,
        insertions: insertMatch ? parseInt(insertMatch[1], 10) : 0,
        deletions: deleteMatch ? parseInt(deleteMatch[1], 10) : 0,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        hasDiff: false,
        diffContent: '',
        filesChanged: [],
        insertions: 0,
        deletions: 0,
        error: `getDiff failed: ${message}`,
      };
    }
  }

  async exportPatch(feature: string, step: string, baseBranch?: string): Promise<string> {
    const worktreePath = this.getWorktreePath(feature, step);
    const patchPath = path.join(worktreePath, '..', `${step}.patch`);
    const diff = await this.getDiff(feature, step, baseBranch);

    if (diff.error) {
      throw new Error(diff.error);
    }

    await fs.writeFile(patchPath, diff.diffContent);

    return patchPath;
  }

  async applyDiff(feature: string, step: string, baseBranch?: string): Promise<ApplyResult> {
    const { hasDiff, diffContent, filesChanged } = await this.getDiff(feature, step, baseBranch);

    if (!hasDiff) {
      return { success: true, filesAffected: [] };
    }

    const patchPath = path.join(this.getWorktreesDir(), feature, `${step}.patch`);

    try {
      await fs.writeFile(patchPath, diffContent);
      const git = this.getGit();
      await git.applyPatch(patchPath);
      await fs.unlink(patchPath).catch(() => {});
      return { success: true, filesAffected: filesChanged };
    } catch (error: unknown) {
      await fs.unlink(patchPath).catch(() => {});
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || 'Failed to apply patch',
        filesAffected: [],
      };
    }
  }

  async revertDiff(feature: string, step: string, baseBranch?: string): Promise<ApplyResult> {
    const { hasDiff, diffContent, filesChanged } = await this.getDiff(feature, step, baseBranch);

    if (!hasDiff) {
      return { success: true, filesAffected: [] };
    }

    const patchPath = path.join(this.getWorktreesDir(), feature, `${step}.patch`);

    try {
      await fs.writeFile(patchPath, diffContent);
      const git = this.getGit();
      await git.applyPatch(patchPath, ['-R']);
      await fs.unlink(patchPath).catch(() => {});
      return { success: true, filesAffected: filesChanged };
    } catch (error: unknown) {
      await fs.unlink(patchPath).catch(() => {});
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || 'Failed to revert patch',
        filesAffected: [],
      };
    }
  }

  private parseFilesFromDiffStat(diffStat: string): string[] {
    return diffStat
      .split('\n')
      .filter((line) => line.trim() && line.includes('|'))
      .map((line) => line.split('|')[0].trim())
      .filter(Boolean);
  }

  private async listChangedFiles(git: GitClient, refspec: string, cwd?: string): Promise<string[]> {
    const diffStat = await git.diffStat(refspec, cwd);
    return this.parseFilesFromDiffStat(diffStat);
  }

  private parseFilesFromDiff(diffContent: string): string[] {
    const files: string[] = [];
    const regex = /^diff --git a\/(.+?) b\//gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(diffContent)) !== null) {
      files.push(match[1]);
    }
    return [...new Set(files)];
  }

  async revertFromSavedDiff(diffPath: string): Promise<ApplyResult> {
    const diffContent = await fs.readFile(diffPath, 'utf-8');
    if (!diffContent.trim()) {
      return { success: true, filesAffected: [] };
    }

    const filesChanged = this.parseFilesFromDiff(diffContent);

    try {
      const git = this.getGit();
      await git.applyPatch(diffPath, ['-R']);
      return { success: true, filesAffected: filesChanged };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || 'Failed to revert patch',
        filesAffected: [],
      };
    }
  }

  async remove(feature: string, step: string, deleteBranch = false): Promise<void> {
    const worktreePath = this.getWorktreePath(feature, step);
    const branchName = this.getBranchName(feature, step);
    const git = this.getGit();

    const lockPath = path.join(this.getWorktreesDir(), `${feature}-${step}.create`);
    const release = await acquireLock(lockPath, { timeout: 10000 });
    try {
      try {
        await git.worktreeRemove(worktreePath);
      } catch {
        await fs.rm(worktreePath, { recursive: true, force: true });
      }

      try {
        await git.worktreePrune();
      } catch {
        /* intentional */
      }

      if (deleteBranch) {
        try {
          await git.deleteBranch(branchName, true);
        } catch {
          /* intentional */
        }
      }
    } finally {
      release();
    }
  }

  async list(feature?: string): Promise<WorktreeInfo[]> {
    const worktreesDir = this.getWorktreesDir();
    const results: WorktreeInfo[] = [];

    try {
      const features = feature ? [feature] : await fs.readdir(worktreesDir);

      for (const feat of features) {
        const featurePath = path.join(worktreesDir, feat);
        const stat = await fs.stat(featurePath).catch((): null => null);

        if (!stat?.isDirectory()) continue;

        const steps = await fs.readdir(featurePath).catch((): string[] => []);

        for (const step of steps) {
          const info = await this.get(feat, step);
          if (info) {
            results.push(info);
          }
        }
      }
    } catch {
      /* intentional */
    }

    return results;
  }

  async listAll(feature?: string): Promise<StaleWorktreeInfo[]> {
    const worktreesDir = this.getWorktreesDir();
    const results: StaleWorktreeInfo[] = [];

    try {
      const features = feature ? [feature] : await fs.readdir(worktreesDir);

      for (const feat of features) {
        const featurePath = path.join(worktreesDir, feat);
        const stat = await fs.stat(featurePath).catch((): null => null);

        if (!stat?.isDirectory()) continue;

        const steps = await fs.readdir(featurePath).catch((): string[] => []);

        for (const step of steps) {
          const stepPath = path.join(featurePath, step);
          const stepStat = await fs.stat(stepPath).catch((): null => null);
          if (!stepStat?.isDirectory()) continue;

          const branchName = this.getBranchName(feat, step);
          let isStale = false;
          let commit = '';
          let lastCommitAge: number | null = null;

          try {
            const worktreeGit = this.getGit(stepPath);
            commit = await worktreeGit.revparse(['HEAD']);
            // Compute age from directory mtime as a proxy
            lastCommitAge = Date.now() - stepStat.mtimeMs;
          } catch {
            isStale = true;
          }

          results.push({
            mode: 'worktree',
            path: stepPath,
            branch: branchName,
            commit,
            feature: feat,
            step,
            isStale,
            lastCommitAge,
          });
        }
      }
    } catch {
      /* intentional */
    }

    return results;
  }

  async prune(options: PruneOptions): Promise<PruneResult> {
    const staleWorktrees = (await this.listAll(options.feature)).filter((wt) => wt.isStale);

    if (options.dryRun) {
      return {
        wouldRemove: staleWorktrees,
        removed: [],
      };
    }

    if (!options.confirm) {
      return {
        wouldRemove: staleWorktrees,
        removed: [],
        requiresConfirm: true,
      };
    }

    const removed: string[] = [];
    for (const wt of staleWorktrees) {
      await this.remove(wt.feature, wt.step, false);
      removed.push(wt.path);
    }

    return {
      wouldRemove: [],
      removed,
    };
  }

  async cleanup(feature?: string): Promise<{ removed: string[]; pruned: boolean }> {
    const removed: string[] = [];
    const git = this.getGit();

    try {
      await git.worktreePrune();
    } catch {
      /* intentional */
    }

    const worktreesDir = this.getWorktreesDir();
    const features = feature ? [feature] : await fs.readdir(worktreesDir).catch((): string[] => []);

    for (const feat of features) {
      const featurePath = path.join(worktreesDir, feat);
      const stat = await fs.stat(featurePath).catch((): null => null);

      if (!stat?.isDirectory()) continue;

      const steps = await fs.readdir(featurePath).catch((): string[] => []);

      for (const step of steps) {
        const worktreePath = path.join(featurePath, step);
        const stepStat = await fs.stat(worktreePath).catch((): null => null);

        if (!stepStat?.isDirectory()) continue;

        try {
          const worktreeGit = this.getGit(worktreePath);
          await worktreeGit.revparse(['HEAD']);
        } catch {
          await this.remove(feat, step, false);
          removed.push(worktreePath);
        }
      }
    }

    return { removed, pruned: true };
  }

  async checkConflicts(feature: string, step: string, baseBranch?: string): Promise<string[]> {
    const { hasDiff, diffContent } = await this.getDiff(feature, step, baseBranch);

    if (!hasDiff) {
      return [];
    }

    const patchPath = path.join(this.getWorktreesDir(), feature, `${step}-check.patch`);

    try {
      await fs.writeFile(patchPath, diffContent);
      const git = this.getGit();
      await git.applyPatch(patchPath, ['--check']);
      await fs.unlink(patchPath).catch(() => {});
      return [];
    } catch (error: unknown) {
      await fs.unlink(patchPath).catch(() => {});
      const err = error as { message?: string };
      const stderr = err.message || '';

      const conflicts = stderr
        .split('\n')
        .filter((line) => line.includes('error: patch failed:'))
        .map((line) => {
          const match = line.match(/error: patch failed: (.+):/);
          return match ? match[1] : null;
        })
        .filter((f): f is string => f !== null);

      return conflicts;
    }
  }

  async checkConflictsFromSavedDiff(diffPath: string, reverse = false): Promise<string[]> {
    try {
      await fs.access(diffPath);
    } catch {
      return [];
    }

    try {
      const git = this.getGit();
      const options = reverse ? ['--check', '-R'] : ['--check'];
      await git.applyPatch(diffPath, options);
      return [];
    } catch (error: unknown) {
      const err = error as { message?: string };
      const stderr = err.message || '';

      const conflicts = stderr
        .split('\n')
        .filter((line) => line.includes('error: patch failed:'))
        .map((line) => {
          const match = line.match(/error: patch failed: (.+):/);
          return match ? match[1] : null;
        })
        .filter((f): f is string => f !== null);

      return conflicts;
    }
  }

  async commitChanges(feature: string, step: string, message?: string): Promise<CommitResult> {
    const worktreePath = this.getWorktreePath(feature, step);

    try {
      await fs.access(worktreePath);
    } catch {
      return { committed: false, sha: '', message: 'Worktree not found' };
    }

    const worktreeGit = this.getGit(worktreePath);

    try {
      await worktreeGit.add(['.', '--', ':!*.patch'], undefined, worktreePath);

      const status = await worktreeGit.status(worktreePath);
      const hasChanges = status.staged.length > 0 || status.modified.length > 0 || status.not_added.length > 0;

      if (!hasChanges) {
        const currentSha = await worktreeGit.revparse(['HEAD']);
        return { committed: false, sha: currentSha, message: 'No changes to commit' };
      }

      const commitMessage = message || `warcraft(${step}): task changes`;
      const result = await worktreeGit.commit(commitMessage, { allowEmptyMessage: true }, worktreePath);

      return {
        committed: true,
        sha: result.commit,
        message: commitMessage,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const currentSha = await worktreeGit.revparse(['HEAD']).catch(() => '');
      return {
        committed: false,
        sha: currentSha,
        message: err.message || 'Commit failed',
      };
    }
  }

  async merge(feature: string, step: string, strategy: MergeStrategy = 'merge'): Promise<MergeResult> {
    const branchName = this.getBranchName(feature, step);
    const git = this.getGit();
    let beforeHead: string | undefined;

    try {
      const branches = await git.branch();
      if (!branches.all.includes(branchName)) {
        return {
          success: false,
          outcome: 'failed',
          strategy,
          filesChanged: [],
          conflicts: [],
          error: `Branch ${branchName} not found`,
        };
      }

      const currentBranch = branches.current;
      beforeHead = await git.revparse(['HEAD']);

      const pendingCommits = await git.log(`${currentBranch}..${branchName}`);
      if (pendingCommits.all.length === 0) {
        return {
          success: true,
          outcome: strategy === 'merge' ? 'already-up-to-date' : 'no-commits-to-apply',
          strategy,
          sha: beforeHead,
          filesChanged: [],
          conflicts: [],
        };
      }

      if (strategy === 'squash') {
        await git.mergeSquash(branchName);
        const result = await git.commit(`warcraft: merge ${step} (squashed)`);
        const filesChanged = await this.listChangedFiles(git, `${beforeHead}..${result.commit}`);

        return {
          success: true,
          outcome: 'merged',
          strategy,
          sha: result.commit,
          filesChanged,
          conflicts: [],
        };
      }

      if (strategy === 'rebase') {
        const commitsToApply = [...pendingCommits.all].reverse();
        for (const commit of commitsToApply) {
          await git.cherryPick(commit.hash);
        }

        const head = await git.revparse(['HEAD']);
        const filesChanged = head === beforeHead ? [] : await this.listChangedFiles(git, `${beforeHead}..${head}`);

        return {
          success: true,
          outcome: 'merged',
          strategy,
          sha: head,
          filesChanged,
          conflicts: [],
        };
      }

      const result = await git.merge(branchName, { noFastForward: true, message: `warcraft: merge ${step}` });
      const head = await git.revparse(['HEAD']);
      const filesChanged = head === beforeHead ? [] : await this.listChangedFiles(git, `${beforeHead}..${head}`);
      const conflicts =
        result.conflicts
          ?.map((conflict) => conflict.file ?? conflict.reason)
          .filter((f): f is string => f !== undefined && f !== null) ?? [];

      if (result.failed) {
        return {
          success: false,
          outcome: conflicts.length > 0 ? 'conflicted' : 'failed',
          strategy,
          sha: head,
          filesChanged,
          conflicts,
          error: conflicts.length > 0 ? 'Merge conflicts detected' : result.result || 'Merge failed',
        };
      }

      return {
        success: true,
        outcome: 'merged',
        strategy,
        sha: head,
        filesChanged,
        conflicts: [],
      };
    } catch (error: unknown) {
      const err = error as { message?: string; git?: SimpleGitMergeResult };
      const gitConflicts =
        err.git?.conflicts
          ?.map((conflict) => conflict.file ?? conflict.reason)
          .filter((f): f is string => f !== undefined && f !== null) ?? [];
      const conflicts = gitConflicts.length > 0 ? gitConflicts : this.parseConflictsFromError(err.message || '');
      const filesChanged = err.git?.files ?? [];

      if (err.message?.includes('CONFLICT') || err.message?.includes('conflict') || conflicts.length > 0) {
        await git.mergeAbort().catch(() => {});
        await git.rebaseAbort().catch(() => {});
        await git.cherryPickAbort().catch(() => {});

        return {
          success: false,
          outcome: 'conflicted',
          strategy,
          sha: beforeHead,
          filesChanged,
          conflicts,
          error: 'Merge conflicts detected',
        };
      }

      return {
        success: false,
        outcome: 'failed',
        strategy,
        sha: beforeHead,
        filesChanged,
        conflicts: [],
        error: err.message || 'Merge failed',
      };
    }
  }

  async hasUncommittedChanges(feature: string, step: string): Promise<boolean> {
    const worktreePath = this.getWorktreePath(feature, step);

    try {
      const worktreeGit = this.getGit(worktreePath);
      const status = await worktreeGit.status(worktreePath);
      return (
        status.modified.length > 0 ||
        status.not_added.length > 0 ||
        status.staged.length > 0 ||
        status.deleted.length > 0 ||
        status.created.length > 0
      );
    } catch {
      return false;
    }
  }

  private parseConflictsFromError(errorMessage: string): string[] {
    const conflicts: string[] = [];
    const lines = errorMessage.split('\n');
    for (const line of lines) {
      if (line.includes('CONFLICT') && line.includes('Merge conflict in')) {
        const match = line.match(/Merge conflict in (.+)/);
        if (match) conflicts.push(match[1]);
      }
    }
    return conflicts;
  }
}

export function createWorktreeService(projectDir: string, beadsMode: BeadsMode = 'off'): WorktreeService {
  const gitFactory: GitClientFactory = (cwd?: string) => new SimpleGitClient(simpleGit(cwd ?? projectDir));
  return new WorktreeService({
    baseDir: projectDir,
    warcraftDir: getWarcraftPath(projectDir, beadsMode),
    beadsMode,
    gitFactory,
  });
}
