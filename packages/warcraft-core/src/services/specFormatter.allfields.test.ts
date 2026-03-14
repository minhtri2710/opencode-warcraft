import { describe, expect, it } from 'bun:test';
import { formatSpecContent } from './specFormatter.js';
import type { SpecData } from '../types.js';

describe('specFormatter all field combinations', () => {
  const FEATURE_NAMES = ['simple', 'complex-feature', 'x'];
  const TASK_CONFIGS = [
    { folder: '01-a', name: 'Setup', order: 1 },
    { folder: '05-build', name: 'Build Core Module', order: 5 },
    { folder: '99-final', name: 'Deploy', order: 99 },
  ];
  const DEP_CONFIGS = [
    [],
    ['01-init'],
    ['01-a', '02-b', '03-c'],
  ];
  const PLAN_SECTIONS = [
    null,
    'Simple plan',
    '## Detailed\n\n- Step 1\n- Step 2\n\n```ts\ncode\n```',
  ];

  for (const feat of FEATURE_NAMES) {
    for (const task of TASK_CONFIGS) {
      for (const deps of DEP_CONFIGS) {
        for (const plan of PLAN_SECTIONS) {
          const desc = `${feat}/${task.folder}/deps=${deps.length}/plan=${plan ? 'yes' : 'null'}`;
          it(desc, () => {
            const spec: SpecData = {
              featureName: feat,
              task,
              dependsOn: deps,
              allTasks: [task],
              planSection: plan,
              contextFiles: [],
              completedTasks: [],
            };
            const result = formatSpecContent(spec);
            expect(result.length).toBeGreaterThan(0);
            expect(result).toContain(feat);
          });
        }
      }
    }
  }
});
