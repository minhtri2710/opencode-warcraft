import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { JournalEntry } from './transition-journal.js';
import { TransitionJournal } from './transition-journal.js';

describe('TransitionJournal', () => {
  let tempDir: string;
  let journal: TransitionJournal;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'journal-test-'));
    journal = new TransitionJournal(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates journal file on first append', () => {
    journal.append({
      beadId: 'bead-1',
      from: 'pending',
      to: 'in_progress',
      timestamp: '2024-01-01T00:00:00Z',
    });

    expect(existsSync(journal.getPath())).toBe(true);
  });

  it('assigns monotonic sequence numbers', () => {
    const e1 = journal.append({
      beadId: 'bead-1',
      from: 'pending',
      to: 'in_progress',
      timestamp: '2024-01-01T00:00:00Z',
    });
    const e2 = journal.append({
      beadId: 'bead-1',
      from: 'in_progress',
      to: 'done',
      timestamp: '2024-01-01T00:01:00Z',
    });

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
  });

  it('persists entries as JSONL', () => {
    journal.append({
      beadId: 'bead-1',
      from: 'pending',
      to: 'in_progress',
      timestamp: '2024-01-01T00:00:00Z',
      summary: 'Starting work',
    });

    const content = readFileSync(journal.getPath(), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as JournalEntry;
    expect(parsed.seq).toBe(1);
    expect(parsed.beadId).toBe('bead-1');
    expect(parsed.from).toBe('pending');
    expect(parsed.to).toBe('in_progress');
    expect(parsed.summary).toBe('Starting work');
  });

  it('reads all entries back', () => {
    journal.append({ beadId: 'a', from: 'p', to: 'ip', timestamp: 't1' });
    journal.append({ beadId: 'b', from: 'ip', to: 'd', timestamp: 't2' });

    const entries = journal.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[0].beadId).toBe('a');
    expect(entries[1].beadId).toBe('b');
  });

  it('returns empty array when journal does not exist', () => {
    const freshJournal = new TransitionJournal(join(tempDir, 'nonexistent'));
    expect(freshJournal.readAll()).toEqual([]);
  });

  it('skips corrupt lines during readAll', () => {
    journal.append({ beadId: 'a', from: 'p', to: 'ip', timestamp: 't1' });

    appendFileSync(journal.getPath(), 'not-json\n');

    journal.append({ beadId: 'b', from: 'ip', to: 'd', timestamp: 't2' });

    const entries = journal.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[0].beadId).toBe('a');
    expect(entries[1].beadId).toBe('b');
  });

  it('resumes sequence from persisted state', () => {
    journal.append({ beadId: 'a', from: 'p', to: 'ip', timestamp: 't1' });
    journal.append({ beadId: 'b', from: 'ip', to: 'd', timestamp: 't2' });

    // Create a new journal instance that reads from the same file
    const journal2 = new TransitionJournal(tempDir);
    const e3 = journal2.append({ beadId: 'c', from: 'p', to: 'ip', timestamp: 't3' });
    expect(e3.seq).toBe(3);
  });

  it('markCommentWritten appends an ack entry', () => {
    const e1 = journal.append({ beadId: 'a', from: 'p', to: 'ip', timestamp: 't1' });
    journal.markCommentWritten(e1.seq);

    const entries = journal.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[1].beadCommentWritten).toBe(true);
    expect(entries[1].summary).toContain(`seq=${e1.seq}`);
  });

  it('stores optional fields', () => {
    journal.append({
      beadId: 'a',
      from: 'p',
      to: 'ip',
      timestamp: 't1',
      featureName: 'my-feature',
      folder: '01-setup',
      summary: 'init',
    });

    const entries = journal.readAll();
    expect(entries[0].featureName).toBe('my-feature');
    expect(entries[0].folder).toBe('01-setup');
  });
});
