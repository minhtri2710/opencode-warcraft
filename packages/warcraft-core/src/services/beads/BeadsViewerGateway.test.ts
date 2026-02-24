import { describe, expect, it, beforeEach } from 'bun:test';
import { BeadsViewerGateway } from './BeadsViewerGateway.js';
import type { BvCommandExecutor } from './BeadsViewerGateway.js';

describe('BeadsViewerGateway', () => {
  const TEST_DIRECTORY = '/tmp/test-project';
  let mockExecutor: BvCommandExecutor;
  let callLog: Array<{ command: string; args: string[]; options: { cwd: string; encoding: 'utf-8'; timeout?: number } }>;

  beforeEach(() => {
    callLog = [];
    mockExecutor = (
      command: string,
      args: string[],
      options: { cwd: string; encoding: 'utf-8'; timeout?: number },
    ): string => {
      callLog.push({ command, args, options });
      return '{}';
    };
  });

  describe('getRobotPlan()', () => {
    it('calls bv with --robot-plan --format json flags', () => {
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);
      gateway.getRobotPlan();

      expect(callLog).toHaveLength(1);
      expect(callLog[0].command).toBe('bv');
      expect(callLog[0].args).toEqual(['--robot-plan', '--format', 'json']);
      expect(callLog[0].options.cwd).toBe(TEST_DIRECTORY);
      expect(callLog[0].options.encoding).toBe('utf-8');
      expect(callLog[0].options.timeout).toBe(30_000);
    });

    it('returns null when bv command fails', () => {
      const failingExecutor: BvCommandExecutor = () => {
        throw new Error('bv not installed');
      };
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, failingExecutor);

      const result = gateway.getRobotPlan();

      expect(result).toBeNull();
    });

    it('returns null when disabled', () => {
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, false, mockExecutor);

      const result = gateway.getRobotPlan();

      expect(result).toBeNull();
      expect(callLog).toHaveLength(0);
    });

    it('returns null when bv returns empty payload', () => {
      mockExecutor = (): string => '{}';
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);

      const result = gateway.getRobotPlan();

      expect(result).toBeNull();
    });

    it('parses parallel execution tracks from robot-plan output', () => {
      const mockOutput = JSON.stringify({
        plan: {
          summary: {
            total_tracks: 2,
            total_tasks: 5,
            highest_impact: 'bd-123',
          },
          tracks: [
            {
              track_id: 1,
              name: 'Backend Track',
              tasks: ['bd-1', 'bd-2', 'bd-3'],
              unblocks: ['bd-4', 'bd-5'],
            },
            {
              track_id: 2,
              name: 'Frontend Track',
              tasks: ['bd-4', 'bd-5'],
              unblocks: [],
            },
          ],
        },
      });
      mockExecutor = (): string => mockOutput;
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);

      const result = gateway.getRobotPlan();

      expect(result).not.toBeNull();
      expect(result?.summary.totalTracks).toBe(2);
      expect(result?.summary.totalTasks).toBe(5);
      expect(result?.summary.highestImpact).toBe('bd-123');
      expect(result?.tracks).toHaveLength(2);
      expect(result?.tracks[0].trackId).toBe('1');
      expect(result?.tracks[0].name).toBe('Backend Track');
      expect(result?.tracks[0].tasks).toEqual(['bd-1', 'bd-2', 'bd-3']);
      expect(result?.tracks[0].unblocks).toEqual(['bd-4', 'bd-5']);
      expect(result?.tracks[1].trackId).toBe('2');
      expect(result?.tracks[1].name).toBe('Frontend Track');
    });

    it('handles tracks with minimal fields', () => {
      const mockOutput = JSON.stringify({
        plan: {
          tracks: [
            {
              track_id: 1,
              tasks: ['bd-1'],
            },
          ],
        },
      });
      mockExecutor = (): string => mockOutput;
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);

      const result = gateway.getRobotPlan();

      expect(result).not.toBeNull();
      expect(result?.tracks).toHaveLength(1);
      expect(result?.tracks[0].trackId).toBe('1');
      expect(result?.tracks[0].tasks).toEqual(['bd-1']);
      expect(result?.tracks[0].name).toBeUndefined();
      expect(result?.tracks[0].unblocks).toBeUndefined();
    });

    it('returns null when plan field is missing', () => {
      const mockOutput = JSON.stringify({
        other: 'data',
      });
      mockExecutor = (): string => mockOutput;
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);

      const result = gateway.getRobotPlan();

      expect(result).toBeNull();
    });

    it('returns null when tracks field is missing', () => {
      const mockOutput = JSON.stringify({
        plan: {
          summary: {},
        },
      });
      mockExecutor = (): string => mockOutput;
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);

      const result = gateway.getRobotPlan();

      expect(result).toBeNull();
    });

    it('handles tracks with empty arrays', () => {
      const mockOutput = JSON.stringify({
        plan: {
          summary: {
            total_tracks: 0,
            total_tasks: 0,
          },
          tracks: [],
        },
      });
      mockExecutor = (): string => mockOutput;
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);

      const result = gateway.getRobotPlan();

      expect(result).not.toBeNull();
      expect(result?.tracks).toHaveLength(0);
      expect(result?.summary.totalTracks).toBe(0);
      expect(result?.summary.totalTasks).toBe(0);
    });

    it('filters out invalid track entries', () => {
      const mockOutput = JSON.stringify({
        plan: {
          tracks: [
            {
              track_id: 1,
              tasks: ['bd-1'],
            },
            'invalid track',
            {
              // missing track_id and tasks
              name: 'Invalid',
            },
            {
              track_id: 2,
              tasks: ['bd-2'],
            },
          ],
        },
      });
      mockExecutor = (): string => mockOutput;
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);

      const result = gateway.getRobotPlan();

      expect(result).not.toBeNull();
      expect(result?.tracks).toHaveLength(2);
      expect(result?.tracks[0].trackId).toBe('1');
      expect(result?.tracks[1].trackId).toBe('2');
    });

    it('preserves string track_id values', () => {
      const mockOutput = JSON.stringify({
        plan: {
          tracks: [
            {
              track_id: 'track-A',
              tasks: ['bd-1'],
            },
          ],
        },
      });
      mockExecutor = (): string => mockOutput;
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);

      const result = gateway.getRobotPlan();

      expect(result).not.toBeNull();
      expect(result?.tracks[0].trackId).toBe('track-A');
    });

    it('parses items-based robot-plan schema and derives summary counts', () => {
      const mockOutput = JSON.stringify({
        plan: {
          tracks: [
            {
              track_id: 'track-A',
              reason: 'Independent work stream',
              items: [
                { id: 'AUTH-001', unblocks: ['AUTH-002', 'AUTH-003'] },
                { id: 'API-010', unblocks: ['AUTH-003'] },
              ],
            },
          ],
          summary: {
            highest_impact: 'AUTH-001',
          },
        },
      });
      mockExecutor = (): string => mockOutput;
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);

      const result = gateway.getRobotPlan();

      expect(result).not.toBeNull();
      expect(result?.summary.totalTracks).toBe(1);
      expect(result?.summary.totalTasks).toBe(2);
      expect(result?.summary.highestImpact).toBe('AUTH-001');
      expect(result?.tracks[0].trackId).toBe('track-A');
      expect(result?.tracks[0].name).toBe('Independent work stream');
      expect(result?.tracks[0].tasks).toEqual(['AUTH-001', 'API-010']);
      expect(result?.tracks[0].unblocks).toEqual(['AUTH-002', 'AUTH-003']);
    });
  });

  describe('getHealth()', () => {
    it('returns enabled=false when service is disabled', () => {
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, false, mockExecutor);
      const health = gateway.getHealth();

      expect(health.enabled).toBe(false);
      expect(health.available).toBe(false);
    });

    it('returns enabled=true and available=true on fresh enabled service', () => {
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);
      const health = gateway.getHealth();

      expect(health.enabled).toBe(true);
      expect(health.available).toBe(true);
    });

    it('tracks lastError after command failure', () => {
      const failingExecutor: BvCommandExecutor = () => {
        throw new Error('Command not found: bv');
      };
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, failingExecutor);

      gateway.getRobotPlan();

      const health = gateway.getHealth();
      expect(health.available).toBe(false);
      expect(health.lastError).toBe('Command not found: bv');
      expect(health.lastErrorAt).not.toBeNull();
    });

    it('tracks lastSuccessAt after successful command', () => {
      const mockOutput = JSON.stringify({
        plan: {
          tracks: [{ track_id: 1, tasks: ['bd-1'] }],
        },
      });
      mockExecutor = (): string => mockOutput;
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, mockExecutor);

      gateway.getRobotPlan();

      const health = gateway.getHealth();
      expect(health.available).toBe(true);
      expect(health.lastError).toBeNull();
      expect(health.lastSuccessAt).not.toBeNull();
    });

    it('clears lastError after successful command', () => {
      let shouldFail = true;
      const toggleExecutor: BvCommandExecutor = (): string => {
        if (shouldFail) {
          throw new Error('Initial error');
        }
        return JSON.stringify({
          plan: {
            tracks: [{ track_id: 1, tasks: ['bd-1'] }],
          },
        });
      };
      const gateway = new BeadsViewerGateway(TEST_DIRECTORY, true, toggleExecutor);

      gateway.getRobotPlan(); // Fail
      shouldFail = false;
      gateway.getRobotPlan(); // Succeed

      const health = gateway.getHealth();
      expect(health.available).toBe(true);
      expect(health.lastError).toBeNull();
      expect(health.lastSuccessAt).not.toBeNull();
    });
  });
});
