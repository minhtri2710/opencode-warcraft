import { describe, expect, it } from 'bun:test';
import { DockerSandboxService } from './dockerSandboxService.js';

describe('DockerSandboxService validation', () => {
  const INVALID_IMAGES = [
    '',
    ' ',
    'a b',
    '../escape',
    '/absolute',
    'with;injection',
    'with&&chain',
    'with|pipe',
    'with`backtick`',
    'with$(cmd)',
    'with${var}',
    'has\nnewline',
    'has\ttab',
  ];

  describe('rejects invalid images', () => {
    for (const image of INVALID_IMAGES) {
      const label = image.replace(/\n/g, '\\n').replace(/\t/g, '\\t');
      it(`rejects "${label}"`, () => {
        expect(() => DockerSandboxService.validateImage(image)).toThrow();
      });
    }
  });

  describe('buildRunCommand includes workspace mount', () => {
    it('maps workspace correctly', () => {
      const result = DockerSandboxService.buildRunCommand('/my/workspace', 'echo test', 'ubuntu');
      const argsStr = result.args.join(' ');
      expect(argsStr).toContain('/my/workspace');
    });

    it('passes command to container', () => {
      const result = DockerSandboxService.buildRunCommand('/workspace', 'npm test', 'node:20');
      const argsStr = result.args.join(' ');
      expect(argsStr).toContain('npm test');
    });
  });
});
