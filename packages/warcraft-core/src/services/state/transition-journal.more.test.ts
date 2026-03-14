import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TransitionJournal } from './transition-journal.js';

describe('TransitionJournal more edge cases', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'journal-more-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('multiple markCommentWritten calls produce sequential entries', () => {
    const journal = new TransitionJournal(tempDir);
    journal.append({ beadId: 'a', from: 'p', to: 'ip', timestamp: 't1' });
    journal.markCommentWritten(1);
    journal.markCommentWritten(1); // duplicate ack

    const entries = journal.readAll();
    expect(entries).toHaveLength(3);
    expect(entries[1].seq).toBe(2);
    expect(entries[2].seq).toBe(3);
  });

  it('append with all optional fields', () => {
    const journal = new TransitionJournal(tempDir);
    const entry = journal.append({
      beadId: 'bd-99',
      from: 'blocked',
      to: 'in_progress',
      timestamp: '2026-06-01T12:00:00Z',
      featureName: 'big-feature',
      folder: '05-complex-task',
      summary: 'Unblocked after dependency resolved',
      beadCommentWritten: false,
    });

    expect(entry.seq).toBe(1);
    expect(entry.beadId).toBe('bd-99');
    expect(entry.featureName).toBe('big-feature');
    expect(entry.beadCommentWritten).toBe(false);

    const read = journal.readAll();
    expect(read[0]).toEqual(entry);
  });

  it('sequential appends have strictly increasing seq', () => {
    const journal = new TransitionJournal(tempDir);
    const seqs: number[] = [];
    for (let i = 0; i < 10; i++) {
      const entry = journal.append({ beadId: `b-${i}`, from: 'p', to: 'ip', timestamp: `t${i}` });
      seqs.push(entry.seq);
    }
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });
});
