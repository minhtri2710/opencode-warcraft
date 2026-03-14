import { describe, expect, it } from 'bun:test';
import { SimpleGitClient } from './simple-git-client.js';

describe('SimpleGitClient exhaustive', () => {
  const INTERFACE_METHODS = ['status', 'branch', 'log', 'add', 'commit', 'diff', 'merge', 'revparse'];

  describe('interface compliance', () => {
    const client = new SimpleGitClient(process.cwd());

    for (const method of INTERFACE_METHODS) {
      it(`has ${method} method`, () => {
        expect(typeof (client as any)[method]).toBe('function');
      });
    }
  });

  describe('constructor variations', () => {
    it('accepts current dir', () => {
      expect(new SimpleGitClient(process.cwd())).toBeDefined();
    });

    it('accepts /tmp', () => {
      expect(new SimpleGitClient('/tmp')).toBeDefined();
    });

    it('accepts nested project path', () => {
      const nested = `${process.cwd()}/packages`;
      expect(new SimpleGitClient(nested)).toBeDefined();
    });
  });
});
