import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TransitionJournal } from './transition-journal.js';

describe('TransitionJournal stress', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-stress-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('append 100 entries with correct seq', () => {
    const journal = new TransitionJournal(tempDir);
    for (let i = 0; i < 100; i++) {
      const entry = journal.append({
        ts: Date.now(),
        feature: `feat-${i % 5}`,
        task: `task-${i}`,
        from: 'pending',
        to: 'done',
      });
      expect(entry.seq).toBe(i + 1);
    }
  });

  it('entries persist across instances', () => {
    const j1 = new TransitionJournal(tempDir);
    for (let i = 0; i < 5; i++) {
      j1.append({ ts: Date.now(), feature: 'f', task: `t${i}`, from: 'pending', to: 'done' });
    }
    const j2 = new TransitionJournal(tempDir);
    const entry = j2.append({ ts: Date.now(), feature: 'f', task: 't5', from: 'pending', to: 'done' });
    expect(entry.seq).toBe(6);
  });

  it('different features interleave correctly', () => {
    const journal = new TransitionJournal(tempDir);
    journal.append({ ts: 1, feature: 'feat-a', task: 't1', from: 'pending', to: 'in_progress' });
    journal.append({ ts: 2, feature: 'feat-b', task: 't1', from: 'pending', to: 'in_progress' });
    journal.append({ ts: 3, feature: 'feat-a', task: 't1', from: 'in_progress', to: 'done' });
    const file = path.join(tempDir, '.beads', 'transition-journal.jsonl');
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(3);
  });

  it('all transition fields preserved', () => {
    const journal = new TransitionJournal(tempDir);
    const entry = journal.append({
      ts: 1709000000000,
      feature: 'my-feature',
      task: '01-setup',
      from: 'pending',
      to: 'in_progress',
    });
    expect(entry.ts).toBe(1709000000000);
    expect(entry.feature).toBe('my-feature');
    expect(entry.task).toBe('01-setup');
    expect(entry.from).toBe('pending');
    expect(entry.to).toBe('in_progress');
  });
});
