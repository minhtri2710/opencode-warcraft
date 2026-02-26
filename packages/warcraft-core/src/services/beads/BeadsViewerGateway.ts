import type { BvCommandExecutor, BvHealth } from './bv-runner.js';
import { defaultBvExecutor, runBvCommand } from './bv-runner.js';

export type { BvCommandExecutor, BvHealth };

/**
 * Summary of a robot plan
 */
export interface RobotPlanSummary {
  totalTracks: number;
  totalTasks: number;
  highestImpact?: string;
}

/**
 * A parallel execution track
 */
export interface ExecutionTrack {
  trackId: string;
  name?: string;
  tasks: string[];
  unblocks?: string[];
}

/**
 * Result of getRobotPlan() containing parallel execution tracks
 */
export interface RobotPlanResult {
  summary: RobotPlanSummary;
  tracks: ExecutionTrack[];
}

/**
 * BeadsViewerGateway manages BV (Beads Viewer) operations for parallel execution planning.
 *
 * Responsibilities:
 * - Execute bv CLI commands with appropriate flags
 * - Parse robot-plan output to extract parallel execution tracks
 * - Track health state (enabled, available, errors)
 *
 * State ownership:
 * - lastError, lastErrorAt, lastSuccessAt: managed internally
 */
export class BeadsViewerGateway {
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private lastSuccessAt: number | null = null;

  constructor(
    private readonly directory: string,
    private readonly enabled: boolean,
    private readonly executor: BvCommandExecutor = defaultBvExecutor,
  ) {}

  /**
   * Get current health status of the BV gateway
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
   * Get robot plan with parallel execution tracks
   * Calls `bv --robot-plan --format json` and parses the output
   */
  getRobotPlan(): RobotPlanResult | null {
    const { result, error } = runBvCommand(['--robot-plan'], {
      directory: this.directory,
      enabled: this.enabled,
      executor: this.executor,
    });

    if (error) {
      this.lastError = error;
      this.lastErrorAt = Date.now();
      return null;
    }

    const parsed = this.parseRobotPlan(result);

    if (parsed) {
      this.lastError = null;
      this.lastSuccessAt = Date.now();
    } else {
      this.lastError = 'failed to parse robot plan output';
      this.lastErrorAt = Date.now();
    }

    return parsed;
  }

  /**
   * Parse robot plan JSON output into RobotPlanResult
   */
  private parseRobotPlan(payload: unknown): RobotPlanResult | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const data = payload as Record<string, unknown>;
    const plan = data.plan;

    if (!plan || typeof plan !== 'object') {
      return null;
    }

    const planData = plan as Record<string, unknown>;
    const tracksData = planData.tracks;

    if (!Array.isArray(tracksData)) {
      return null;
    }

    // Parse tracks first so summary can fall back to derived counts
    const tracks: ExecutionTrack[] = [];
    for (const trackItem of tracksData) {
      const track = this.parseTrack(trackItem);
      if (track) {
        tracks.push(track);
      }
    }

    // Parse summary
    const summaryData = planData.summary;
    const summary: RobotPlanSummary = {
      totalTracks: 0,
      totalTasks: 0,
    };

    if (summaryData && typeof summaryData === 'object') {
      const s = summaryData as Record<string, unknown>;
      if (typeof s.total_tracks === 'number') {
        summary.totalTracks = s.total_tracks;
      }
      if (typeof s.total_tasks === 'number') {
        summary.totalTasks = s.total_tasks;
      }
      if (typeof s.highest_impact === 'string') {
        summary.highestImpact = s.highest_impact;
      }
    }

    if (summary.totalTracks === 0) {
      summary.totalTracks = tracks.length;
    }
    if (summary.totalTasks === 0) {
      summary.totalTasks = tracks.reduce((count, track) => count + track.tasks.length, 0);
    }

    return {
      summary,
      tracks,
    };
  }

  /**
   * Parse a single track from the plan output
   */
  private parseTrack(trackItem: unknown): ExecutionTrack | null {
    if (!trackItem || typeof trackItem !== 'object') {
      return null;
    }

    const track = trackItem as Record<string, unknown>;

    // track_id is required and may be numeric (legacy) or string (current docs)
    let trackId: string | undefined;
    if (typeof track.track_id === 'number') {
      trackId = String(track.track_id);
    } else if (typeof track.track_id === 'string' && track.track_id.trim().length > 0) {
      trackId = track.track_id.trim();
    }

    if (!trackId) {
      return null;
    }

    const tasks: string[] = [];

    // Legacy schema: tracks[].tasks[]
    if (Array.isArray(track.tasks)) {
      for (const task of track.tasks) {
        if (typeof task === 'string' && task.trim().length > 0) {
          tasks.push(task.trim());
        }
      }
    }

    // Current schema: tracks[].items[].id
    if (Array.isArray(track.items)) {
      for (const item of track.items) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const itemRecord = item as Record<string, unknown>;
        if (typeof itemRecord.id === 'string' && itemRecord.id.trim().length > 0) {
          tasks.push(itemRecord.id.trim());
        }
      }
    }

    const dedupedTasks = Array.from(new Set(tasks));
    if (dedupedTasks.length === 0) {
      return null;
    }

    const result: ExecutionTrack = {
      trackId,
      tasks: dedupedTasks,
    };

    // name/reason are optional
    if (typeof track.name === 'string' && track.name.trim().length > 0) {
      result.name = track.name.trim();
    } else if (typeof track.reason === 'string' && track.reason.trim().length > 0) {
      result.name = track.reason.trim();
    }

    // unblocks may exist at track level (legacy) and/or item level (current schema)
    const unblocks: string[] = [];

    if (Array.isArray(track.unblocks)) {
      for (const item of track.unblocks) {
        if (typeof item === 'string' && item.trim().length > 0) {
          unblocks.push(item.trim());
        }
      }
    }

    if (Array.isArray(track.items)) {
      for (const item of track.items) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const itemRecord = item as Record<string, unknown>;
        if (!Array.isArray(itemRecord.unblocks)) {
          continue;
        }
        for (const candidate of itemRecord.unblocks) {
          if (typeof candidate === 'string' && candidate.trim().length > 0) {
            unblocks.push(candidate.trim());
          }
        }
      }
    }

    const dedupedUnblocks = Array.from(new Set(unblocks));
    if (dedupedUnblocks.length > 0) {
      result.unblocks = dedupedUnblocks;
    }

    return result;
  }
}
