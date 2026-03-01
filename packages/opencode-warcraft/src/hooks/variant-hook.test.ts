/**
 * Unit tests for the chat.message hook variant injection.
 *
 * Tests:
 * - Applies configured variant to Warcraft agents
 * - Does not override already-set variant
 * - Does not apply variants to non-Warcraft agents
 * - Handles empty/whitespace-only variants
 */

import { describe, expect, it } from 'bun:test';
import { createVariantHook, normalizeVariant, WARCRAFT_AGENT_NAMES } from './variant-hook.js';

// ============================================================================
// normalizeVariant tests
// ============================================================================

describe('normalizeVariant', () => {
  it('returns trimmed string for valid variant', () => {
    expect(normalizeVariant('high')).toBe('high');
    expect(normalizeVariant('  medium  ')).toBe('medium');
    expect(normalizeVariant('\tlow\n')).toBe('low');
  });

  it('returns undefined for empty string', () => {
    expect(normalizeVariant('')).toBeUndefined();
    expect(normalizeVariant('   ')).toBeUndefined();
    expect(normalizeVariant('\t\n')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(normalizeVariant(undefined)).toBeUndefined();
  });
});

// ============================================================================
// WARCRAFT_AGENT_NAMES tests
// ============================================================================

describe('WARCRAFT_AGENT_NAMES', () => {
  it('contains all expected Warcraft agent names', () => {
    expect(WARCRAFT_AGENT_NAMES).toContain('khadgar');
    expect(WARCRAFT_AGENT_NAMES).toContain('mimiron');
    expect(WARCRAFT_AGENT_NAMES).toContain('saurfang');
    expect(WARCRAFT_AGENT_NAMES).toContain('brann');
    expect(WARCRAFT_AGENT_NAMES).toContain('mekkatorque');
    expect(WARCRAFT_AGENT_NAMES).toContain('algalon');
  });

  it('has exactly 6 agents', () => {
    expect(WARCRAFT_AGENT_NAMES.length).toBe(6);
  });
});

// ============================================================================
// createVariantHook tests
// ============================================================================

describe('createVariantHook', () => {
  // Mock ConfigService
  const createMockConfigService = (agentVariants: Record<string, string | undefined>) => ({
    getAgentConfig: (agent: string) => ({
      variant: agentVariants[agent],
    }),
  });

  // Helper to create a minimal output object for testing
  const createOutput = (variant?: string) => ({
    message: { variant },
    parts: [],
  });

  describe('applies variant to Warcraft agents', () => {
    it('sets variant when message has no variant and agent has configured variant', async () => {
      const configService = createMockConfigService({
        mekkatorque: 'high',
      });

      const hook = createVariantHook(configService as any);

      const input = {
        sessionID: 'session-123',
        agent: 'mekkatorque',
        model: { providerID: 'anthropic', modelID: 'claude-sonnet' },
        messageID: 'msg-1',
        variant: undefined,
      };

      const output = createOutput(undefined);

      await hook(input, output);

      expect(output.message.variant).toBe('high');
    });

    it('applies variant to all Warcraft agents', async () => {
      const configService = createMockConfigService({
        khadgar: 'max',
        mimiron: 'high',
        saurfang: 'medium',
        brann: 'low',
        mekkatorque: 'high',
        algalon: 'medium',
      });

      const hook = createVariantHook(configService as any);

      for (const agentName of WARCRAFT_AGENT_NAMES) {
        const output = createOutput(undefined);

        await hook({ sessionID: 'session-123', agent: agentName }, output);

        expect(output.message.variant).toBeDefined();
      }
    });
  });

  describe('respects explicit variant', () => {
    it('does not override already-set variant', async () => {
      const configService = createMockConfigService({
        mekkatorque: 'high',
      });

      const hook = createVariantHook(configService as any);

      const output = createOutput('low'); // Already set

      await hook({ sessionID: 'session-123', agent: 'mekkatorque', variant: 'low' }, output);

      // Should remain 'low', not overridden to 'high'
      expect(output.message.variant).toBe('low');
    });
  });

  describe('does not apply to non-Warcraft agents', () => {
    it('does not set variant for unknown agent', async () => {
      const configService = createMockConfigService({
        mekkatorque: 'high',
      });

      const hook = createVariantHook(configService as any);

      const output = createOutput(undefined);

      await hook({ sessionID: 'session-123', agent: 'some-other-agent' }, output);

      expect(output.message.variant).toBeUndefined();
    });

    it('does not set variant for built-in OpenCode agents', async () => {
      const configService = createMockConfigService({
        mekkatorque: 'high',
      });

      const hook = createVariantHook(configService as any);

      const builtinAgents = ['build', 'plan', 'code'];

      for (const agentName of builtinAgents) {
        const output = createOutput(undefined);

        await hook({ sessionID: 'session-123', agent: agentName }, output);

        expect(output.message.variant).toBeUndefined();
      }
    });
  });

  describe('handles edge cases', () => {
    it('handles missing agent in input', async () => {
      const configService = createMockConfigService({
        mekkatorque: 'high',
      });

      const hook = createVariantHook(configService as any);

      const output = createOutput(undefined);

      await hook({ sessionID: 'session-123', agent: undefined }, output);

      // Should not crash, should not set variant (no agent to look up)
      expect(output.message.variant).toBeUndefined();
    });

    it('handles empty variant config', async () => {
      const configService = createMockConfigService({
        mekkatorque: '', // Empty string
      });

      const hook = createVariantHook(configService as any);

      const output = createOutput(undefined);

      await hook({ sessionID: 'session-123', agent: 'mekkatorque' }, output);

      // Empty string should be treated as unset
      expect(output.message.variant).toBeUndefined();
    });

    it('handles whitespace-only variant config', async () => {
      const configService = createMockConfigService({
        mekkatorque: '   ', // Whitespace only
      });

      const hook = createVariantHook(configService as any);

      const output = createOutput(undefined);

      await hook({ sessionID: 'session-123', agent: 'mekkatorque' }, output);

      // Whitespace-only should be treated as unset
      expect(output.message.variant).toBeUndefined();
    });

    it('handles undefined variant config', async () => {
      const configService = createMockConfigService({
        mekkatorque: undefined,
      });

      const hook = createVariantHook(configService as any);

      const output = createOutput(undefined);

      await hook({ sessionID: 'session-123', agent: 'mekkatorque' }, output);

      // Undefined should be treated as unset
      expect(output.message.variant).toBeUndefined();
    });

    it('trims variant before applying', async () => {
      const configService = createMockConfigService({
        mekkatorque: '  high  ', // Has whitespace
      });

      const hook = createVariantHook(configService as any);

      const output = createOutput(undefined);

      await hook({ sessionID: 'session-123', agent: 'mekkatorque' }, output);

      // Should be trimmed
      expect(output.message.variant).toBe('high');
    });
  });
});
