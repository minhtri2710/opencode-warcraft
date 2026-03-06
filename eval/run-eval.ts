#!/usr/bin/env bun
/**
 * Minimal eval harness for Warcraft agent scenarios.
 *
 * Each scenario is a markdown file in eval/scenarios/ with front-matter
 * describing the expected workflow and assertions. The harness:
 *
 * 1. Discovers scenario files
 * 2. Parses front-matter metadata (title, tags, expected tools, expected outcome)
 * 3. Validates scenario structure
 * 4. Reports pass/fail for structural validity
 *
 * This is a *structural* harness — it does NOT execute agents. It ensures
 * scenario definitions are well-formed so that future integration with an
 * actual agent runner is straightforward.
 *
 * Usage:
 *   bun eval/run-eval.ts                    # run all scenarios
 *   bun eval/run-eval.ts --scenario simple  # run matching scenario
 *   bun eval/run-eval.ts --validate         # validate only (no execution)
 */

import { readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScenarioMeta {
  title: string;
  tags: string[];
  expectedTools: string[];
  expectedOutcome: 'completed' | 'blocked' | 'failed';
}

interface Scenario {
  file: string;
  meta: ScenarioMeta;
  body: string;
  valid: boolean;
  errors: string[];
}

interface EvalResult {
  scenario: string;
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Front-matter parser
// ---------------------------------------------------------------------------

const FRONT_MATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

function parseFrontMatter(content: string): { meta: Record<string, string>; body: string } | null {
  const match = content.match(FRONT_MATTER_RE);
  if (!match) return null;

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      meta[key] = value;
    }
  }

  return { meta, body: match[2] };
}

// ---------------------------------------------------------------------------
// Scenario validation
// ---------------------------------------------------------------------------

const REQUIRED_META_KEYS = ['title', 'tags', 'expectedTools', 'expectedOutcome'];
const VALID_OUTCOMES = new Set(['completed', 'blocked', 'failed']);
const REQUIRED_SECTIONS = ['## Setup', '## Steps', '## Assertions'];

function validateScenario(filePath: string): Scenario {
  const content = readFileSync(filePath, 'utf-8');
  const errors: string[] = [];

  const parsed = parseFrontMatter(content);
  if (!parsed) {
    return {
      file: basename(filePath),
      meta: { title: '', tags: [], expectedTools: [], expectedOutcome: 'completed' },
      body: content,
      valid: false,
      errors: ['Missing or malformed front-matter (expected --- delimiters)'],
    };
  }

  const { meta: rawMeta, body } = parsed;

  // Validate required metadata keys
  for (const key of REQUIRED_META_KEYS) {
    if (!rawMeta[key]) {
      errors.push(`Missing required front-matter key: ${key}`);
    }
  }

  // Validate outcome
  if (rawMeta.expectedOutcome && !VALID_OUTCOMES.has(rawMeta.expectedOutcome)) {
    errors.push(
      `Invalid expectedOutcome: "${rawMeta.expectedOutcome}" (must be one of: ${[...VALID_OUTCOMES].join(', ')})`,
    );
  }

  // Validate required sections
  for (const section of REQUIRED_SECTIONS) {
    if (!body.includes(section)) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  // Validate body is non-empty
  if (body.trim().length < 50) {
    errors.push('Scenario body is too short (minimum 50 characters)');
  }

  const meta: ScenarioMeta = {
    title: rawMeta.title || '',
    tags: rawMeta.tags ? rawMeta.tags.split(',').map((t: string) => t.trim()) : [],
    expectedTools: rawMeta.expectedTools ? rawMeta.expectedTools.split(',').map((t: string) => t.trim()) : [],
    expectedOutcome: (rawMeta.expectedOutcome as ScenarioMeta['expectedOutcome']) || 'completed',
  };

  return {
    file: basename(filePath),
    meta,
    body,
    valid: errors.length === 0,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function discoverScenarios(scenarioDir: string, filter?: string): string[] {
  const files = readdirSync(scenarioDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(scenarioDir, f));

  if (filter) {
    return files.filter((f) => basename(f).includes(filter));
  }

  return files;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function runEval(scenarioDir: string, filter?: string): EvalResult[] {
  const files = discoverScenarios(scenarioDir, filter);

  if (files.length === 0) {
    console.error(`No scenario files found in ${scenarioDir}`);
    process.exit(1);
  }

  const results: EvalResult[] = [];

  for (const file of files) {
    const scenario = validateScenario(file);
    results.push({
      scenario: scenario.file,
      valid: scenario.valid,
      errors: scenario.errors,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const scenarioDir = join(import.meta.dir, 'scenarios');

  let filter: string | undefined;
  let validateOnly = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--scenario' && args[i + 1]) {
      filter = args[i + 1];
      i++;
    } else if (args[i] === '--validate') {
      validateOnly = true;
    }
  }

  console.log('Warcraft Eval Harness');
  console.log('====================\n');

  if (validateOnly) {
    console.log('Mode: validate-only\n');
  }

  const results = runEval(scenarioDir, filter);

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    if (result.valid) {
      console.log(`  PASS  ${result.scenario}`);
      passed++;
    } else {
      console.log(`  FAIL  ${result.scenario}`);
      for (const err of result.errors) {
        console.log(`        - ${err}`);
      }
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

export { parseFrontMatter, validateScenario, discoverScenarios, runEval };
export type { Scenario, ScenarioMeta, EvalResult };

// Run if executed directly
if (import.meta.main) {
  main();
}
