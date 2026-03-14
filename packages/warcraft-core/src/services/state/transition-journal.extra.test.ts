import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TransitionJournal } from './transition-journal.js';

describe('TransitionJournal extra edge cases', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'journal-extra-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('handles empty journal file', () => {
    const journal = new TransitionJournal(tempDir);
    // Ensure .beads dir exists and create empty file
    const { mkdirSync } = require('fs');
    const { dirname } = require('path');
    mkdirSync(dirname(journal.getPath()), { recursive: true });
    writeFileSync(journal.getPath(), '');
    const freshJournal = new TransitionJournal(tempDir);
    expect(freshJournal.readAll()).toEqual([]);
  });

  it('handles journal with only blank lines', () => {
    const journal = new TransitionJournal(tempDir);
    journal.append({ beadId: 'a', from: 'p', to: 'ip', timestamp: 't' });
    // Append blank lines
    writeFileSync(journal.getPath(), '\n\n\n');
    const freshJournal = new TransitionJournal(tempDir);
    expect(freshJournal.readAll()).toEqual([]);
  });

  it('resumes sequence correctly after corrupt entries', () => {
    const journal = new TransitionJournal(tempDir);
    journal.append({ beadId: 'a', from: 'p', to: 'ip', timestamp: 't1' });
    journal.append({ beadId: 'b', from: 'ip', to: 'd', timestamp: 't2' });

    // Add corrupt entry manually
    writeFileSync(journal.getPath(), '{"seq":2}\nnot-json\n', { flag: 'a' });

    // New journal should resume from seq 2
    const newJournal = new TransitionJournal(tempDir);
    const e = newJournal.append({ beadId: 'c', from: 'p', to: 'ip', timestamp: 't3' });
    expect(e.seq).toBe(3);
  });

  it('getPath returns correct JSONL path', () => {
    const journal = new TransitionJournal(tempDir);
    expect(journal.getPath()).toContain('.beads');
    expect(journal.getPath()).toContain('transition-journal.jsonl');
  });

  it('markCommentWritten creates a self-referential ack', () => {
    const journal = new TransitionJournal(tempDir);
    journal.markCommentWritten(42);
    const entries = journal.readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toContain('seq=42');
    expect(entries[0].beadCommentWritten).toBe(true);
    expect(entries[0].beadId).toBe('');
  });

  it('handles high sequence numbers', () => {
    const journal = new TransitionJournal(tempDir);
    // Seed with a high seq by first creating the journal dir
    const { mkdirSync } = require('fs');
    const { dirname } = require('path');
    mkdirSync(dirname(journal.getPath()), { recursive: true });
    writeFileSync(journal.getPath(), `{"seq":999,"beadId":"a","from":"p","to":"ip","timestamp":"t"}\n`);
    const freshJournal = new TransitionJournal(tempDir);
    const e = freshJournal.append({ beadId: 'b', from: 'p', to: 'ip', timestamp: 't' });
    expect(e.seq).toBe(1000);
  });

  it('preserves all fields in round-trip', () => {
    const journal = new TransitionJournal(tempDir);
    journal.append({
      beadId: 'bd-42',
      from: 'pending',
      to: 'in_progress',
      timestamp: '2026-01-01T00:00:00Z',
      featureName: 'my-feature',
      folder: '01-setup',
      summary: 'Starting task',
    });

    const entries = journal.readAll();
    expect(entries[0].beadId).toBe('bd-42');
    expect(entries[0].from).toBe('pending');
    expect(entries[0].to).toBe('in_progress');
    expect(entries[0].timestamp).toBe('2026-01-01T00:00:00Z');
    expect(entries[0].featureName).toBe('my-feature');
    expect(entries[0].folder).toBe('01-setup');
    expect(entries[0].summary).toBe('Starting task');
  });
});
