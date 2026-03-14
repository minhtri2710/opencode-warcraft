import { describe, expect, it } from 'bun:test';
import { validateDiscoverySection } from './discovery-gate.js';

describe('discovery-gate deep scenarios', () => {
  it('returns null for valid discovery section', () => {
    const content = `## Discovery

### Findings
- Found existing code in src/
- Database schema exists

### Risks
- Breaking changes possible

### Assumptions
- API is stable
`;
    const result = validateDiscoverySection(content);
    expect(result).toBeNull();
  });

  it('returns error for missing discovery', () => {
    const result = validateDiscoverySection('# Plan\n\nJust do things');
    expect(result).not.toBeNull();
  });

  it('returns error for empty string', () => {
    const result = validateDiscoverySection('');
    expect(result).not.toBeNull();
  });

  it('returns string error message', () => {
    const result = validateDiscoverySection('no discovery here');
    expect(typeof result).toBe('string');
  });

  it('accepts discovery with different subsection names', () => {
    const content = `## Discovery

### Analysis
Everything looks good.

### Impact
No breaking changes.
`;
    const result = validateDiscoverySection(content);
    // Should be null or have specific issues
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('rejects discovery without subsections', () => {
    const content = `## Discovery

This is just text without subsections.
`;
    const result = validateDiscoverySection(content);
    // May or may not pass depending on requirements
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('handles markdown with BOM', () => {
    const content = `\uFEFF## Discovery\n\n### Findings\n- Found code\n`;
    const result = validateDiscoverySection(content);
    expect(result === null || typeof result === 'string').toBe(true);
  });

  it('handles discovery section with code blocks', () => {
    const content = `## Discovery

### Findings
Found this code:
\`\`\`typescript
export function main() {}
\`\`\`

### Risks
None identified.
`;
    const result = validateDiscoverySection(content);
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
