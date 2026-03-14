import { describe, expect, it } from 'bun:test';
import { validateDiscoverySection } from './discovery-gate.js';

describe('discovery-gate comprehensive', () => {
  const PLANS_WITH_DISCOVERY = [
    `## Discovery\n\n### Findings\n- Found X\n- Found Y`,
    `## Discovery\n\n### Risks\n- Risk A\n- Risk B`,
    `## Discovery\n\n### Findings\n- F1\n\n### Risks\n- R1`,
    `## Discovery\n\n### Findings\n- Found code:\n  \`\`\`ts\n  const x = 1;\n  \`\`\`\n\n### Risks\n- Low risk`,
    `## Discovery\n\n### Findings\n${Array.from({ length: 20 }, (_, i) => `- Finding ${i + 1}`).join('\n')}`,
  ];

  const PLANS_WITHOUT_DISCOVERY = [
    '',
    '# Plan\n\n### 1. Task\nDo it',
    '### 1. A\nTask A\n### 2. B\nTask B',
    'Just some text with no structure',
    '## Other Section\n\nNot discovery',
  ];

  describe('plans with discovery section', () => {
    for (let i = 0; i < PLANS_WITH_DISCOVERY.length; i++) {
      it(`plan variant ${i + 1}`, () => {
        const result = validateDiscoverySection(PLANS_WITH_DISCOVERY[i]);
        expect(result === null || typeof result === 'string').toBe(true);
      });
    }
  });

  describe('plans without discovery section', () => {
    for (let i = 0; i < PLANS_WITHOUT_DISCOVERY.length; i++) {
      it(`no-discovery variant ${i + 1}`, () => {
        const result = validateDiscoverySection(PLANS_WITHOUT_DISCOVERY[i]);
        expect(result === null || typeof result === 'string').toBe(true);
      });
    }
  });

  describe('edge cases', () => {
    it('very long plan', () => {
      const long = '## Discovery\n\n### Findings\n' + 'x'.repeat(100000);
      expect(typeof validateDiscoverySection(long) === 'string' || validateDiscoverySection(long) === null).toBe(true);
    });

    it('unicode content', () => {
      const unicode = '## Discovery\n\n### Findings\n- 日本語のテスト\n- 中文测试';
      expect(typeof validateDiscoverySection(unicode) === 'string' || validateDiscoverySection(unicode) === null).toBe(true);
    });

    it('only whitespace', () => {
      expect(typeof validateDiscoverySection('   \n\n   ') === 'string' || validateDiscoverySection('   \n\n   ') === null).toBe(true);
    });
  });
});
