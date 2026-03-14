import { describe, expect, it } from 'bun:test';
import { BvTriageService } from './BvTriageService.js';
import type { BvCommandExecutor } from './bv-runner.js';

function createMockExecutor(result: unknown = null, shouldThrow = false): BvCommandExecutor {
  return () => {
    if (shouldThrow) throw new Error('bv failed');
    return JSON.stringify(result);
  };
}

describe('BvTriageService extra edge cases', () => {
  describe('getGlobalTriageDetails()', () => {
    it('extracts metadata from payload', () => {
      const payload = {
        summary: 'Triage',
        data_hash: 'abc123',
        analysis_config: { threshold: 0.5 },
        status: 'healthy',
        as_of: '2026-01-01',
        as_of_commit: 'deadbeef',
      };
      const executor = createMockExecutor(payload);
      const service = new BvTriageService('/tmp', true, executor);
      const details = service.getGlobalTriageDetails();
      expect(details).not.toBeNull();
      expect(details!.dataHash).toBe('abc123');
      expect(details!.analysisConfig).toEqual({ threshold: 0.5 });
      expect(details!.metricStatus).toBe('healthy');
      expect(details!.asOf).toBe('2026-01-01');
      expect(details!.asOfCommit).toBe('deadbeef');
    });

    it('returns null when triage produces empty object', () => {
      const executor = createMockExecutor({});
      const service = new BvTriageService('/tmp', true, executor);
      expect(service.getGlobalTriageDetails()).toBeNull();
    });
  });

  describe('summarizeGlobalTriage nested paths', () => {
    it('extracts from triage.recommendations id+reason', () => {
      const payload = {
        triage: {
          recommendations: [{ id: 'bd-42', reason: 'High priority' }],
        },
      };
      const executor = createMockExecutor(payload);
      const service = new BvTriageService('/tmp', true, executor);
      const result = service.getGlobalTriage();
      expect(result!.summary).toContain('bd-42');
      expect(result!.summary).toContain('High priority');
    });

    it('extracts from triage.recommendations id only', () => {
      const payload = {
        triage: {
          recommendations: [{ id: 'bd-99' }],
        },
      };
      const executor = createMockExecutor(payload);
      const service = new BvTriageService('/tmp', true, executor);
      const result = service.getGlobalTriage();
      expect(result!.summary).toContain('bd-99');
    });

    it('extracts from triage.quick_ref actionable + top_picks', () => {
      const payload = {
        triage: {
          quick_ref: {
            actionable_count: 5,
            open_count: 10,
            top_picks: [{ id: 'bd-1' }],
          },
        },
      };
      const executor = createMockExecutor(payload);
      const service = new BvTriageService('/tmp', true, executor);
      const result = service.getGlobalTriage();
      expect(result!.summary).toContain('5');
      expect(result!.summary).toContain('bd-1');
    });

    it('extracts from triage.quick_ref actionable + open without picks', () => {
      const payload = {
        triage: {
          quick_ref: {
            actionable_count: 3,
            open_count: 7,
          },
        },
      };
      const executor = createMockExecutor(payload);
      const service = new BvTriageService('/tmp', true, executor);
      const result = service.getGlobalTriage();
      expect(result!.summary).toContain('3 actionable of 7 open');
    });
  });

  describe('summarizeBvPayload nested keys', () => {
    it('extracts from nested insight key', () => {
      const executor = createMockExecutor({ insight: { summary: 'Insight' } });
      const service = new BvTriageService('/tmp', true, executor);
      const result = service.getBlockerTriage('nested-insight');
      expect(result).not.toBeNull();
      expect(result!.summary).toContain('Insight');
    });

    it('extracts from blockers array in payload', () => {
      const executor = createMockExecutor({
        blockers: [
          { id: 'bd-1', title: 'First' },
          { id: 'bd-2', title: 'Second' },
          { id: 'bd-3', title: 'Third' },
          { id: 'bd-4', title: 'Fourth' }, // beyond limit of 3
        ],
      });
      const service = new BvTriageService('/tmp', true, executor);
      const details = service.getBlockerTriageDetails('blockers-test');
      expect(details!.topBlockers).toHaveLength(3);
      expect(details!.summary).toContain('bd-1: First');
      expect(details!.summary).not.toContain('bd-4');
    });
  });

  describe('cache behavior', () => {
    it('caches null results', () => {
      let callCount = 0;
      const executor: BvCommandExecutor = () => {
        callCount++;
        return JSON.stringify(null);
      };
      const service = new BvTriageService('/tmp', true, executor);
      service.getBlockerTriage('null-cache');
      service.getBlockerTriage('null-cache');
      // Only 2 calls for first request (blocker + causality)
      expect(callCount).toBe(2);
    });

    it('does not share cache between different beadIds', () => {
      let callCount = 0;
      const executor: BvCommandExecutor = () => {
        callCount++;
        return JSON.stringify({ summary: 'OK' });
      };
      const service = new BvTriageService('/tmp', true, executor);
      service.getBlockerTriage('bead-1');
      service.getBlockerTriage('bead-2');
      expect(callCount).toBe(4); // 2 per bead
    });
  });
});
