import * as fs from "fs/promises";
import * as path from "path";
import simpleGit, { SimpleGit } from "simple-git";
import { acquireLock, getWarcraftPath, sanitizeName } from '../utils/paths.js';
import type { BeadsModeProvider, TaskStatusType } from '../types.js';
import { ConfigService } from './configService.js';
import { BeadGateway } from './beads/BeadGateway.js';

interface WorktreeBeadClient {
  syncTaskStatus(beadId: string, status: TaskStatusType): void;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  commit: string;
  feature: string;
  step: string;
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

export interface MergeResult {
  success: boolean;
  merged: boolean;
  sha?: string;
  filesChanged?: string[];
  conflicts?: string[];
  error?: string;
}

export interface WorktreeConfig {
  baseDir: string;
  warcraftDir: string;
}

export class WorktreeService {
  private config: WorktreeConfig;
  private readonly beadsModeProvider: BeadsModeProvider;
  private readonly worktreeBeadClient: WorktreeBeadClient;

  constructor(
    config: WorktreeConfig,
    beadsModeProvider: BeadsModeProvider = new ConfigService(),
    worktreeBeadClient: WorktreeBeadClient = new BeadGateway(config.baseDir),
  ) {
    this.config = config;
    this.beadsModeProvider = beadsModeProvider;
    this.worktreeBeadClient = worktreeBeadClient;
  }

  private getGit(cwd?: string): SimpleGit {
    return simpleGit(cwd || this.config.baseDir);
  }

  private getWorktreesDir(): string {
    return path.join(this.config.warcraftDir, ".worktrees");
  }

  private getWorktreePath(feature: string, step: string): string {
    return path.join(this.getWorktreesDir(), sanitizeName(feature), sanitizeName(step));
  }

  private getStepStatusPath(feature: string, step: string): string {
    return path.join(this.config.warcraftDir, sanitizeName(feature), 'tasks', sanitizeName(step), 'status.json');
  }

  private getBranchName(feature: string, step: string): string {
    return `warcraft/${sanitizeName(feature)}/${sanitizeName(step)}`;
  }

  private async getDefaultBaseCommit(git: SimpleGit): Promise<string> {
    try {
      const countRaw = (await git.raw(["rev-list", "--count", "HEAD"])).trim();
      const count = Number.parseInt(countRaw, 10);
      if (!Number.isFinite(count) || count <= 1) {
        return "HEAD";
      }
      return "HEAD~1";
    } catch {
      return "HEAD";
    }
  }

  async create(feature: string, step: string, baseBranch?: string): Promise<WorktreeInfo> {
    const worktreePath = this.getWorktreePath(feature, step);
    const branchName = this.getBranchName(feature, step);
    const git = this.getGit();

    await fs.mkdir(path.dirname(worktreePath), { recursive: true });

    // Lock to prevent race between concurrent create() calls
    const lockPath = path.join(this.getWorktreesDir(), `${feature}-${step}.create`);
    const release = await acquireLock(lockPath, { timeout: 10000 });
    try {
      const base = baseBranch || (await git.revparse(["HEAD"])).trim();

      const existing = await this.get(feature, step);
      if (existing) {
        return existing;
      }

      try {
        await git.raw(["worktree", "add", "-b", branchName, worktreePath, base]);
      } catch {
        try {
          await git.raw(["worktree", "add", worktreePath, branchName]);
        } catch (retryError) {
          throw new Error(`Failed to create worktree: ${retryError}`);
        }
      }

      const worktreeGit = this.getGit(worktreePath);
      const commit = (await worktreeGit.revparse(["HEAD"])).trim();

      return {
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
      const commit = (await worktreeGit.revparse(["HEAD"])).trim();
      return {
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
    if (!base) {
      try {
        const status = JSON.parse(await fs.readFile(statusPath, "utf-8"));
        base = status.baseCommit;  // Read baseCommit directly from task status
      } catch {}
    }
    
    const worktreeGit = this.getGit(worktreePath);
    if (!base) {
      base = await this.getDefaultBaseCommit(worktreeGit);
    }

    try {
      const status = await worktreeGit.status();
      const hasStaged = status.staged.length > 0;
      
      let diffContent = "";
      let stat = "";
      
      if (hasStaged) {
        diffContent = await worktreeGit.diff(["--cached"]);
        stat = diffContent ? await worktreeGit.diff(["--cached", "--stat"]) : "";
      } else {
        diffContent = await worktreeGit.diff([`${base}..HEAD`]).catch(() => "");
        stat = diffContent ? await worktreeGit.diff([`${base}..HEAD`, "--stat"]) : "";
      }
      
      const statLines = stat.split("\n").filter((l) => l.trim());

      const filesChanged = statLines
        .slice(0, -1)
        .map((line) => line.split("|")[0].trim())
        .filter(Boolean);

      const summaryLine = statLines[statLines.length - 1] || "";
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
        diffContent: "",
        filesChanged: [],
        insertions: 0,
        deletions: 0,
        error: `getDiff failed: ${message}`,
      };
    }
  }

  async exportPatch(feature: string, step: string, baseBranch?: string): Promise<string> {
    const worktreePath = this.getWorktreePath(feature, step);
    const patchPath = path.join(worktreePath, "..", `${step}.patch`);
    const worktreeGit = this.getGit(worktreePath);
    const base = baseBranch || (await this.getDefaultBaseCommit(worktreeGit));

    const diff = await worktreeGit.diff([`${base}...HEAD`]);
    await fs.writeFile(patchPath, diff);

    return patchPath;
  }

  async applyDiff(feature: string, step: string, baseBranch?: string): Promise<ApplyResult> {
    const { hasDiff, diffContent, filesChanged } = await this.getDiff(feature, step, baseBranch);

    if (!hasDiff) {
      return { success: true, filesAffected: [] };
    }

    const patchPath = path.join(this.config.warcraftDir, ".worktrees", feature, `${step}.patch`);
    
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
        error: err.message || "Failed to apply patch",
        filesAffected: [],
      };
    }
  }

