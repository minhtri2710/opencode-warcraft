import { execFileSync } from 'child_process';
import type { TaskStatusType } from '../../types.js';
import { getTaskBeadActions } from './beadMapping.js';
import type { BeadArtifactKind, TaskBeadArtifacts } from './BeadGateway.types.js';
import { BeadGatewayError } from './BeadGateway.types.js';

const ARTIFACTS_BEGIN = '<!-- WARCRAFT:ARTIFACTS:BEGIN -->';
const ARTIFACTS_END = '<!-- WARCRAFT:ARTIFACTS:END -->';

export class BeadGateway {
  private preflightCompleted: boolean = false;

  constructor(private readonly projectRoot: string) {}

  checkAvailable(): string {
    try {
      const output = execFileSync('br', ['--version'], {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 30_000,
      });
      // Parse version from output like "beads_rust 1.2.3"
      const versionMatch = output.trim().match(/[\d.]+/);
      return versionMatch ? versionMatch[0] : output.trim();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new BeadGatewayError(
        'br_not_found',
        `br CLI not found or not usable: ${reason}. Install beads_rust from https://github.com/Dicklesworthstone/beads_rust`,
      );
    }
  }

  private ensurePreflight(): void {
    if (!this.preflightCompleted) {
      this.checkAvailable();
      this.preflightCompleted = true;
    }
  }

  createEpic(name: string, priority: number): string {
    this.ensurePreflight();
    this.validatePriority(priority);
    const output = this.runBr(
      ['create', name, '-t', 'epic', '-p', String(priority - 1), '--json'],
      `create epic bead for '${name}'`,
    );
    return this.parseIdFromJson(output, `epic bead for feature '${name}'`);
  }

