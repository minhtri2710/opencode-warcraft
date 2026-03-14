import { describe, expect, it } from 'bun:test';
import { validateDiscoverySection } from './discovery-gate.js';

describe('discovery-gate more scenarios', () => {
  it('passes with substantial discovery section', () => {
    const content = `# Plan

## Discovery

We investigated the codebase thoroughly. Found that the API layer uses Express with middleware chains.
The database uses PostgreSQL with Prisma ORM. Authentication is handled via JWT tokens.
Key decisions: Use REST over GraphQL for simplicity. Deploy via Docker containers.

## Tasks

### 1. Setup
Do the setup.`;
    expect(validateDiscoverySection(content)).toBeNull();
  });

  it('fails without discovery section', () => {
    const content = `# Plan

## Tasks

### 1. Do stuff`;
    const result = validateDiscoverySection(content);
    expect(result).not.toBeNull();
    expect(result).toContain('BLOCKED');
    expect(result).toContain('Discovery');
  });

  it('fails with discovery section that is too short', () => {
    const content = `# Plan

## Discovery

Short.

## Tasks`;
    const result = validateDiscoverySection(content);
    expect(result).not.toBeNull();
    expect(result).toContain('too thin');
  });

  it('works with discovery at end of file (no next heading)', () => {
    const content = `# Plan

## Discovery

${'A detailed discovery section with enough content to pass validation. '.repeat(3)}`;
    expect(validateDiscoverySection(content)).toBeNull();
  });

  it('case insensitive heading match', () => {
    const content = `## discovery

${'Thorough investigation of the codebase and architecture decisions documented here. '.repeat(3)}`;
    expect(validateDiscoverySection(content)).toBeNull();
  });

  it('lightweight workflow allows shorter discovery', () => {
    const content = `Workflow path: lightweight

## Scope
Single file change.

## Discovery
Checked the file and confirmed the fix is safe and minimal.

Impact: Low
Safety: No breaking changes
Verify: Run existing tests
Rollback: Revert commit

## Tasks

### 1. Fix bug
Fix it.`;
    expect(validateDiscoverySection(content)).toBeNull();
  });

  it('lightweight without mini-record fails', () => {
    const content = `Workflow path: lightweight

## Scope
Single file change.

## Discovery
Checked the file and confirmed the fix is safe and minimal.

## Tasks

### 1. Fix bug
Fix it.`;
    const result = validateDiscoverySection(content);
    expect(result).not.toBeNull();
    expect(result).toContain('mini-record');
  });
});