  async revertDiff(feature: string, step: string, baseBranch?: string): Promise<ApplyResult> {
    const { hasDiff, diffContent, filesChanged } = await this.getDiff(feature, step, baseBranch);

    if (!hasDiff) {
      return { success: true, filesAffected: [] };
    }

    const patchPath = path.join(this.config.warcraftDir, ".worktrees", feature, `${step}.patch`);

    try {
      await fs.writeFile(patchPath, diffContent);
      const git = this.getGit();
      await git.applyPatch(patchPath, ["-R"]);
      await fs.unlink(patchPath).catch(() => {});
      return { success: true, filesAffected: filesChanged };
    } catch (error: unknown) {
      await fs.unlink(patchPath).catch(() => {});
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || "Failed to revert patch",
        filesAffected: [],
      };
    }
  }

  private parseFilesFromDiff(diffContent: string): string[] {
    const files: string[] = [];
    const regex = /^diff --git a\/(.+?) b\//gm;
    let match;
    while ((match = regex.exec(diffContent)) !== null) {
      files.push(match[1]);
    }
    return [...new Set(files)];
  }

  async revertFromSavedDiff(diffPath: string): Promise<ApplyResult> {
    const diffContent = await fs.readFile(diffPath, "utf-8");
    if (!diffContent.trim()) {
      return { success: true, filesAffected: [] };
    }

    const filesChanged = this.parseFilesFromDiff(diffContent);

    try {
      const git = this.getGit();
      await git.applyPatch(diffContent, ["-R"]);
      return { success: true, filesAffected: filesChanged };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return {
        success: false,
        error: err.message || "Failed to revert patch",
        filesAffected: [],
      };
    }
  }