  createTask(title: string, epicBeadId: string, priority: number): string {
    this.ensurePreflight();
    this.validatePriority(priority);
    const output = this.runBr(
      ['create', title, '-t', 'task', '--parent', epicBeadId, '-p', String(priority - 1), '--json'],
      `create child bead '${title}' under epic '${epicBeadId}'`,
    );
    return this.parseIdFromJson(output, `child bead for task '${title}'`);
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
      if (action.type === 'close') {
        this.runBr(['close', beadId], `close bead '${beadId}'`);
      } else if (action.type === 'claim') {
        this.runBr(['update', beadId, '--claim'], `claim bead '${beadId}'`);
      } else if (action.type === 'unclaim') {
        this.runBr(['update', beadId, '--unclaim'], `unclaim bead '${beadId}'`);
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

  addComment(beadId: string, comment: string): void {
    this.ensurePreflight();
    this.runBr(['comments', 'add', beadId, comment], `add comment to bead '${beadId}'`);
  }

  show(beadId: string): unknown {
    this.ensurePreflight();
    const output = this.runBr(['show', beadId, '--json'], `show bead '${beadId}'`);
    const parsed = this.parseJson(output, `bead data for '${beadId}'`);
    // br show --json returns a single-element array; unwrap it
    if (Array.isArray(parsed) && parsed.length === 1) {
      return parsed[0];
    }
    return parsed;
  }

  readDescription(beadId: string): string | null {
    const parsed = this.show(beadId);
    return this.extractBeadContent(parsed);
  }

  list(options?: { type?: 'epic' | 'task' | string; parent?: string; status?: 'open' | 'closed' | 'all' }): Array<{ id: string; title: string; status: string; type?: string }> {
    this.ensurePreflight();
    const args = options?.parent
      ? ['dep', 'list', options.parent, '--direction', 'up', '--json']
      : ['list', '--json'];

    if (!options?.parent) {
      if (options?.type) {
        args.push('--type', options.type);
      }

      if (options?.status === 'all') {
        args.push('-a');
      } else if (options?.status === 'closed') {
        args.push('-s', 'closed');
      }
    }

    const output = this.runBr(args, options?.parent ? `list child beads under '${options.parent}'` : 'list beads');
    const parsed = this.parseJson(output, 'bead list');

    const items = options?.parent ? this.parseDependentIssues(parsed, options.type) : this.parseListItems(parsed);

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

  private parseListItems(payload: unknown): Array<{ id: string; title: string; status: string; type?: string }> {
    const items = Array.isArray(payload)
      ? payload
      : (payload && typeof payload === 'object'
          ? (['issues', 'results', 'items', 'data']
              .map((key) => (payload as Record<string, unknown>)[key])
              .find((value) => Array.isArray(value)) as unknown[] | undefined) ?? []
          : []);

    return items
      .map((item: unknown) => {
        const obj = item as Record<string, unknown>;
        return {
          id: String(obj.id || ''),
          title: String(obj.title || ''),
          status: String(obj.status || ''),
          type: obj.issue_type ? String(obj.issue_type) : (obj.type ? String(obj.type) : undefined),
        };
      })
      .filter((item) => item.id);
  }

  private parseDependentIssues(payload: unknown, issueTypeHint?: string): Array<{ id: string; title: string; status: string; type?: string }> {
    const dependencies = Array.isArray(payload)
      ? payload
      : (payload && typeof payload === 'object'
          ? (['dependencies', 'results', 'items', 'data']
              .map((key) => (payload as Record<string, unknown>)[key])
              .find((value) => Array.isArray(value)) as unknown[] | undefined) ?? []
          : []);

    const children = new Map<string, { id: string; title: string; status: string; type?: string }>();
    for (const dependency of dependencies) {
      const dep = dependency as Record<string, unknown>;
      const relationType = dep.type ? String(dep.type) : undefined;
      if (relationType && relationType !== 'parent-child') {
        continue;
      }

      const candidate = dep.issue ?? dep.dependent ?? dep.target ?? dep.child ?? dep.to;
      const hasEmbeddedIssue = Boolean(candidate && typeof candidate === 'object');
      const issue = hasEmbeddedIssue ? (candidate as Record<string, unknown>) : dep;
      const id = String(issue.id || issue.issue_id || '');
      if (!id) {
        continue;
      }

      children.set(id, {
        id,
        title: String(issue.title || dep.title || ''),
        status: String(issue.status || dep.status || ''),
        type: hasEmbeddedIssue && (issue.issue_type || issue.type) ? String(issue.issue_type || issue.type) : issueTypeHint,
      });
    }

    return Array.from(children.values());
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
      const currentDescription = this.readDescription(beadId) ?? '';
      const { artifacts } = this.parseArtifacts(currentDescription);
      if (Object.keys(artifacts).length > 0) {
        this.updateDescription(beadId, this.composeArtifactsDescription(content, artifacts));
      } else {
        this.updateDescription(beadId, content);
      }
      return;
    }

    const currentDescription = this.readDescription(beadId) ?? '';
    const { prefix, artifacts } = this.parseArtifacts(currentDescription);
    artifacts[kind] = content;
    this.updateDescription(beadId, this.composeArtifactsDescription(prefix, artifacts));
  }

  readArtifact(beadId: string, kind: BeadArtifactKind): string | null {
    this.ensurePreflight();
    const description = this.readDescription(beadId);
    if (!description) {
      return null;
    }
    const { prefix, artifacts } = this.parseArtifacts(description);
    if (kind === 'spec' && !artifacts.spec) {
      return prefix.length > 0 ? prefix : description;
    }
    return artifacts[kind] ?? null;
  }

  private runBr(args: string[], operation: string): string {
    try {
      return execFileSync('br', args, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        timeout: 30_000,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const stderr = (error as Error & { stderr?: string }).stderr;
      const stdout = (error as Error & { stdout?: string }).stdout;
      let fullMessage = `Failed to ${operation}: ${reason}`;
      if (stderr) {
        fullMessage += `\nstderr: ${stderr}`;
      }
      if (stdout) {
        fullMessage += `\nstdout: ${stdout}`;
      }
      throw new BeadGatewayError('command_error', fullMessage);
    }
  }

  private parseJson(output: string, target: string): unknown {
    try {
      return JSON.parse(output) as unknown;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new BeadGatewayError('parse_error', `Failed to parse ${target}: ${reason}`);
    }
  }

  private parseIdFromJson(output: string, target: string): string {
    const parsed = this.parseJson(output, target) as { id?: string };
    if (!parsed.id) {
      throw new BeadGatewayError('missing_field', `Failed to parse ${target}: missing id in br output`);
    }
    return parsed.id;
  }

  private extractBeadContent(payload: unknown): string | null {
    if (typeof payload === 'string') {
      const trimmed = payload.trim();
      return trimmed.length > 0 ? payload : null;
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    if (Array.isArray(payload)) {
      for (const item of payload) {
        const content = this.extractBeadContent(item);
        if (content) {
          return content;
        }
      }
      return null;
    }

    const obj = payload as Record<string, unknown>;
    const preferredKeys = ['description', 'body', 'content'];
    for (const key of preferredKeys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }

    const nestedKeys = ['issue', 'issues', 'result', 'results', 'item', 'items', 'data'];
    for (const key of nestedKeys) {
      const value = obj[key];
      if (value !== undefined) {
        const content = this.extractBeadContent(value);
        if (content) {
          return content;
        }
      }
    }

    return null;
  }

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

  private composeArtifactsDescription(prefix: string, artifacts: TaskBeadArtifacts): string {
    const artifactsJson = JSON.stringify(artifacts, null, 2);
    const artifactsBlock = `${ARTIFACTS_BEGIN}\n${artifactsJson}\n${ARTIFACTS_END}`;
    if (!prefix) {
      return artifactsBlock;
    }
    return `${prefix}\n\n${artifactsBlock}`;
  }
}

export { BeadGatewayError };
