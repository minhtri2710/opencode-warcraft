import { describe, expect, it } from 'bun:test';
import { SimpleGitClient } from './simple-git-client.js';

describe('SimpleGitClient methods', () => {
  it('constructor accepts cwd', () => {
    const client = new SimpleGitClient(process.cwd());
    expect(client).toBeDefined();
  });

  it('has status method', () => {
    const client = new SimpleGitClient(process.cwd());
    expect(typeof client.status).toBe('function');
  });

  it('has branch method', () => {
    const client = new SimpleGitClient(process.cwd());
    expect(typeof client.branch).toBe('function');
  });

  it('has log method', () => {
    const client = new SimpleGitClient(process.cwd());
    expect(typeof client.log).toBe('function');
  });

  it('has add method', () => {
    const client = new SimpleGitClient(process.cwd());
    expect(typeof client.add).toBe('function');
  });

  it('has commit method', () => {
    const client = new SimpleGitClient(process.cwd());
    expect(typeof client.commit).toBe('function');
  });

  it('has merge method', () => {
    const client = new SimpleGitClient(process.cwd());
    expect(typeof client.merge).toBe('function');
  });

  it('has diff method', () => {
    const client = new SimpleGitClient(process.cwd());
    expect(typeof client.diff).toBe('function');
  });
});
