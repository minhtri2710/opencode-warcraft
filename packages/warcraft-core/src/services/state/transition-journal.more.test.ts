import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TransitionJournal } from './transition-journal.js';

describe('transition-journal comprehensive', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-comp-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends entry with auto-incrementing seq', () => {
    const journal = new TransitionJournal(tempDir);
    const e1 = journal.append({ ts: Date.now(), feature: 'f', task: 't', from: 'pending', to: 'in_progress' });
    const e2 = journal.append({ ts: Date.now(), feature: 'f', task: 't', from: 'in_progress', to: 'done' });
    expect(e2.seq).toBe(e1.seq + 1);
  });

  it('creates journal file on first append', () => {
    const journal = new TransitionJournal(tempDir);
    journal.append({ ts: Date.now(), feature: 'f', task: 't', from: 'pending', to: 'done' });
    const journalFile = path.join(tempDir, '.beads', 'transition-journal.jsonl');
    expect(fs.existsSync(journalFile)).toBe(true);
  });

  it('journal file contains JSONL entries', () => {
    const journal = new TransitionJournal(tempDir);
    journal.append({ ts: Date.now(), feature: 'f', task: 't', from: 'pending', to: 'done' });
    journal.append({ ts: Date.now(), feature: 'f', task: 't2', from: 'pending', to: 'done' });
    const journalFile = path.join(tempDir, '.beads', 'transition-journal.jsonl');
    const lines = fs.readFileSync(journalFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.seq).toBeDefined();
    expect(parsed.from).toBe('pending');
  });

  it('new journal instance continues seq from file', () => {
    const j1 = new TransitionJournal(tempDir);
    j1.append({ ts: Date.now(), feature: 'f', task: 't', from: 'pending', to: 'done' });
    const j2 = new TransitionJournal(tempDir);
    const e = j2.append({ ts: Date.now(), feature: 'f', task: 't2', from: 'pending', to: 'done' });
    expect(e.seq).toBeGreaterThan(1);
  });

  it('append returns full entry with seq', () => {
    const journal = new TransitionJournal(tempDir);
    const entry = journal.append({ ts: 1234567890, feature: 'my-feat', task: 'task-1', from: 'pending', to: 'in_progress' });
    expect(entry.seq).toBeDefined();
    expect(entry.ts).toBe(1234567890);
    expect(entry.feature).toBe('my-feat');
    expect(entry.task).toBe('task-1');
    expect(entry.from).toBe('pending');
    expect(entry.to).toBe('in_progress');
  });

  it('seq starts at 1 for empty journal', () => {
    const journal = new TransitionJournal(tempDir);
    const entry = journal.append({ ts: Date.now(), feature: 'f', task: 't', from: 'pending', to: 'done' });
    expect(entry.seq).toBe(1);
  });
});
