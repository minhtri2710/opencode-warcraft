import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';
import { buildCompactionPrompt } from '../hooks/compaction-hook.js';
import { ALGALON_PROMPT } from './algalon.js';
import { BRANN_PROMPT } from './brann.js';
import { KHADGAR_PROMPT } from './khadgar.js';
import { MEKKATORQUE_PROMPT } from './mekkatorque.js';
import { MIMIRON_PROMPT } from './mimiron.js';
import { SAURFANG_PROMPT } from './saurfang.js';

// ---------------------------------------------------------------------------
// Prompt consistency tests — detect contradictions across agent layers
//
// These tests scan all prompt sources for known contradiction patterns.
// The goal is practical regression detection, not exhaustive analysis.
// ---------------------------------------------------------------------------

/** All agent prompts keyed by name for iteration. */
const AGENT_PROMPTS: Record<string, string> = {
  khadgar: KHADGAR_PROMPT,
  saurfang: SAURFANG_PROMPT,
  mekkatorque: MEKKATORQUE_PROMPT,
  brann: BRANN_PROMPT,
  mimiron: MIMIRON_PROMPT,
  algalon: ALGALON_PROMPT,
};

/** System prompt from index.ts (read as file to avoid import side-effects). */
const INDEX_PATH = path.resolve(import.meta.dir, '..', 'index.ts');
const indexSource = readFileSync(INDEX_PATH, 'utf-8');

/**
 * Extract the WARCRAFT_SYSTEM_PROMPT template literal from index.ts.
 * We look for the content between the backtick-delimited template string.
 */
function extractSystemPrompt(source: string): string {
  const marker = 'WARCRAFT_SYSTEM_PROMPT';
  const markerIdx = source.indexOf(marker);
  if (markerIdx === -1) return '';
  // Find the opening backtick after the marker
  const openBacktick = source.indexOf('`', markerIdx);
  if (openBacktick === -1) return '';
  // Find the closing backtick (template literal ends with `;
  const closeBacktick = source.indexOf('`;', openBacktick + 1);
  if (closeBacktick === -1) return '';
  return source.slice(openBacktick + 1, closeBacktick);
}

const systemPrompt = extractSystemPrompt(indexSource);

/** Compaction hook prompt. */
const compactionPrompt = buildCompactionPrompt();

/** All prompt sources combined for cross-layer checks. */
const ALL_SOURCES: Record<string, string> = {
  ...AGENT_PROMPTS,
  'system-prompt (index.ts)': systemPrompt,
  'compaction-hook': compactionPrompt,
};

