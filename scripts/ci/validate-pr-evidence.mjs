#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const requiredSections = [
  '## Summary',
  '## Plan + Feature Evidence',
  '## Plan Review Checklist',
  '## Task Evidence',
  '## Verification Commands',
  '## Beads Sync',
];

function fail(message) {
  console.error(`[pr:evidence:verify] ${message}`);
  process.exit(1);
}

function commandExists(command) {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function readBodyFromEventFile(eventPath) {
  if (!fs.existsSync(eventPath)) {
    fail(`Event payload does not exist: ${eventPath}`);
  }

  const payload = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
  return payload.pull_request?.body;
}

function readBodyFromGhCli() {
  if (!commandExists('gh')) {
    return null;
  }

  try {
    const body = execSync('gh pr view --json body --jq .body', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return body.trim();
  } catch {
    return null;
  }
}

const eventPath = process.env.GITHUB_EVENT_PATH;
const envBody = process.env.PR_BODY;

const eventBody = eventPath ? readBodyFromEventFile(eventPath) : null;
const body = eventBody || envBody || readBodyFromGhCli();

if (!eventPath && !envBody) {
  console.log('[pr:evidence:verify] No GITHUB_EVENT_PATH found; using local PR body resolution.');
}

if (!body || typeof body !== 'string') {
  fail(
    'Unable to resolve pull request body. Set GITHUB_EVENT_PATH (CI), set PR_BODY, or run on a branch with an open PR and GitHub CLI configured.'
  );
}

for (const section of requiredSections) {
  if (!body.includes(section)) {
    fail(`Missing required section: ${section}`);
  }
}

const checklistMatch = body.match(/## Plan Review Checklist([\s\S]*?)(?:\n##\s|$)/);
const checklistBody = checklistMatch?.[1] ?? '';
const checkedBoxes = (checklistBody.match(/^-\s*\[[xX]\]/gm) || []).length;
if (checkedBoxes < 5) {
  fail('Not enough checklist items are checked in Plan Review Checklist section.');
}

const artifactPaths = Array.from(
  body.matchAll(/`([^`]+(?:plan\.md|report\.md))`/g),
  (match) => match[1],
);

const hasPlanReference = artifactPaths.some((artifactPath) => artifactPath.endsWith('plan.md'));
const hasReportReference = artifactPaths.some((artifactPath) => artifactPath.endsWith('report.md'));
if (!hasPlanReference || !hasReportReference) {
  fail('PR evidence must reference at least one plan.md path and one report.md path.');
}

for (const artifactPath of artifactPaths) {
  const absolutePath = path.isAbsolute(artifactPath)
    ? artifactPath
    : path.resolve(process.cwd(), artifactPath);
  if (!fs.existsSync(absolutePath)) {
    fail(`Referenced artifact not found: ${artifactPath}`);
  }
}

console.log('[pr:evidence:verify] OK: PR body includes required evidence sections.');
