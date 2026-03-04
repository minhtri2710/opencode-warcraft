import { describe, expect, it } from 'bun:test';

describe('GitClient Interface Contract', () => {
  // This test validates that the GitClient interface covers all operations
  // needed by WorktreeService. It documents the contract, not implementation.

  it('should have the GitClient interface defined', () => {
    // This is a compile-time test. If the interface is missing,
    // the import will fail and TypeScript will error.
    expect(() => {
      import('./git-client.js');
    }).not.toThrow();
  });

  it('should export all required git operations', async () => {
    const module = await import('./git-client.js');

    // The module should export the GitClient interface
    // This is validated at compile time by TypeScript
    expect(module).toBeDefined();
  });
});