describe('Prompt consistency (contradiction detection)', () => {
  // -------------------------------------------------------------------------
  // Regression: compaction-hook vs system-prompt warcraft_status contradiction
  // -------------------------------------------------------------------------
  describe('warcraft_status guidance consistency', () => {
    it('compaction hook says DO NOT call warcraft_status to rediscover state', () => {
      expect(compactionPrompt).toContain('Do NOT call warcraft_status');
    });

    it('system prompt qualifies warcraft_status usage to avoid compaction contradiction', () => {
      // The system prompt should NOT contain an unqualified "call warcraft_status periodically"
      // without mentioning the compaction exception.
      const statusSection = extractSection(systemPrompt, 'Execution Phase');
      expect(statusSection).toBeTruthy();

      // Must mention warcraft_status (it's still valid guidance)
      expect(statusSection).toContain('warcraft_status');

      // Must contain a qualifier about compaction so it doesn't contradict the hook
      expect(statusSection).toMatch(/compaction|compacted/i);
    });

    it('system prompt still recommends warcraft_status during active execution', () => {
      const statusSection = extractSection(systemPrompt, 'Execution Phase');
      expect(statusSection).toContain('warcraft_status');
      // Should still guide agents to use it for progress checks
      expect(statusSection).toMatch(/progress|pending/i);
    });
  });

  // -------------------------------------------------------------------------
  // Generic contradiction patterns: "DO NOT call X" vs "ALWAYS call X"
  // -------------------------------------------------------------------------
  describe('no direct contradictions for tool guidance', () => {
    const toolNames = [
      'warcraft_status',
      'warcraft_plan_read',
      'warcraft_plan_write',
      'warcraft_worktree_create',
      'warcraft_worktree_commit',
      'warcraft_merge',
      'warcraft_context_write',
      'warcraft_feature_create',
      'warcraft_tasks_sync',
    ];

    for (const tool of toolNames) {
      it(`no source says both "DO NOT" and "ALWAYS" for ${tool} without qualification`, () => {
        // Collect sources that contain prohibitions and mandates for this tool
        const prohibitions: string[] = [];
        const mandates: string[] = [];

        for (const [name, content] of Object.entries(ALL_SOURCES)) {
          // Check for unqualified blanket prohibitions
          const hasProhibition = new RegExp(
            `(?:DO NOT|NEVER|MUST NOT)\\s+(?:call|use|run)\\s+${escapeRegex(tool)}`,
            'i',
          ).test(content);

          // Check for unqualified blanket mandates
          const hasMandate = new RegExp(`(?:ALWAYS|MUST)\\s+(?:call|use|run)\\s+${escapeRegex(tool)}`, 'i').test(
            content,
          );

          if (hasProhibition) prohibitions.push(name);
          if (hasMandate) mandates.push(name);
        }

        // If both exist in DIFFERENT sources, that's a potential contradiction
        if (prohibitions.length > 0 && mandates.length > 0) {
          const conflictingSources = prohibitions.filter((p) => !mandates.includes(p));
          // Only flag if prohibition and mandate come from different sources
          // (same source can qualify its own rule internally)
          const crossSourceConflict = conflictingSources.length > 0 && mandates.some((m) => !prohibitions.includes(m));
          expect(crossSourceConflict).toBe(false);
        }
      });
    }
  });

  // -------------------------------------------------------------------------
  // Worker isolation: Mekkatorque must not be told to delegate
  // -------------------------------------------------------------------------
  describe('worker isolation consistency', () => {
    it('Mekkatorque says NEVER delegate', () => {
      expect(MEKKATORQUE_PROMPT).toContain('NEVER delegate');
    });

    it('no other prompt tells Mekkatorque to delegate implementation', () => {
      // The system prompt should not instruct Mekkatorque to delegate
      // (Mekkatorque is a worker — delegation is for Khadgar/Saurfang)
      expect(MEKKATORQUE_PROMPT).not.toMatch(/delegate.*to.*(?:brann|mimiron|saurfang)/i);
    });
  });

  // -------------------------------------------------------------------------
  // Tool inventory: static prompt must match runtime registration
  // -------------------------------------------------------------------------
  describe('tool inventory consistency', () => {
    /**
     * Extract the `tool: { ... }` block from index.ts and pull out all warcraft_* keys.
     * These are the tools actually registered at runtime.
     */
    function extractRuntimeTools(source: string): string[] {
      // Match the `tool: {` block — scan for `warcraft_\w+` keys (before the colon)
      const toolBlockMatch = source.match(/\btool:\s*\{([\s\S]*?)\n\s{4}\}/);
      if (!toolBlockMatch) return [];
      const block = toolBlockMatch[1];
      const tools: string[] = [];
      for (const m of block.matchAll(/\b(warcraft_\w+)\s*:/g)) {
        tools.push(m[1]);
      }
      return tools.sort();
    }

    /**
     * Extract all warcraft_* tool names mentioned in the system prompt table.
     */
    function extractPromptTools(prompt: string): string[] {
      const tools: string[] = [];
      for (const m of prompt.matchAll(/\b(warcraft_\w+)\b/g)) {
        tools.push(m[1]);
      }
      // Deduplicate (tools may appear in both table and workflow sections)
      return [...new Set(tools)].sort();
    }

    const runtimeTools = extractRuntimeTools(indexSource);
    const promptTableSection = extractSection(systemPrompt, 'Tools');
    const promptTools = extractPromptTools(promptTableSection);

    it('runtime registers exactly 20 tools', () => {
      expect(runtimeTools).toHaveLength(20);
    });

    it('static prompt documents exactly 20 tools in the table', () => {
      expect(promptTools).toHaveLength(20);
    });

    it('every runtime tool appears in the static prompt table', () => {
      const missing = runtimeTools.filter((t) => !promptTools.includes(t));
      expect(missing).toEqual([]);
    });

    it('no stale tools in prompt that are not registered at runtime', () => {
      const stale = promptTools.filter((t) => !runtimeTools.includes(t));
      expect(stale).toEqual([]);
    });

    it('static prompt header count matches actual tool count', () => {
      const headerMatch = systemPrompt.match(/###\s+Tools\s+\((\d+)\s+total\)/);
      expect(headerMatch).toBeTruthy();
      const headerCount = Number(headerMatch![1]);
      expect(headerCount).toBe(runtimeTools.length);
    });
  });

  // -------------------------------------------------------------------------
  // Plan modification: only orchestrator should modify plans
  // -------------------------------------------------------------------------
  describe('plan modification consistency', () => {
    it('Mekkatorque is told plan is READ ONLY', () => {
      expect(MEKKATORQUE_PROMPT).toContain('READ ONLY');
    });

    it('Brann does not suggest modifying plans', () => {
      expect(BRANN_PROMPT).not.toMatch(/modify.*plan|edit.*plan|write.*plan/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a section from source text starting with a heading containing `sectionName`. */
function extractSection(source: string, sectionName: string): string {
  const pattern = new RegExp(`^###?\\s+.*${escapeRegex(sectionName)}.*$`, 'im');
  const match = source.match(pattern);
  if (!match || match.index === undefined) return '';

  const start = match.index;
  // Find next heading of same or higher level
  const rest = source.slice(start + match[0].length);
  const nextHeading = rest.match(/^###?\s+/m);
  const end = nextHeading?.index !== undefined ? start + match[0].length + nextHeading.index : source.length;

  return source.slice(start, end);
}

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
