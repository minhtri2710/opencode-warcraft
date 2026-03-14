import { describe, expect, it } from 'bun:test';
import {
  encodeTaskState,
  decodeTaskState,
  encodeWorkerPrompt,
  decodeWorkerPrompt,
  encodeTaskReport,
  decodeTaskReport,
  type TaskStateArtifact,
  type WorkerPromptArtifact,
  type TaskReportArtifact,
} from './artifactSchemas.js';

describe('artifactSchemas edge cases', () => {
  describe('TaskState with all status values round-trip', () => {
    const STATUSES = ['pending', 'in_progress', 'dispatch_prepared', 'done', 'cancelled', 'blocked', 'failed', 'partial'] as const;
    const ORIGINS = ['plan', 'manual'] as const;

    for (const status of STATUSES) {
      for (const origin of ORIGINS) {
        it(`${status}/${origin}`, () => {
          const artifact: TaskStateArtifact = { schemaVersion: 1, status, origin };
          const decoded = decodeTaskState(encodeTaskState(artifact))!;
          expect(decoded.status).toBe(status);
          expect(decoded.origin).toBe(origin);
        });
      }
    }
  });

  describe('WorkerPrompt with various content', () => {
    const CONTENTS = [
      'Simple prompt',
      '# Markdown\n\n- Item 1\n- Item 2',
      '```ts\nconst x = 1;\n```',
      'x'.repeat(10000),
      '',
      'Prompt with "quotes" and \'singles\'',
      'Unicode: 日本語テスト',
      'Newlines\n\n\n\nMultiple',
    ];

    for (const content of CONTENTS) {
      it(`content: ${content.slice(0, 30)}...`, () => {
        const artifact: WorkerPromptArtifact = {
          schemaVersion: 1,
          content,
          generatedAt: '2024-01-01T00:00:00Z',
        };
        const decoded = decodeWorkerPrompt(encodeWorkerPrompt(artifact))!;
        expect(decoded.content).toBe(content);
      });
    }
  });

  describe('TaskReport with various content', () => {
    const REPORTS = [
      '# Report\nCompleted successfully',
      'Short',
      '# Report\n\n## Summary\n\n- Done X\n- Done Y\n\n## Issues\n\nNone',
      'x'.repeat(50000),
    ];

    for (const content of REPORTS) {
      it(`report: ${content.slice(0, 30)}...`, () => {
        const artifact: TaskReportArtifact = {
          schemaVersion: 1,
          content,
          createdAt: '2024-01-01T00:00:00Z',
        };
        const decoded = decodeTaskReport(encodeTaskReport(artifact))!;
        expect(decoded.content).toBe(content);
      });
    }
  });

  describe('decode null/empty/invalid', () => {
    const INVALIDS = [null, '', '{}', '[]', 'true', '42', '"string"'];
    
    for (const input of INVALIDS) {
      const label = input === null ? 'null' : `"${input}"`;
      it(`decodeTaskState(${label})`, () => {
        const result = decodeTaskState(input);
        // Should either return valid artifact or null
        expect(result === null || (typeof result === 'object' && result.schemaVersion === 1)).toBe(true);
      });
    }
  });
});
