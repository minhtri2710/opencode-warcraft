/**
 * Local file-based transition journal for crash recovery.
 *
 * Persists task state transitions as append-only JSONL entries.
 * Supplements the bead-comment audit trail with a local
 * fast-write journal that survives bead flush failures.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

export interface JournalEntry {
  /** Monotonic sequence number within this journal */
  seq: number;
  /** Task bead ID */
  beadId: string;
  /** Previous status */
  from: string;
  /** New status */
  to: string;
  /** ISO timestamp */
  timestamp: string;
  /** Feature name for context */
  featureName?: string;
  /** Task folder for context */
  folder?: string;
  /** Optional summary */
  summary?: string;
  /** Whether the bead comment was successfully written */
  beadCommentWritten?: boolean;
}

export class TransitionJournal {
  private seq = 0;
  private readonly journalPath: string;

  constructor(projectRoot: string) {
    this.journalPath = join(projectRoot, '.beads', 'transition-journal.jsonl');
    this.seq = this.readLastSeq();
  }

  /** Append a transition entry to the journal */
  append(entry: Omit<JournalEntry, 'seq'>): JournalEntry {
    this.seq++;
    const full: JournalEntry = { seq: this.seq, ...entry };

    try {
      const dir = dirname(this.journalPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      appendFileSync(this.journalPath, JSON.stringify(full) + '\n');
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[warcraft] Failed to write transition journal entry: ${reason}`);
    }

    return full;
  }

  /** Mark a journal entry as having its bead comment written */
  markCommentWritten(seq: number): void {
    this.append({
      beadId: '',
      from: '',
      to: '',
      timestamp: new Date().toISOString(),
      summary: `[ack] seq=${seq} bead_comment_written`,
      beadCommentWritten: true,
    });
  }

  /** Read all entries (for reconciliation) */
  readAll(): JournalEntry[] {
    if (!existsSync(this.journalPath)) return [];

    try {
      const content = readFileSync(this.journalPath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line) as JournalEntry;
          } catch {
            // Skip corrupt lines
            return null;
          }
        })
        .filter((entry): entry is JournalEntry => entry !== null);
    } catch {
      // Journal file unreadable; return empty to avoid blocking operations
      return [];
    }
  }

  /** Read the last sequence number from the journal */
  private readLastSeq(): number {
    const entries = this.readAll();
    if (entries.length === 0) return 0;
    return Math.max(...entries.map((e) => e.seq));
  }

  /** Get the journal file path (for testing/debugging) */
  getPath(): string {
    return this.journalPath;
  }
}
