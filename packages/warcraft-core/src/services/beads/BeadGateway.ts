import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import type { TaskInfo, TaskStatusType } from '../../types.js';
import { slugifyIdentifierSegment } from '../../utils/slug.js';
import type {
  AuditEntry,
  AuditRecordParams,
  BeadArtifactKind,
  BeadComment,
  TaskBeadArtifacts,
} from './BeadGateway.types.js';
import { BeadGatewayError } from './BeadGateway.types.js';
import {
  decodeAuditLog,
  decodeComments,
  decodeDependentIssues,
  decodeIdFromJson,
  decodeListItems,
  decodeShowPayload,
  decodeTasksFromDepList,
  extractBeadContent,
} from './beadDecoders.js';
import { getTaskBeadActions } from './beadMapping.js';

const ARTIFACTS_BEGIN = '<!-- WARCRAFT:ARTIFACTS:BEGIN -->';
const ARTIFACTS_END = '<!-- WARCRAFT:ARTIFACTS:END -->';
const ARTIFACT_COMMENT_PREFIX = 'WARCRAFT_ARTIFACT_V1 ';
const ARTIFACT_COMMENT_ENCODING = 'plain';
const BEAD_ARTIFACT_KINDS = new Set<BeadArtifactKind>(['spec', 'worker_prompt', 'report', 'task_state']);

export class BeadGateway {
  private preflightCompleted: boolean = false;

  constructor(private readonly projectRoot: string) {}

  checkAvailable(): string {
    try {
      const output = this.executeBr(['--version']);
      // Parse version from output like "beads_rust 1.2.3"
      const versionMatch = output.trim().match(/[\d.]+/);
      return versionMatch ? versionMatch[0] : output.trim();
    } catch (error) {
      throw new BeadGatewayError(
        'br_not_found',
        `br CLI not found or not usable [BR_NOT_FOUND]: ${this.getSafeFailureReason(error)}. Install beads_rust from https://github.com/Dicklesworthstone/beads_rust`,
        'BR_NOT_FOUND',
      );
    }
  }

  private ensurePreflight(): void {
    if (!this.preflightCompleted) {
      this.checkAvailable();
      this.ensureInitialized();
      this.preflightCompleted = true;
    }
  }

  private ensureInitialized(): void {
    if (!this.isRepositoryInitializedOnDisk()) {
      try {
        const output = this.executeBr(['init']);
        if (this.isAlreadyInitializedPayload(output)) {
          // Repository exists; continue into prefix normalization below.
        } else if (this.isErrorPayload(output)) {
          throw new BeadGatewayError(
            'command_error',
            'Failed to initialize beads repository [BR_INIT_FAILED]: br command failed',
            'BR_INIT_FAILED',
          );
        }
      } catch (error) {
        if (!this.isAlreadyInitializedError(error)) {
          throw new BeadGatewayError(
            'command_error',
            `Failed to initialize beads repository [BR_INIT_FAILED]: ${this.getSafeFailureReason(error)}`,
            'BR_INIT_FAILED',
          );
        }
      }
    }

    if (this.isRepositoryInitializedOnDisk()) {
      this.ensureStableIssuePrefix();
    }
  }

  private ensureStableIssuePrefix(): void {
    const config = this.readConfigList();
    const desiredPrefix = this.deriveStableIssuePrefix();

    if (!this.shouldNormalizeIssuePrefix(config, desiredPrefix)) {
      return;
    }

    try {
      this.executeBr(['config', 'set', 'issue_prefix', desiredPrefix]);
    } catch (error) {
      throw new BeadGatewayError(
        'command_error',
        `Failed to normalize beads issue prefix [BR_PREFIX_SET_FAILED]: ${this.getSafeFailureReason(error)}`,
        'BR_PREFIX_SET_FAILED',
      );
    }
  }

  private readConfigList(): Record<string, unknown> {
    let output = '';

    try {
      output = this.executeBr(['config', 'list', '--json']);
    } catch (error) {
      throw new BeadGatewayError(
        'command_error',
        `Failed to read beads configuration [BR_CONFIG_READ_FAILED]: ${this.getSafeFailureReason(error)}`,
        'BR_CONFIG_READ_FAILED',
      );
    }

    try {
      const parsed = JSON.parse(output) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config payload must be an object');
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new BeadGatewayError(
        'command_error',
        'Failed to read beads configuration [BR_CONFIG_READ_FAILED]: br returned invalid config output',
        'BR_CONFIG_READ_FAILED',
      );
    }
  }

