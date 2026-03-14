import { describe, expect, it } from 'bun:test';
import { BeadsViewerGateway } from './BeadsViewerGateway.js';
import type { BvCommandExecutor } from './bv-runner.js';

function createMockExecutor(result: unknown): BvCommandExecutor {
  return () => JSON.stringify(result);
}

describe('BeadsViewerGateway extra', () => {
  it('deduplicates tasks from both legacy and current schemas', () => {
    const planData = {
      plan: {
        tracks: [{ track_id: '1', tasks: ['bd-1', 'bd-2'], items: [{ id: 'bd-2' }, { id: 'bd-3' }] }],
      },
    };
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor(planData));
    const result = gw.getRobotPlan();
    expect(result!.tracks[0].tasks).toEqual(['bd-1', 'bd-2', 'bd-3']);
  });

  it('extracts unblocks from both track and item level', () => {
    const planData = {
      plan: {
        tracks: [
          { track_id: '1', tasks: ['bd-1'], unblocks: ['bd-5'], items: [{ id: 'bd-1', unblocks: ['bd-6'] }] },
        ],
      },
    };
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor(planData));
    const result = gw.getRobotPlan();
    expect(result!.tracks[0].unblocks).toEqual(['bd-5', 'bd-6']);
  });

  it('uses reason as name fallback for tracks', () => {
    const planData = {
      plan: { tracks: [{ track_id: '1', reason: 'Critical', tasks: ['bd-1'] }] },
    };
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor(planData));
    const result = gw.getRobotPlan();
    expect(result!.tracks[0].name).toBe('Critical');
  });

  it('parses cycles with bead_ids key', () => {
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor({ cycles: [{ bead_ids: ['bd-1'] }] }));
    expect(gw.getRobotInsights()!.cycles[0].beadIds).toEqual(['bd-1']);
  });

  it('parses cycles with nodes key', () => {
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor({ cycles: [{ nodes: ['bd-1', 'bd-2'] }] }));
    expect(gw.getRobotInsights()!.cycles[0].beadIds).toEqual(['bd-1', 'bd-2']);
  });

  it('parses cycles with ids key', () => {
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor({ cycles: [{ ids: ['bd-1'] }] }));
    expect(gw.getRobotInsights()!.cycles[0].beadIds).toEqual(['bd-1']);
  });

  it('health tracks lastSuccessAt after successful plan', () => {
    const planData = { plan: { tracks: [{ track_id: '1', tasks: ['bd-1'] }] } };
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor(planData));
    gw.getRobotPlan();
    expect(gw.getHealth().lastSuccessAt).not.toBeNull();
    expect(gw.getHealth().lastError).toBeNull();
  });

  it('health tracks lastSuccessAt after successful insights', () => {
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor({ cycles: [] }));
    gw.getRobotInsights();
    expect(gw.getHealth().lastSuccessAt).not.toBeNull();
  });

  it('skips tracks with empty track_id', () => {
    const planData = {
      plan: { tracks: [{ track_id: '', tasks: ['bd-1'] }, { track_id: '2', tasks: ['bd-2'] }] },
    };
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor(planData));
    const result = gw.getRobotPlan();
    expect(result!.tracks).toHaveLength(1);
    expect(result!.tracks[0].trackId).toBe('2');
  });

  it('returns null for invalid plan structure (no plan key)', () => {
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor({ notPlan: true }));
    expect(gw.getRobotPlan()).toBeNull();
  });

  it('returns null for plan with non-array tracks', () => {
    const gw = new BeadsViewerGateway('/tmp', true, createMockExecutor({ plan: { tracks: 'not array' } }));
    expect(gw.getRobotPlan()).toBeNull();
  });
});
