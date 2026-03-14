import { describe, expect, test } from 'bun:test';
import { validateDiscoverySection } from './discovery-gate.js';

describe('Discovery Gate extra edge cases', () => {
  test('accepts Discovery section with exactly 100 chars for full workflow', () => {
    // Build a Discovery section with exactly 100 characters of content
    const padding = 'x'.repeat(100);
    const content = `# Feature Plan\n\n## Discovery\n\n${padding}\n\n## Implementation\n`;
    const result = validateDiscoverySection(content);
    expect(result).toBeNull();
  });

  test('blocks Discovery section with 99 chars for full workflow', () => {
    const padding = 'x'.repeat(99);
    const content = `# Feature Plan\n\n## Discovery\n\n${padding}\n\n## Implementation\n`;
    const result = validateDiscoverySection(content);
    expect(result).toContain('BLOCKED');
    expect(result).toContain('99 chars');
  });

  test('accepts Discovery section with exactly 40 chars for lightweight', () => {
    const padding = 'x'.repeat(40);
    const content = `# Feature Plan\n\nWorkflow Path: lightweight\n\n## Discovery\n\n${padding}\n\nImpact: low\nSafety: none\nVerify: test\nRollback: revert\n`;
    const result = validateDiscoverySection(content);
    expect(result).toBeNull();
  });

  test('blocks lightweight Discovery section with thin content before next heading', () => {
    const padding = 'x'.repeat(30);
    const content = `# Feature Plan\n\nWorkflow Path: lightweight\n\n## Discovery\n\n${padding}\n\n## Tasks\n\nImpact: low\nSafety: none\nVerify: test\nRollback: revert\n`;
    const result = validateDiscoverySection(content);
    expect(result).toContain('BLOCKED');
    expect(result).toContain('minimum 40');
  });

  test('case-insensitive matching of Discovery heading', () => {
    const content = `# Feature Plan\n\n## discovery\n\n${'x'.repeat(100)}\n\n## Implementation\n`;
    const result = validateDiscoverySection(content);
    expect(result).toBeNull();
  });

  test('case-insensitive matching of Discovery heading (UPPERCASE)', () => {
    const content = `# Feature Plan\n\n## DISCOVERY\n\n${'x'.repeat(100)}\n\n## Implementation\n`;
    const result = validateDiscoverySection(content);
    expect(result).toBeNull();
  });

  test('Discovery section at the very end of document (no trailing heading)', () => {
    const content = `# Feature Plan\n\n## Overview\nBrief\n\n## Discovery\n\n${'x'.repeat(100)}`;
    const result = validateDiscoverySection(content);
    expect(result).toBeNull();
  });

  test('multiple ## Discovery headings uses the first one', () => {
    const content = `# Feature Plan\n\n## Discovery\n\nShort\n\n## Discovery\n\n${'x'.repeat(200)}`;
    const result = validateDiscoverySection(content);
    // First Discovery section has only "Short" (5 chars), should be blocked
    expect(result).toContain('BLOCKED');
    expect(result).toContain('too thin');
  });

  test('### Discovery (h3) is not recognized as the gate heading', () => {
    const content = `# Feature Plan\n\n### Discovery\n\n${'x'.repeat(200)}\n`;
    const result = validateDiscoverySection(content);
    expect(result).toContain('BLOCKED: Discovery section required');
  });
});
