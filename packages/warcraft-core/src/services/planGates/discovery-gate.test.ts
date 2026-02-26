import { describe, test, expect } from 'bun:test';
import { validateDiscoverySection } from './discovery-gate.js';

/**
 * Discovery Gate Tests
 * 
 * The discovery gate ensures plan writers include substantive discovery
 * documentation before proceeding to implementation planning.
 */

describe('Discovery Gate', () => {
  test('blocks plan with missing Discovery section', () => {
    const content = `# Feature Plan

## Overview
This is a plan without discovery.

## Implementation
- Step 1
- Step 2
`;
    
    const result = validateDiscoverySection(content);
    expect(result).toContain('BLOCKED: Discovery section required');
    expect(result).toContain('## Discovery');
  });

  test('blocks plan with Discovery header but empty body', () => {
    const content = `# Feature Plan

## Discovery

## Implementation
- Step 1
- Step 2
`;
    
    const result = validateDiscoverySection(content);
    expect(result).toContain('BLOCKED: Discovery section is too thin');
    expect(result).toContain('0 chars, minimum 100');
  });

  test('blocks plan with Discovery section < 100 chars', () => {
    const content = `# Feature Plan

## Discovery
Just a short note here.

## Implementation
- Step 1
`;
    
    const result = validateDiscoverySection(content);
    expect(result).toContain('BLOCKED: Discovery section is too thin');
    expect(result).toContain('minimum 100');
  });

  test('blocks plan with Discovery hidden in HTML comment', () => {
    const content = `# Feature Plan

<!-- ## Discovery -->
Hidden discovery that should not count.

## Implementation
- Step 1
`;
    
    const result = validateDiscoverySection(content);
    expect(result).toContain('BLOCKED: Discovery section required');
  });

  test('blocks plan with malformed Discovery header (singular)', () => {
    const content = `# Feature Plan

## Discover
This is not the right header.

## Implementation
- Step 1
`;
    
    const result = validateDiscoverySection(content);
    expect(result).toContain('BLOCKED: Discovery section required');
  });

  test('blocks plan with malformed Discovery header (extra text)', () => {
    const content = `# Feature Plan

## Discovery Phase
This header has extra text after Discovery.

## Implementation
- Step 1
`;
    
    const result = validateDiscoverySection(content);
    expect(result).toContain('BLOCKED: Discovery section required');
  });

  test('allows plan with well-formed Discovery section (≥100 chars)', () => {
    const content = `# Feature Plan

## Discovery

Asked user about authentication requirements. They confirmed OAuth2 with PKCE flow is preferred.
Researched existing auth patterns in src/lib/auth.ts:45-120. Found AuthProvider component that handles token refresh.

## Implementation
- Step 1
- Step 2
`;
    
    const result = validateDiscoverySection(content);
    expect(result).toBeNull(); // Should pass
  });

  test('allows Discovery at end of document', () => {
    const content = `# Feature Plan

## Overview
Brief overview here.

## Discovery

Asked user about authentication requirements. They confirmed OAuth2 with PKCE flow is preferred.
Researched existing auth patterns in src/lib/auth.ts:45-120. Found AuthProvider component that handles token refresh.
Key decision: Reuse AuthProvider instead of creating new component.
`;
    
    const result = validateDiscoverySection(content);
    expect(result).toBeNull(); // Should pass
  });

  test('correctly extracts Discovery content between headings', () => {
    const content = `# Feature Plan

## Discovery

This is exactly 100 characters of discovery content that should pass the validation gate test here ok.

## Implementation
This should not be counted as part of discovery.
`;
    
    const result = validateDiscoverySection(content);
    expect(result).toBeNull(); // Should pass
  });

  test('handles Discovery with varying whitespace in header', () => {
    const content = `# Feature Plan

##   Discovery   

Asked user about authentication requirements. They confirmed OAuth2 with PKCE flow is preferred.
Researched existing auth patterns in src/lib/auth.ts:45-120. Found AuthProvider component that handles token refresh.

## Implementation
- Step 1
`;
    
    const result = validateDiscoverySection(content);
    expect(result).toBeNull(); // Should pass
  });

  test('lightweight path accepts shorter discovery when mini-record exists', () => {
    const content = `# Feature Plan

Workflow Path: lightweight

## Discovery
Small safe update for docs and command wiring only.

Impact: low
Safety: no runtime behavior change
Verify: bun run test -- discovery-gate.test.ts
Rollback: git revert commit

### 1. Update docs
`;

    const result = validateDiscoverySection(content);
    expect(result).toBeNull();
  });

  test('lightweight path blocks when mini-record is missing', () => {
    const content = `# Feature Plan

Workflow Path: lightweight

## Discovery
Small safe update for docs and command wiring only.

### 1. Update docs
`;

    const result = validateDiscoverySection(content);
    expect(result).toContain('Lightweight workflow requires a mini-record');
  });
});