  async remove(feature: string, step: string, deleteBranch = false): Promise<void> {
    const worktreePath = this.getWorktreePath(feature, step);
    const branchName = this.getBranchName(feature, step);
    const git = this.getGit();

    try {
      await git.raw(["worktree", "remove", worktreePath, "--force"]);
    } catch {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }

    try {
      await git.raw(["worktree", "prune"]);
    } catch {
      /* intentional */
    }

    if (deleteBranch) {
      try {
        await git.deleteLocalBranch(branchName, true);
      } catch {
        /* intentional */
      }
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

  async cleanup(feature?: string): Promise<{ removed: string[]; pruned: boolean }> {
    const removed: string[] = [];
    const git = this.getGit();

    try {
      await git.raw(["worktree", "prune"]);
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
          await worktreeGit.revparse(["HEAD"]);
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

    const patchPath = path.join(this.config.warcraftDir, ".worktrees", feature, `${step}-check.patch`);

    try {
      await fs.writeFile(patchPath, diffContent);
      const git = this.getGit();
      await git.applyPatch(patchPath, ["--check"]);
      await fs.unlink(patchPath).catch(() => {});
      return [];
    } catch (error: unknown) {
      await fs.unlink(patchPath).catch(() => {});
      const err = error as { message?: string };
      const stderr = err.message || "";

      const conflicts = stderr
        .split("\n")
        .filter((line) => line.includes("error: patch failed:"))
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
      const options = reverse ? ["--check", "-R"] : ["--check"];
      await git.applyPatch(diffPath, options);
      return [];
    } catch (error: unknown) {
      const err = error as { message?: string };
      const stderr = err.message || "";

      const conflicts = stderr
        .split("\n")
        .filter((line) => line.includes("error: patch failed:"))
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
      return { committed: false, sha: "", message: "Worktree not found" };
    }

    const worktreeGit = this.getGit(worktreePath);

    try {
      await worktreeGit.add("-A");
      
      const status = await worktreeGit.status();
      const hasChanges = status.staged.length > 0 || status.modified.length > 0 || status.not_added.length > 0;
      
      if (!hasChanges) {
        const currentSha = (await worktreeGit.revparse(["HEAD"])).trim();
        return { committed: false, sha: currentSha, message: "No changes to commit" };
      }

      const commitMessage = message || `warcraft(${step}): task changes`;
      const result = await worktreeGit.commit(commitMessage, ["--allow-empty-message"]);

      return { 
        committed: true, 
        sha: result.commit,
        message: commitMessage,
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      const currentSha = (await worktreeGit.revparse(["HEAD"]).catch(() => "")).trim();
      return { 
        committed: false, 
        sha: currentSha,
        message: err.message || "Commit failed",
      };
    }
  }

  async merge(feature: string, step: string, strategy: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<MergeResult> {
    const branchName = this.getBranchName(feature, step);
    const git = this.getGit();

    try {
      const branches = await git.branch();
      if (!branches.all.includes(branchName)) {
        return { success: false, merged: false, error: `Branch ${branchName} not found` };
      }

      const currentBranch = branches.current;

      const diffStat = await git.diff([`${currentBranch}...${branchName}`, "--stat"]);
      const filesChanged = diffStat
        .split("\n")
        .filter(l => l.trim() && l.includes("|"))
        .map(l => l.split("|")[0].trim());

      if (strategy === 'squash') {
        await git.raw(["merge", "--squash", branchName]);
        const result = await git.commit(`warcraft: merge ${step} (squashed)`);
        return {
          success: true,
          merged: true,
          sha: result.commit,
          filesChanged,
        };
      } else if (strategy === 'rebase') {
        const commits = await git.log([`${currentBranch}..${branchName}`]);
        const commitsToApply = [...commits.all].reverse();
        for (const commit of commitsToApply) {
          await git.raw(["cherry-pick", commit.hash]);
        }
        const head = (await git.revparse(["HEAD"])).trim();
        return {
          success: true,
          merged: true,
          sha: head,
          filesChanged,
        };
      } else {
        const result = await git.merge([branchName, "--no-ff", "-m", `warcraft: merge ${step}`]);
        const head = (await git.revparse(["HEAD"])).trim();
        return {
          success: true,
          merged: !result.failed,
          sha: head,
          filesChanged,
          conflicts: result.conflicts?.map(c => c.file || String(c)) || [],
        };
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      
      if (err.message?.includes("CONFLICT") || err.message?.includes("conflict")) {
        await git.raw(["merge", "--abort"]).catch(() => {});
        await git.raw(["rebase", "--abort"]).catch(() => {});
        await git.raw(["cherry-pick", "--abort"]).catch(() => {});

        return {
          success: false,
          merged: false,
          error: "Merge conflicts detected",
          conflicts: this.parseConflictsFromError(err.message || ""),
        };
      }

      return {
        success: false,
        merged: false,
        error: err.message || "Merge failed",
      };
    }
  }

  async hasUncommittedChanges(feature: string, step: string): Promise<boolean> {
    const worktreePath = this.getWorktreePath(feature, step);
    
    try {
      const worktreeGit = this.getGit(worktreePath);
      const status = await worktreeGit.status();
      return status.modified.length > 0 || 
             status.not_added.length > 0 || 
             status.staged.length > 0 ||
             status.deleted.length > 0 ||
             status.created.length > 0;
    } catch {
      return false;
    }
  }

  private parseConflictsFromError(errorMessage: string): string[] {
    const conflicts: string[] = [];
    const lines = errorMessage.split("\n");
    for (const line of lines) {
      if (line.includes("CONFLICT") && line.includes("Merge conflict in")) {
        const match = line.match(/Merge conflict in (.+)/);
        if (match) conflicts.push(match[1]);
      }
    }
    return conflicts;
  }

  private shouldSyncBeads(): boolean {
    return this.beadsModeProvider.getBeadsMode() !== 'off';
  }

  private async getTaskBeadId(feature: string, step: string): Promise<string | null> {
    const statusPath = this.getStepStatusPath(feature, step);
    try {
      const status = JSON.parse(await fs.readFile(statusPath, 'utf-8')) as { beadId?: string };
      return status.beadId ?? null;
    } catch {
      return null;
    }
  }

  private async syncWorktreeTaskBeadStatus(
    feature: string,
    step: string,
    status: TaskStatusType,
    context: string,
  ): Promise<void> {
    if (!this.shouldSyncBeads()) {
      return;
    }

    const beadId = await this.getTaskBeadId(feature, step);
    if (!beadId) {
      return;
    }

    try {
      this.worktreeBeadClient.syncTaskStatus(beadId, status);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(
        `[warcraft] Failed to sync bead status during ${context} for ${feature}/${step} (${beadId}): ${reason}`,
      );
    }
  }
}

export function createWorktreeService(projectDir: string): WorktreeService {
  return new WorktreeService({
    baseDir: projectDir,
    warcraftDir: getWarcraftPath(projectDir),
  });
}
