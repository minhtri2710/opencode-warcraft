import { beforeEach, describe, expect, test } from 'bun:test';
import { BvTriageService } from './BvTriageService.js';
import type { BvCommandExecutor } from './bv-runner.js';

/**
 * BV Triage Service Tests
 *
 * Characterization tests for the BV triage logic that ensure:
 * - Cache miss executes `bv` and stores summary
 * - Cache hit returns cached summary
 * - Command failure updates last-error health state
 * - Summary extraction handles nested payload keys
 */

describe('BvTriageService', () => {
  const TEST_DIRECTORY = '/tmp/test-project';
  let mockExecutor: BvCommandExecutor;
  let callLog: Array<{
    command: string;
    args: string[];
    options: { cwd: string; encoding: 'utf-8'; timeout?: number };
  }>;

  beforeEach(() => {
    callLog = [];
    mockExecutor = (
      command: string,
      args: string[],
      options: { cwd: string; encoding: 'utf-8'; timeout?: number },
    ): string => {
      callLog.push({ command, args, options });
      // Return empty object by default (tests can override)
      return '{}';
    };
  });

  describe('getHealth()', () => {
    test('returns enabled=false when service is disabled', () => {
      const disabledService = new BvTriageService(TEST_DIRECTORY, false, mockExecutor);
      const health = disabledService.getHealth();

      expect(health.enabled).toBe(false);
      expect(health.available).toBe(false);
      expect(health.lastError).toBeNull();
      expect(health.lastErrorAt).toBeNull();
      expect(health.lastSuccessAt).toBeNull();
    });

    test('returns enabled=true and available=true on fresh enabled service', () => {
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);
      const health = service.getHealth();

      expect(health.enabled).toBe(true);
      expect(health.available).toBe(true);
      expect(health.lastError).toBeNull();
      expect(health.lastErrorAt).toBeNull();
      expect(health.lastSuccessAt).toBeNull();
    });

    test('tracks lastError after command failure', () => {
      const failingExecutor: BvCommandExecutor = () => {
        throw new Error('Command not found: bv');
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, failingExecutor);

      // Trigger a command
      service.getBlockerTriage('bead-123');

      const health = service.getHealth();
      expect(health.available).toBe(false);
      expect(health.lastError).toBe('Command not found: bv');
      expect(health.lastErrorAt).not.toBeNull();
      expect(health.lastSuccessAt).toBeNull();
    });

    test('tracks lastSuccessAt after successful command', () => {
      mockExecutor = (): string => JSON.stringify({ summary: 'Test triage summary' });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      service.getGlobalTriage();

      const health = service.getHealth();
      expect(health.available).toBe(true);
      expect(health.lastError).toBeNull();
      expect(health.lastErrorAt).toBeNull();
      expect(health.lastSuccessAt).not.toBeNull();
    });

    test('clears lastError after successful command', () => {
      let shouldFail = true;
      const toggleExecutor: BvCommandExecutor = (): string => {
        if (shouldFail) {
          throw new Error('Initial error');
        }
        return JSON.stringify({ summary: 'Success' });
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, toggleExecutor);

      service.getGlobalTriage(); // Fail
      shouldFail = false;
      service.getGlobalTriage(); // Succeed

      const health = service.getHealth();
      expect(health.available).toBe(true);
      expect(health.lastError).toBeNull();
      expect(health.lastSuccessAt).not.toBeNull();
    });
  });

  describe('getBlockerTriage(beadId)', () => {
    test('returns null when bv command fails', () => {
      const failingExecutor: BvCommandExecutor = () => {
        throw new Error('bv not installed');
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, failingExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toBeNull();
    });

    test('returns null when bv returns empty payload', () => {
      mockExecutor = (): string => '{}';
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toBeNull();
    });

    test('extracts summary from direct summary field', () => {
      mockExecutor = (): string => JSON.stringify({ summary: 'Direct summary text' });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toEqual({ summary: 'Direct summary text' });
    });

    test('extracts summary from message field', () => {
      mockExecutor = (): string => JSON.stringify({ summary: 'Message summary text' });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toEqual({ summary: 'Message summary text' });
    });

    test('extracts summary from reason field', () => {
      mockExecutor = (): string => JSON.stringify({ summary: 'Reason summary text' });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toEqual({ summary: 'Reason summary text' });
    });

    test('extracts summary from nested top field', () => {
      let callCount = 0;
      mockExecutor = (): string => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ top: { summary: 'Top nested summary' } });
        }
        return '{}';
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toEqual({ summary: 'Top nested summary' });
    });

    test('extracts summary from nested primary field', () => {
      let callCount = 0;
      mockExecutor = (): string => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ primary: { summary: 'Primary nested message' } });
        }
        return '{}';
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toEqual({ summary: 'Primary nested message' });
    });

    test('extracts summary from nested recommendation field', () => {
      let callCount = 0;
      mockExecutor = (): string => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ recommendation: { summary: 'Recommendation reason' } });
        }
        return '{}';
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toEqual({ summary: 'Recommendation reason' });
    });

    test('extracts blockers array into summary', () => {
      mockExecutor = (): string =>
        JSON.stringify({
          blockers: [
            { id: 'BLK-1', title: 'First blocker' },
            { id: 'BLK-2', title: 'Second blocker' },
            { id: 'BLK-3', title: 'Third blocker' },
          ],
        });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toEqual({
        summary: 'Top blockers: BLK-1: First blocker; BLK-2: Second blocker; BLK-3: Third blocker',
      });
    });

    test('returns structured blocker triage details', () => {
      let callCount = 0;
      mockExecutor = (): string => {
        callCount += 1;
        if (callCount === 1) {
          return JSON.stringify({
            summary: 'Blocker summary',
            blockers: [
              { id: 'BLK-1', title: 'First blocker' },
              { id: 'BLK-2', title: 'Second blocker' },
            ],
          });
        }
        return JSON.stringify({ summary: 'Causality summary' });
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const details = service.getBlockerTriageDetails('bead-structured');

      expect(details).not.toBeNull();
      expect(details?.summary).toBe('Blocker summary | Causality summary');
      expect(details?.topBlockers).toEqual(['BLK-1: First blocker', 'BLK-2: Second blocker']);
      expect(details?.blockerChain).toEqual({
        summary: 'Blocker summary',
        blockers: [
          { id: 'BLK-1', title: 'First blocker' },
          { id: 'BLK-2', title: 'Second blocker' },
        ],
      });
      expect(details?.causality).toEqual({ summary: 'Causality summary' });
    });

    test('caches result for same beadId (cache hit)', () => {
      let callCount = 0;
      mockExecutor = (): string => {
        callCount++;
        return JSON.stringify({ summary: 'Cached summary' });
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      // First call - should execute bv (2 calls: blocker-chain + causality)
      const result1 = service.getBlockerTriage('bead-123');
      expect(result1).toEqual({ summary: 'Cached summary' });
      expect(callCount).toBe(2);

      // Second call - should use cache
      const result2 = service.getBlockerTriage('bead-123');
      expect(result2).toEqual({ summary: 'Cached summary' });
      // Should not have called bv again (still 2 calls)
      expect(callCount).toBe(2);
    });

    test('different beadIds have separate cache entries', () => {
      // First two calls (bead-1): --robot-blocker-chain, --robot-causality
      // Next two calls (bead-2): --robot-blocker-chain, --robot-causality
      mockExecutor = (_command, args): string => {
        if (args.includes('bead-1')) {
          if (args.includes('--robot-blocker-chain')) {
            return JSON.stringify({ summary: 'Summary for bead-1' });
          }
          return JSON.stringify({ summary: 'Causality for bead-1' });
        }
        // bead-2
        if (args.includes('--robot-blocker-chain')) {
          return JSON.stringify({ summary: 'Summary for bead-2' });
        }
        return JSON.stringify({ summary: 'Causality for bead-2' });
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result1 = service.getBlockerTriage('bead-1');
      const result2 = service.getBlockerTriage('bead-2');

      expect(result1).toEqual({ summary: 'Summary for bead-1 | Causality for bead-1' });
      expect(result2).toEqual({ summary: 'Summary for bead-2 | Causality for bead-2' });
    });

    test('combines blocker-chain and causality summaries', () => {
      let callCount = 0;
      mockExecutor = (): string => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ summary: 'Blocker chain info' });
        }
        return JSON.stringify({ summary: 'Causality info' });
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toEqual({ summary: 'Blocker chain info | Causality info' });
    });

    test('deduplicates identical summaries from blocker and causality', () => {
      mockExecutor = (): string => JSON.stringify({ summary: 'Same info' });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toEqual({ summary: 'Same info' });
    });

    test('limits to 2 unique summary parts', () => {
      let callCount = 0;
      mockExecutor = (): string => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({ summary: 'First part' });
        }
        return JSON.stringify({ summary: 'Second part' });
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toEqual({ summary: 'First part | Second part' });
    });

    test('returns null when no summary extracted', () => {
      mockExecutor = (): string => JSON.stringify({ unrelated: 'data' });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getBlockerTriage('bead-123');

      expect(result).toBeNull();
    });
  });

  describe('getGlobalTriage()', () => {
    test('returns null when bv command fails', () => {
      const failingExecutor: BvCommandExecutor = () => {
        throw new Error('bv not installed');
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, failingExecutor);

      const result = service.getGlobalTriage();

      expect(result).toBeNull();
    });

    test('returns null when bv returns empty payload', () => {
      mockExecutor = (): string => '{}';
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getGlobalTriage();

      expect(result).toBeNull();
    });

    test('extracts summary from direct fields', () => {
      mockExecutor = (): string => JSON.stringify({ summary: 'Global triage summary' });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getGlobalTriage();

      expect(result).toEqual({ summary: 'Global triage summary' });
    });

    test('extracts summary from nested fields', () => {
      mockExecutor = (): string => JSON.stringify({ primary: { summary: 'Primary global issue' } });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getGlobalTriage();

      expect(result).toEqual({ summary: 'Primary global issue' });
    });

    test('extracts summary from robot-triage quick_ref envelope', () => {
      mockExecutor = (): string =>
        JSON.stringify({
          triage: {
            quick_ref: {
              actionable_count: 14,
              open_count: 22,
              top_picks: [{ id: 'bd-1' }],
            },
          },
        });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getGlobalTriage();

      expect(result).toEqual({ summary: '14 actionable issues. Top pick: bd-1' });
    });

    test('includes robot metadata fields in structured global triage details', () => {
      mockExecutor = (): string =>
        JSON.stringify({
          summary: 'Global triage summary',
          data_hash: '553adcf4b95003cb',
          analysis_config: { phase_2_timeout_ms: 500 },
          status: { pageRank: { state: 'computed' } },
          as_of: 'HEAD~5',
          as_of_commit: 'abc123def',
        });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getGlobalTriageDetails();

      expect(result).toEqual({
        summary: 'Global triage summary',
        payload: {
          summary: 'Global triage summary',
          data_hash: '553adcf4b95003cb',
          analysis_config: { phase_2_timeout_ms: 500 },
          status: { pageRank: { state: 'computed' } },
          as_of: 'HEAD~5',
          as_of_commit: 'abc123def',
        },
        dataHash: '553adcf4b95003cb',
        analysisConfig: { phase_2_timeout_ms: 500 },
        metricStatus: { pageRank: { state: 'computed' } },
        asOf: 'HEAD~5',
        asOfCommit: 'abc123def',
      });
    });

    test('returns structured global triage details', () => {
      mockExecutor = (): string =>
        JSON.stringify({
          summary: 'Global triage summary',
          blockers: [{ id: 'BLK-1', title: 'First blocker' }],
        });
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      const result = service.getGlobalTriageDetails();

      expect(result).toEqual({
        summary: 'Global triage summary',
        payload: {
          summary: 'Global triage summary',
          blockers: [{ id: 'BLK-1', title: 'First blocker' }],
        },
      });
    });
  });

  describe('bv CLI flags', () => {
    test('calls bv with --robot-blocker-chain flag', () => {
      const localCallLog: Array<{
        command: string;
        args: string[];
        options: { cwd: string; encoding: 'utf-8'; timeout?: number };
      }> = [];
      mockExecutor = (command, args, options): string => {
        localCallLog.push({ command, args, options });
        return '{}';
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      service.getBlockerTriage('bead-123');

      // Check first call should be blocker-chain
      expect(localCallLog[0].command).toBe('bv');
      expect(localCallLog[0].args).toEqual(['--robot-blocker-chain', 'bead-123', '--format', 'json']);
      expect(localCallLog[0].options.cwd).toBe(TEST_DIRECTORY);
      expect(localCallLog[0].options.encoding).toBe('utf-8');
    });

    test('calls bv with --robot-causality flag', () => {
      const localCallLog: Array<{
        command: string;
        args: string[];
        options: { cwd: string; encoding: 'utf-8'; timeout?: number };
      }> = [];
      mockExecutor = (command, args, options): string => {
        localCallLog.push({ command, args, options });
        return '{}';
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      service.getBlockerTriage('bead-123');

      // Second call should be causality
      expect(localCallLog[1].command).toBe('bv');
      expect(localCallLog[1].args).toEqual(['--robot-causality', 'bead-123', '--format', 'json']);
      expect(localCallLog[1].options.cwd).toBe(TEST_DIRECTORY);
      expect(localCallLog[1].options.encoding).toBe('utf-8');
    });

    test('calls bv with --robot-triage flag for global triage', () => {
      const localCallLog: Array<{
        command: string;
        args: string[];
        options: { cwd: string; encoding: 'utf-8'; timeout?: number };
      }> = [];
      mockExecutor = (command, args, options): string => {
        localCallLog.push({ command, args, options });
        return '{}';
      };
      const service = new BvTriageService(TEST_DIRECTORY, true, mockExecutor);

      service.getGlobalTriage();

      expect(localCallLog[0].command).toBe('bv');
      expect(localCallLog[0].args).toEqual(['--robot-triage', '--format', 'json']);
      expect(localCallLog[0].options.cwd).toBe(TEST_DIRECTORY);
      expect(localCallLog[0].options.encoding).toBe('utf-8');
    });
  });
});
