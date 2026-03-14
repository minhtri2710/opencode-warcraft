import { describe, expect, it } from 'bun:test';
import { validateDiscoverySection } from './discovery-gate.js';
import { formatPlanReviewChecklistIssues, validatePlanReviewChecklist } from './plan-review-gate.js';
import {
  countPlanTasks,
  detectWorkflowPath,
  hasLightweightMiniRecord,
  validateLightweightPlan,
} from './workflow-path.js';

describe('planGates integration', () => {
  const fullPlan = `# Plan

## Discovery

### Findings
- Found existing code

### Risks
- None

## Tasks

### 1. Setup
Initialize the project

### 2. Implementation
Build the core feature

### 3. Testing
Write comprehensive tests

## Plan Review Checklist
- [x] Discovery complete
- [x] Tasks identified
- [x] Risks assessed
`;

  it('full plan returns discovery result', () => {
    const result = validateDiscoverySection(fullPlan);
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('full plan has 3 tasks', () => {
    expect(countPlanTasks(fullPlan)).toBe(3);
  });

  it('full plan is standard workflow', () => {
    expect(detectWorkflowPath(fullPlan)).toBe('standard');
  });

  it('plan review returns result', () => {
    const result = validatePlanReviewChecklist(fullPlan);
    expect(result).toBeDefined();
    expect(typeof result.ok).toBe('boolean');
  });

  it('minimal plan fails discovery', () => {
    const result = validateDiscoverySection('Just do things');
    expect(result).not.toBeNull();
  });

  it('empty plan has 0 tasks', () => {
    expect(countPlanTasks('')).toBe(0);
  });

  it('plan without mini-record is not lightweight', () => {
    expect(hasLightweightMiniRecord('# Plan\n\n### 1. Task')).toBe(false);
  });

  it('formatPlanReviewChecklistIssues produces readable output', () => {
    const output = formatPlanReviewChecklistIssues(['Missing scope', 'No tests defined']);
    expect(output).toContain('Missing scope');
    expect(output).toContain('No tests defined');
  });

  it('validateLightweightPlan returns array for any input', () => {
    expect(Array.isArray(validateLightweightPlan(''))).toBe(true);
    expect(Array.isArray(validateLightweightPlan('# Plan'))).toBe(true);
  });
});
