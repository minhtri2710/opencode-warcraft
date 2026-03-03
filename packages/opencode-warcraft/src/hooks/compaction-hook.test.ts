import { describe, expect, it } from 'bun:test';
import { buildCompactionPrompt } from './compaction-hook.js';

describe('Compaction hook', () => {
  it('contains resume directives', () => {
    const prompt = buildCompactionPrompt();
    expect(prompt).toContain('Session Resume');
    expect(prompt).toContain('resume efficiently');
    expect(prompt).toContain('Continue from where you left off');
  });

  it('prevents rediscovery', () => {
    const prompt = buildCompactionPrompt();
    expect(prompt).toContain('Do NOT call warcraft_status');
    expect(prompt).toContain('Do NOT re-read plan.md');
  });

  it('is deterministic', () => {
    const a = buildCompactionPrompt();
    const b = buildCompactionPrompt();
    expect(a).toBe(b);
  });

  it('is under 200 words', () => {
    const prompt = buildCompactionPrompt();
    const wordCount = prompt.split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeLessThan(200);
  });
});