  private deriveStableIssuePrefix(): string {
    return slugifyIdentifierSegment(basename(this.projectRoot));
  }

  private shouldNormalizeIssuePrefix(config: Record<string, unknown>, desiredPrefix: string): boolean {
    const storedPrefix = this.getConfigString(config, ['issue_prefix', 'id.prefix', 'issue-prefix', 'project.prefix']);
    const computedPrefix = this.getConfigString(config, ['_computed.prefix']);
    const currentPrefix = storedPrefix ?? computedPrefix;

    if (!currentPrefix) {
      return true;
    }

    if (currentPrefix === desiredPrefix) {
      return false;
    }

    if (!storedPrefix) {
      return true;
    }

    if (this.isDefaultIssuePrefix(storedPrefix)) {
      return true;
    }

    return this.isLikelyRandomIssuePrefix(storedPrefix);
  }

  private getConfigString(config: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = config[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    return null;
  }

  private isDefaultIssuePrefix(prefix: string): boolean {
    return prefix === 'bd' || prefix === 'beads' || prefix === 'br';
  }

  private isLikelyRandomIssuePrefix(prefix: string): boolean {
    return /^[a-z0-9]{6,}$/.test(prefix) && /\d/.test(prefix) && !prefix.includes('-');
  }

  private isDependencyAlreadyPresentError(error: unknown): boolean {
    const details = this.extractErrorDetails(error);
    return (
      details.includes('duplicate dependency') ||
      details.includes('already present') ||
      ((details.includes('dependency') || details.includes('edge')) && details.includes('already exists')) ||
      details.includes('unique constraint')
    );
  }

  private isDependencyAlreadyAbsentError(error: unknown): boolean {
    const details = this.extractErrorDetails(error);
    return (
      (details.includes('dependency') || details.includes('edge')) &&
      (details.includes('not found') || details.includes('does not exist') || details.includes('no such'))
    );
  }


  private isRepositoryInitializedOnDisk(): boolean {
    return existsSync(join(this.projectRoot, '.beads', 'beads.db'));
  }
  private getSafeFailureReason(error: unknown): string {
    const errorCode = this.getErrorCode(error);
    if (errorCode === 'ENOENT') {
      return 'br executable is unavailable';
    }

    if (errorCode === 'ETIMEDOUT' || errorCode === 'ESRCH') {
      return 'br command timed out';
    }

    if (this.isNotInitializedError(error)) {
      return 'beads repository is not initialized';
    }

    return 'br command failed';
  }

  private getErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
      return undefined;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }

  private extractErrorDetails(error: unknown): string {
    const reason = error instanceof Error ? error.message : String(error);
    const stderr = (error as Error & { stderr?: string }).stderr ?? '';
    const stdout = (error as Error & { stdout?: string }).stdout ?? '';
    return `${reason}\n${stderr}\n${stdout}`.toLowerCase();
  }

  private isAlreadyInitializedError(error: unknown): boolean {
    const details = this.extractErrorDetails(error);

    return this.hasAlreadyInitializedDetails(details);
  }
  private isNotInitializedError(error: unknown): boolean {
    const details = this.extractErrorDetails(error);

    return (
      details.includes('not initialized') || details.includes('not initialised') || details.includes('not_initialized')
    );
  }

  private isErrorPayload(output: string): boolean {
    return this.getErrorPayloadDetails(output) !== null;
  }

  private isAlreadyInitializedPayload(output: string): boolean {
    const details = this.getErrorPayloadDetails(output);
    if (!details) {
      return false;
    }
    return this.hasAlreadyInitializedDetails(details);
  }

  private getErrorPayloadDetails(output: string): string | null {
    try {
      const parsed = JSON.parse(output) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      const errorObj = (parsed as { error?: unknown }).error;
      if (!errorObj || typeof errorObj !== 'object' || Array.isArray(errorObj)) {
        return null;
      }

      const code = String((errorObj as { code?: unknown }).code ?? '').toLowerCase();
      const message = String((errorObj as { message?: unknown }).message ?? '').toLowerCase();
      const hint = String((errorObj as { hint?: unknown }).hint ?? '').toLowerCase();
      return `${code}\n${message}\n${hint}`;
    } catch {
      return null;
    }
  }

