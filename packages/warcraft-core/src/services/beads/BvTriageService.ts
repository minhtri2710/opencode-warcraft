import type { BvCommandExecutor, BvHealth } from './bv-runner.js';
import { defaultBvExecutor, runBvCommand } from './bv-runner.js';

/**
 * Triage result containing a summary
 */
export interface BvTriageResult {
  summary: string;
}

export interface BvBlockerTriageDetails extends BvTriageResult {
  blockerChain: unknown | null;
  causality: unknown | null;
  topBlockers: string[];
}

export interface BvGlobalTriageDetails extends BvTriageResult {
  payload: unknown | null;
  dataHash?: string;
  analysisConfig?: unknown;
  metricStatus?: unknown;
  asOf?: string;
  asOfCommit?: string;
}

/**
 * BvTriageService manages BV (Beads Viewer) triage operations with explicit state ownership.
 *
 * Responsibilities:
 * - Execute bv CLI commands with appropriate flags
 * - Cache per-bead triage results
 * - Track health state (enabled, available, errors)
 * - Extract summaries from various payload shapes
 *
 * State ownership:
 * - lastError, lastErrorAt, lastSuccessAt: managed internally
 * - bvBlockerTriageCache: per-bead result cache
 */
export class BvTriageService {
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private bvBlockerTriageCache = new Map<string, BvBlockerTriageDetails | null>();

  constructor(
    private readonly directory: string,
    private readonly enabled: boolean,
    private readonly executor: BvCommandExecutor = defaultBvExecutor,
  ) {}

  /**
   * Get current health status of the BV service
   */
  getHealth(): BvHealth {
    const available = this.enabled && this.lastError === null;
    return {
      enabled: this.enabled,
      available,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      lastSuccessAt: this.lastSuccessAt,
    };
  }

  /**
   * Get blocker triage for a specific bead
   * Uses cache if available, otherwise executes bv commands
   */
  getBlockerTriage(beadId: string): BvTriageResult | null {
    const details = this.getBlockerTriageDetails(beadId);
    if (!details) {
      return null;
    }
    return { summary: details.summary };
  }

  /**
   * Get structured blocker triage details for a specific bead.
   */
  getBlockerTriageDetails(beadId: string): BvBlockerTriageDetails | null {
    // Check cache first
    if (this.bvBlockerTriageCache.has(beadId)) {
      return this.bvBlockerTriageCache.get(beadId) ?? null;
    }

    // Execute bv commands
    const blockerPayload = this.runBvRobot(['--robot-blocker-chain', beadId]);
    const blockerSummary = this.summarizeBvPayload(blockerPayload);

    const causalityPayload = this.runBvRobot(['--robot-causality', beadId]);
    const causalitySummary = this.summarizeBvPayload(causalityPayload);

    const parts = [blockerSummary, causalitySummary].filter(
      (v): v is string => !!v,
    );

    if (parts.length === 0) {
      this.bvBlockerTriageCache.set(beadId, null);
      return null;
    }

    const uniqueSummary = Array.from(new Set(parts)).slice(0, 2).join(' | ');
    const summary = uniqueSummary.length > 0
      ? uniqueSummary
      : 'bv triage available but no summary text was produced.';

    const topBlockers = this.extractTopBlockers(blockerPayload);
    const result = {
      summary,
      blockerChain: blockerPayload,
      causality: causalityPayload,
      topBlockers,
    };
    this.bvBlockerTriageCache.set(beadId, result);
    return result;
  }

  /**
   * Get global triage across all beads
   */
  getGlobalTriage(): BvTriageResult | null {
    const details = this.getGlobalTriageDetails();
    if (!details) {
      return null;
    }
    return { summary: details.summary };
  }

  /**
   * Get structured global triage payload.
   */
  getGlobalTriageDetails(): BvGlobalTriageDetails | null {
    const payload = this.runBvRobot(['--robot-triage']);
    const summary = this.summarizeGlobalTriage(payload);
    if (!summary) {
      return null;
    }

    const metadata = this.extractRobotMetadata(payload);
    return {
      summary,
      payload,
      ...metadata,
    };
  }

