import { describe, expect, it } from 'bun:test';
import { appendContextContent, renderContextSection, renderContextSections } from './context-markdown.js';

describe('context-markdown combinatorial', () => {
  const SECTION_NAMES = ['decisions', 'learnings', 'architecture', 'notes', 'constraints'];
  const CONTENTS = [
    'Simple text',
    '# Heading\n\nWith paragraphs',
    '```ts\nconst x = 1;\n```',
    '- Item 1\n- Item 2\n- Item 3',
    'Line 1\nLine 2\n\nLine 4',
  ];

  describe('renderContextSection all combinations', () => {
    for (const name of SECTION_NAMES) {
      for (const content of CONTENTS) {
        it(`${name} with ${content.slice(0, 20)}...`, () => {
          const result = renderContextSection(name, content);
          expect(result).toBeDefined();
          expect(result.length).toBeGreaterThan(0);
          expect(result).toContain(content);
        });
      }
    }
  });

  describe('renderContextSections all sizes', () => {
    for (let count = 0; count <= 5; count++) {
      it(`${count} sections`, () => {
        const sections = SECTION_NAMES.slice(0, count).map((name, i) => ({
          name,
          content: CONTENTS[i % CONTENTS.length],
        }));
        const result = renderContextSections(sections);
        expect(typeof result).toBe('string');
        if (count === 0) {
          expect(result).toBe('');
        } else {
          expect(result.length).toBeGreaterThan(0);
        }
      });
    }
  });

  describe('appendContextContent combinations', () => {
    const EXISTING = [null, undefined, '', 'Existing content', '# Existing\n\nWith structure'];
    const INCOMING = ['New content', '# New Section', '- New item'];

    for (const existing of EXISTING) {
      for (const incoming of INCOMING) {
        const label = `existing=${existing === null ? 'null' : existing === undefined ? 'undefined' : existing.slice(0, 15)}`;
        it(`${label} + incoming=${incoming.slice(0, 15)}`, () => {
          const result = appendContextContent(existing, incoming);
          expect(result).toContain(incoming);
          if (existing && existing.length > 0) {
            expect(result).toContain(existing);
          }
        });
      }
    }
  });
});