  private hasAlreadyInitializedDetails(details: string): boolean {
    return (
      details.includes('already initialized') ||
      details.includes('already initialised') ||
      details.includes('already been initialized') ||
      details.includes('already been initialised') ||
      details.includes('already_initialized')
    );
  }
  private isNotInitializedPayload(output: string): boolean {
    const details = this.getErrorPayloadDetails(output);
    if (!details) {
      return false;
    }
    return (
      details.includes('not_initialized') || details.includes('not initialized') || details.includes('not initialised')
    );
  }

  private static readonly TIMEOUT_READ = 5_000;
  private static readonly TIMEOUT_WRITE = 15_000;
  private static readonly TIMEOUT_SYNC = 30_000;

  private getOperationTimeout(args: string[]): number {
    const cmd = args[0];
    if (cmd === 'sync') return BeadGateway.TIMEOUT_SYNC;
    if (cmd === 'list' || cmd === 'show' || cmd === '--version') return BeadGateway.TIMEOUT_READ;
    if (cmd === 'dep' && args[1] === 'list') return BeadGateway.TIMEOUT_READ;
    if (cmd === 'comments' && args[1] === 'list') return BeadGateway.TIMEOUT_READ;
    if (cmd === 'audit' && args[1] === 'log') return BeadGateway.TIMEOUT_READ;
    return BeadGateway.TIMEOUT_WRITE;
  }