  private summarizeGlobalTriage(payload: unknown): string | null {
    const direct = this.summarizeBvPayload(payload);
    if (direct) {
      return direct;
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const root = payload as Record<string, unknown>;
    const triage = root.triage;
    if (!triage || typeof triage !== 'object') {
      return null;
    }

    const triageData = triage as Record<string, unknown>;
    const triageDirect = this.extractBvTriageSummary(triageData);
    if (triageDirect) {
      return triageDirect;
    }

    const recommendations = triageData.recommendations;
    if (Array.isArray(recommendations) && recommendations.length > 0) {
      const first = recommendations[0];
      if (first && typeof first === 'object') {
        const rec = first as Record<string, unknown>;
        const id = typeof rec.id === 'string' ? rec.id : null;
        const reason = typeof rec.reason === 'string' ? rec.reason : null;
        if (id && reason) {
          return `Top recommendation: ${id} — ${reason}`;
        }
        if (id) {
          return `Top recommendation: ${id}`;
        }
      }
    }

    const quickRef = triageData.quick_ref;
    if (quickRef && typeof quickRef === 'object') {
      const quick = quickRef as Record<string, unknown>;
      const actionable = typeof quick.actionable_count === 'number' ? quick.actionable_count : null;
      const openCount = typeof quick.open_count === 'number' ? quick.open_count : null;
      const topPicks = Array.isArray(quick.top_picks) ? quick.top_picks : [];
      const firstPick = topPicks[0];
      let topPickId: string | null = null;
      if (firstPick && typeof firstPick === 'object') {
        const pick = firstPick as Record<string, unknown>;
        topPickId = typeof pick.id === 'string' ? pick.id : null;
      }

      if (actionable !== null && topPickId) {
        return `${actionable} actionable issues. Top pick: ${topPickId}`;
      }
      if (actionable !== null && openCount !== null) {
        return `${actionable} actionable of ${openCount} open issues`;
      }
    }

    return null;
  }

  private extractRobotMetadata(payload: unknown): Pick<BvGlobalTriageDetails, 'dataHash' | 'analysisConfig' | 'metricStatus' | 'asOf' | 'asOfCommit'> {
    if (!payload || typeof payload !== 'object') {
      return {};
    }

    const root = payload as Record<string, unknown>;
    const metadata: Pick<BvGlobalTriageDetails, 'dataHash' | 'analysisConfig' | 'metricStatus' | 'asOf' | 'asOfCommit'> = {};

    if (typeof root.data_hash === 'string') {
      metadata.dataHash = root.data_hash;
    }
    if (root.analysis_config !== undefined) {
      metadata.analysisConfig = root.analysis_config;
    }
    if (root.status !== undefined) {
      metadata.metricStatus = root.status;
    }
    if (typeof root.as_of === 'string') {
      metadata.asOf = root.as_of;
    }
    if (typeof root.as_of_commit === 'string') {
      metadata.asOfCommit = root.as_of_commit;
    }

    return metadata;
  }

  /**
   * Execute bv CLI command and return parsed JSON payload
   */
  private runBvRobot(args: string[]): unknown | null {
    const { result, error } = runBvCommand(args, {
      directory: this.directory,
      enabled: this.enabled,
      executor: this.executor,
    });

    if (error) {
      this.lastError = error;
      this.lastErrorAt = Date.now();
      return null;
    }

    this.lastError = null;
    this.lastSuccessAt = Date.now();
    return result;
  }

  /**
   * Summarize a BV payload into a human-readable string
   * Handles various payload shapes including nested keys
   */
  private summarizeBvPayload(payload: unknown): string | null {
    const direct = this.extractBvTriageSummary(payload);
    if (direct) {
      return direct;
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const data = payload as Record<string, unknown>;
    const nestedKeys = ['top', 'primary', 'recommendation', 'next', 'insight', 'insights'];
    for (const key of nestedKeys) {
      const value = data[key];
      const nested = this.extractBvTriageSummary(value);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  /**
   * Extract summary from a BV payload object
   * Checks direct fields: summary, message, reason
   * Also checks blockers array
   */
  private extractBvTriageSummary(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const data = payload as Record<string, unknown>;
    const direct = ['summary', 'message', 'reason'];
    for (const key of direct) {
      const value = data[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    const blockers = data.blockers;
    if (Array.isArray(blockers) && blockers.length > 0) {
      const labels = blockers
        .slice(0, 3)
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const node = item as Record<string, unknown>;
          const id = typeof node.id === 'string' ? node.id : null;
          const title = typeof node.title === 'string' ? node.title : null;
          if (id && title) return `${id}: ${title}`;
          return id || title;
        })
        .filter((v): v is string => !!v);
      if (labels.length > 0) {
        return `Top blockers: ${labels.join('; ')}`;
      }
    }

    return null;
  }

  private extractTopBlockers(payload: unknown): string[] {
    if (!payload || typeof payload !== 'object') {
      return [];
    }

    const data = payload as Record<string, unknown>;
    const blockers = data.blockers;
    if (!Array.isArray(blockers) || blockers.length === 0) {
      return [];
    }

    return blockers
      .slice(0, 3)
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const node = item as Record<string, unknown>;
        const id = typeof node.id === 'string' ? node.id : null;
        const title = typeof node.title === 'string' ? node.title : null;
        if (id && title) return `${id}: ${title}`;
        return id || title;
      })
      .filter((v): v is string => !!v);
  }
}