  private executeBr(args: string[]): string {
    return execFileSync('br', args, {
      cwd: this.projectRoot,
      encoding: 'utf-8',
      timeout: this.getOperationTimeout(args),
      // Keep CLI output off the parent process console; capture for parsing/sanitization only.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  createEpic(name: string, priority: number): string {
    this.ensurePreflight();
    this.validatePriority(priority);
    const output = this.runBr(
      ['create', name, '-t', 'epic', '-p', String(priority - 1), '--json'],
      `create epic bead for '${name}'`,
    );
    return decodeIdFromJson(output, `epic bead for feature '${name}'`);
  }

  createTask(title: string, epicBeadId: string, priority: number): string {
    this.ensurePreflight();
    this.validatePriority(priority);
    const output = this.runBr(
      ['create', title, '-t', 'task', '--parent', epicBeadId, '-p', String(priority - 1), '--json'],
      `create child bead '${title}' under epic '${epicBeadId}'`,
    );
    return decodeIdFromJson(output, `child bead for task '${title}'`);
  }

  private validatePriority(priority: number): void {
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
      throw new BeadGatewayError(
        'invalid_priority',
        `Priority must be an integer between 1 and 5 (inclusive), got: ${priority}. Mapping to br priority is 1->0, 2->1, 3->2, 4->3, 5->4.`,
      );
    }
  }

  syncTaskStatus(beadId: string, status: TaskStatusType): void {
    this.ensurePreflight();
    const actions = getTaskBeadActions(status);
    for (const action of actions) {
      // Remove stale labels from prior states before applying the new state.
      // Best-effort: if a label doesn't exist on the bead, br may error —
      // swallow that to avoid aborting the actual status transition.
      if ('removeLabels' in action && action.removeLabels) {
        for (const label of action.removeLabels) {
          try {
            this.removeLabel(beadId, label);
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.warn(`[warcraft] Failed to remove label '${label}' from bead '${beadId}' (best-effort): ${reason}`);
          }
        }
      }

      if (action.type === 'close') {
        this.runBr(['close', beadId], `close bead '${beadId}'`);
      } else if (action.type === 'claim') {
        this.runBr(['update', beadId, '--claim'], `claim bead '${beadId}'`);
      } else if (action.type === 'unclaim') {
        // No --unclaim flag exists in br CLI. Use --assignee '' -s open instead.
        // Fallback: if the combined command fails, try separate status then assignee clear.
        try {
          this.runBr(['update', beadId, '--assignee', '', '-s', 'open'], `unclaim bead '${beadId}'`);
        } catch (combinedError) {
          const reason = combinedError instanceof Error ? combinedError.message : String(combinedError);
          console.warn(
            `[warcraft] Combined unclaim failed for '${beadId}', retrying with separate commands: ${reason}`,
          );
          try {
            this.runBr(['update', beadId, '-s', 'open'], `reopen bead '${beadId}'`);
          } catch (reopenError) {
            const reopenReason = reopenError instanceof Error ? reopenError.message : String(reopenError);
            console.warn(`[warcraft] Failed to reopen bead '${beadId}' during unclaim fallback: ${reopenReason}`);
          }
          try {
            this.runBr(['update', beadId, '--assignee', ''], `clear assignee on bead '${beadId}'`);
          } catch (assigneeError) {
            const assigneeReason = assigneeError instanceof Error ? assigneeError.message : String(assigneeError);
            console.warn(
              `[warcraft] Failed to clear assignee on bead '${beadId}' during unclaim fallback: ${assigneeReason}`,
            );
          }
        }
      } else {
        this.runBr(['update', beadId, '-s', 'deferred'], `mark bead '${beadId}' deferred`);
        this.runBr(['update', beadId, '--add-label', action.label], `add label '${action.label}' to bead '${beadId}'`);
      }
    }
  }

  closeBead(beadId: string): void {
    this.ensurePreflight();
    this.runBr(['close', beadId], `close bead '${beadId}'`);
  }

  flushArtifacts(): void {
    this.ensurePreflight();
    this.runBr(['sync', '--flush-only'], 'flush bead artifacts to disk');
  }

  importArtifacts(): void {
    this.ensurePreflight();
    this.runBr(['sync', '--import-only'], 'import bead artifacts from disk');
  }

  addLabel(beadId: string, label: string): void {
    this.ensurePreflight();
    this.runBr(['update', beadId, '--add-label', label], `add label '${label}' to bead '${beadId}'`);
  }

  removeLabel(beadId: string, label: string): void {
    this.ensurePreflight();
    this.runBr(['update', beadId, '--remove-label', label], `remove label '${label}' from bead '${beadId}'`);
  }

  addDependency(beadId: string, dependsOnBeadId: string): void {
    this.ensurePreflight();
    this.runBr(
      ['dep', 'add', beadId, dependsOnBeadId],
      `add dependency: '${beadId}' depends on '${dependsOnBeadId}'`,
      { isBenignError: (error) => this.isDependencyAlreadyPresentError(error) },
    );
  }

  removeDependency(beadId: string, dependsOnBeadId: string): void {
    this.ensurePreflight();
    this.runBr(
      ['dep', 'remove', beadId, dependsOnBeadId],
      `remove dependency: '${beadId}' depends on '${dependsOnBeadId}'`,
      { isBenignError: (error) => this.isDependencyAlreadyAbsentError(error) },
    );
  }

  /**
   * List 'blocks' type dependency targets for a given bead.
   * Returns beads that this bead depends on (blocks relationship).
   */
  listDependencies(beadId: string): Array<{ id: string; title: string; status: string }> {
    this.ensurePreflight();
    const output = this.runBr(
      ['dep', 'list', beadId, '--direction', 'down', '--type', 'blocks', '--json'],
      `list dependencies for bead '${beadId}'`,
    );
    return decodeDependentIssues(output, `dependencies for bead '${beadId}'`, 'blocks');
  }

  addComment(beadId: string, comment: string): void {
    this.ensurePreflight();

    const tempDir = mkdtempSync(join(tmpdir(), 'warcraft-comment-'));
    const tempFile = join(tempDir, 'comment.txt');
    try {
      writeFileSync(tempFile, comment, 'utf8');
      this.runBr(['comments', 'add', beadId, '--file', tempFile, '--no-daemon'], `add comment to bead '${beadId}'`);
    } catch (error) {
      if (error instanceof BeadGatewayError && error.internalCode === 'BR_COMMAND_FAILED') {
        this.runBr(['comments', 'add', beadId, '--file', tempFile, '--no-daemon'], `add comment to bead '${beadId}'`);
      } else {
        throw error;
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  listComments(beadId: string): BeadComment[] {
    this.ensurePreflight();
    const output = this.runBr(
      ['comments', 'list', beadId, '--json', '--no-daemon'],
      `list comments for bead '${beadId}'`,
    );
    return decodeComments(output, beadId);
  }

  /**
   * Record an audit event for agent interaction logging.
   *
   * SECURITY: This method intentionally does NOT accept prompt or response
   * content. Only interaction metadata is recorded.
   *
   * @param params - Audit record parameters (kind, issueId, and optional metadata)
   */
  auditRecord(params: AuditRecordParams): void {
    this.ensurePreflight();
    const args: string[] = ['audit', 'record', '--kind', params.kind, '--issue-id', params.issueId];
    if (params.model !== undefined) {
      args.push('--model', params.model);
    }
    if (params.toolName !== undefined) {
      args.push('--tool-name', params.toolName);
    }
    if (params.exitCode !== undefined) {
      args.push('--exit-code', String(params.exitCode));
    }
    if (params.error !== undefined) {
      args.push('--error', params.error);
    }
    this.runBr(args, `record audit event for bead '${params.issueId}'`);
  }

  /**
   * Retrieve the audit log for a bead.
   *
   * @param beadId - Bead ID to retrieve audit log for
   * @returns Array of audit entries
   */
  auditLog(beadId: string): AuditEntry[] {
    this.ensurePreflight();
    const output = this.runBr(['audit', 'log', beadId, '--json'], `retrieve audit log for bead '${beadId}'`);
    return decodeAuditLog(output, beadId);
  }

  generateChangelog(options?: { robot?: boolean }): string {
    this.ensurePreflight();
    const args = ['changelog', ...(options?.robot ? ['--robot'] : [])];
    return this.runBr(args, 'generate changelog');
  }

  show(beadId: string): unknown {
    this.ensurePreflight();
    const output = this.runBr(['show', beadId, '--json'], `show bead '${beadId}'`);
    return decodeShowPayload(output, beadId);
  }

  /**
   * Show bead in toon format (token-optimized, LLM-friendly).
   *
   * Returns the raw toon-format string without parsing.
   * The toon format is already optimized for LLM consumption.
   *
   * @param beadId - Bead ID to show
   * @returns Raw toon-format string
   */
  showToon(beadId: string): string {
    this.ensurePreflight();
    return this.runBr(['show', beadId, '--format', 'toon'], `show bead '${beadId}' in toon format`);
  }

  readDescription(beadId: string): string | null {
    const parsed = this.show(beadId);
    return extractBeadContent(parsed);
  }

  list(options?: {
    type?: 'epic' | 'task' | string;
    parent?: string;
    status?: 'open' | 'closed' | 'all';
  }): Array<{ id: string; title: string; status: string; type?: string }> {
    this.ensurePreflight();
    const args = options?.parent
      ? ['dep', 'list', options.parent, '--direction', 'up', '--type', 'parent-child', '--json']
      : ['list', '--json'];

    if (!options?.parent && options?.type) {
      args.push('--type', options.type);
    }

    if (!options?.parent && options?.status === 'all') {
      args.push('-a');
    } else if (!options?.parent && options?.status === 'closed') {
      args.push('-s', 'closed');
    }

    const output = this.runBr(args, options?.parent ? `list child beads under '${options.parent}'` : 'list beads');

    const items = options?.parent
      ? decodeDependentIssues(output, 'bead list', 'parent-child', options?.type)
      : decodeListItems(output, 'bead list');

    return items.filter((item) => {
      if (options?.type && item.type !== options.type) {
        return false;
      }
      if (options?.status && options.status !== 'all' && item.status !== options.status) {
        return false;
      }
      return true;
    });
  }

  /**
   * List all child tasks of an epic in a single CLI call.
   * Returns TaskInfo[] parsed from `br dep list` output.
   */
  listTasksForEpic(epicId: string): TaskInfo[] {
    this.ensurePreflight();
    const output = this.runBr(
      ['dep', 'list', epicId, '--direction', 'up', '--type', 'parent-child', '--json'],
      `list tasks for epic '${epicId}'`,
    );
    return decodeTasksFromDepList(output, epicId);
  }

  updateStatus(beadId: string, status: string): void {
    this.ensurePreflight();
    this.runBr(['update', beadId, '--status', status], `update status of bead '${beadId}' to '${status}'`);
  }

  updateDescription(beadId: string, content: string): void {
    this.ensurePreflight();
    this.runBr(['update', beadId, '--description', content], `update bead description for '${beadId}'`);
  }

  upsertArtifact(beadId: string, kind: BeadArtifactKind, content: string): void {
    this.ensurePreflight();
    if (kind === 'spec') {
      // Spec is description-only: single canonical write path, no comment duplication
      this.updateDescription(beadId, content);
      return;
    }
    this.addComment(beadId, this.serializeArtifactComment(kind, content));
  }

  readArtifact(beadId: string, kind: BeadArtifactKind): string | null {
    this.ensurePreflight();

    if (kind === 'spec') {
      const description = this.readDescription(beadId);
      if (!description) {
        return null;
      }

      const hasArtifactsBlock = description.includes(ARTIFACTS_BEGIN) && description.includes(ARTIFACTS_END);
      if (!hasArtifactsBlock) {
        return description;
      }

      const { artifacts } = this.parseArtifacts(description);
      return artifacts.spec ?? null;
    }

    // Non-spec artifacts: prefer comment snapshot, fallback to description
    const commentArtifact = this.readLatestArtifactComment(beadId, kind);
    if (commentArtifact !== null) {
      return commentArtifact;
    }

    const description = this.readDescription(beadId);
    if (!description) {
      return null;
    }
    const { artifacts } = this.parseArtifacts(description);
    return artifacts[kind] ?? null;
  }

  // ---------------------------------------------------------------------------
  // runBr: consolidated retry logic for NOT_INITIALIZED
  // ---------------------------------------------------------------------------

  private runBr(
    args: string[],
    operation: string,
    options?: { isBenignError?: (error: unknown) => boolean },
  ): string {
    const shouldAttemptReinit = args[0] !== 'init';
    const isBenignError = (error: unknown): boolean => options?.isBenignError?.(error) ?? false;

    const executeAndCheck = (): string => {
      const output = this.executeBr(args);
      if (shouldAttemptReinit && this.isNotInitializedPayload(output)) {
        throw new NotInitializedSignal();
      }
      return output;
    };

    try {
      return executeAndCheck();
    } catch (error) {
      if (isBenignError(error)) {
        return '';
      }

      if (error instanceof BeadGatewayError) {
        throw error;
      }

      const isNotInit =
        error instanceof NotInitializedSignal || (shouldAttemptReinit && this.isNotInitializedError(error));

      if (isNotInit) {
        this.ensureInitialized();
        try {
          return executeAndCheck();
        } catch (retryError) {
          if (isBenignError(retryError)) {
            return '';
          }

          if (retryError instanceof BeadGatewayError) {
            throw retryError;
          }

          if (retryError instanceof NotInitializedSignal || this.isNotInitializedError(retryError)) {
            throw new BeadGatewayError(
              'command_error',
              `Failed to ${operation} [BR_NOT_INITIALIZED]: beads repository initialization failed`,
              'BR_NOT_INITIALIZED',
            );
          }

          throw new BeadGatewayError(
            'command_error',
            `Failed to ${operation} [BR_COMMAND_FAILED]: ${this.getSafeFailureReason(retryError)}` ,
            'BR_COMMAND_FAILED',
          );
        }
      }

      throw new BeadGatewayError(
        'command_error',
        `Failed to ${operation} [BR_COMMAND_FAILED]: ${this.getSafeFailureReason(error)}`,
        'BR_COMMAND_FAILED',
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Artifact serialization / deserialization (not moved to decoders because
  // these are tightly coupled to the comment-based artifact protocol)
  // ---------------------------------------------------------------------------

  private parseArtifacts(description: string): { prefix: string; artifacts: TaskBeadArtifacts } {
    const beginIndex = description.indexOf(ARTIFACTS_BEGIN);
    const endIndex = description.indexOf(ARTIFACTS_END);

    if (beginIndex < 0 || endIndex < 0 || endIndex < beginIndex) {
      return {
        prefix: description.trimEnd(),
        artifacts: {},
      };
    }

    const prefix = description.slice(0, beginIndex).trimEnd();
    const payload = description.slice(beginIndex + ARTIFACTS_BEGIN.length, endIndex).trim();

    if (!payload) {
      return { prefix, artifacts: {} };
    }

    try {
      const parsed = JSON.parse(payload);
      const artifacts: TaskBeadArtifacts = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') {
          (artifacts as Record<string, string>)[key] = value;
        }
      }
      return { prefix, artifacts };
    } catch {
      return { prefix, artifacts: {} };
    }
  }

  private serializeArtifactComment(kind: BeadArtifactKind, content: string): string {
    const header = JSON.stringify({
      kind,
      encoding: ARTIFACT_COMMENT_ENCODING,
      ts: new Date().toISOString(),
    });
    return `${ARTIFACT_COMMENT_PREFIX}${header}\n${content}`;
  }

  private readLatestArtifactComment(beadId: string, kind: BeadArtifactKind): string | null {
    const comments = this.listComments(beadId);
    let bestContent: string | null = null;
    let bestTs: number | null = null;
    let bestNid: number | null = null;
    let bestIdx = -1;

    for (let i = 0; i < comments.length; i++) {
      const artifact = this.parseArtifactComment(comments[i].body);
      if (artifact?.kind !== kind) continue;

      const ts = this.parseCommentTimestamp(comments[i].timestamp);
      const nid = this.parseCommentNumericId(comments[i].id);

      if (this.isNewerCandidate(ts, nid, i, bestTs, bestNid, bestIdx)) {
        bestContent = artifact.content;
        bestTs = ts;
        bestNid = nid;
        bestIdx = i;
      }
    }

    return bestContent;
  }

  /**
   * Returns true when candidate (ts, nid, idx) should replace the current best.
   * Tie-breaking order: higher timestamp > higher numericId > higher array index.
   * Presence beats absence for timestamp and numericId.
   */
  private isNewerCandidate(
    ts: number | null,
    nid: number | null,
    idx: number,
    bestTs: number | null,
    bestNid: number | null,
    bestIdx: number,
  ): boolean {
    if (bestIdx === -1) return true;
    if (ts !== null && bestTs !== null && ts !== bestTs) return ts > bestTs;
    if (ts !== null && bestTs === null) return true;
    if (ts === null && bestTs !== null) return false;
    if (nid !== null && bestNid !== null && nid !== bestNid) return nid > bestNid;
    if (nid !== null && bestNid === null) return true;
    if (nid === null && bestNid !== null) return false;
    return idx > bestIdx;
  }

  private parseCommentNumericId(value: string): number | null {
    const numericId = Number(value);
    if (!Number.isInteger(numericId)) {
      return null;
    }
    return numericId;
  }

  private parseCommentTimestamp(value: string | undefined): number | null {
    if (!value) {
      return null;
    }
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? null : timestamp;
  }

  private parseArtifactComment(body: string): { kind: BeadArtifactKind; content: string } | null {
    if (!body.startsWith(ARTIFACT_COMMENT_PREFIX)) return null;
    const headerEndIndex = body.indexOf('\n');
    if (headerEndIndex === -1) return null;
    const headerJson = body.slice(ARTIFACT_COMMENT_PREFIX.length, headerEndIndex).trim();
    const payload = body.slice(headerEndIndex + 1);
    if (!headerJson) return null;
    try {
      const parsed = JSON.parse(headerJson) as { kind?: string; encoding?: string };
      if (!parsed.kind || !this.isBeadArtifactKind(parsed.kind)) return null;
      // Support both 'plain' (new) and 'base64' (legacy reads)
      if (parsed.encoding === 'base64') {
        return { kind: parsed.kind, content: Buffer.from(payload.trim(), 'base64').toString('utf8') };
      }
      return { kind: parsed.kind, content: payload };
    } catch {
      return null;
    }
  }

  private isBeadArtifactKind(value: string): value is BeadArtifactKind {
    return BEAD_ARTIFACT_KINDS.has(value as BeadArtifactKind);
  }
}

/**
 * Internal signal used to unify the NOT_INITIALIZED detection path
 * from success-payload checks into the error handling flow of runBr.
 */
class NotInitializedSignal extends Error {
  constructor() {
    super('NOT_INITIALIZED payload detected');
    this.name = 'NotInitializedSignal';
  }
}

export { BeadGatewayError };
