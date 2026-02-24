/**
 * Variant hook for applying per-agent model variants to OpenCode prompts.
 * 
 * This module provides the `chat.message` hook implementation that:
 * - Reads the target agent name from the message being created
 * - Looks up the configured variant for that Warcraft agent from ConfigService
 * - If the message has no variant set, applies the configured variant
 * - Never overrides an already-set variant (respects explicit selection)
 */

import type { ConfigService } from 'warcraft-core';
import type { Hooks } from '@opencode-ai/plugin';

/**
 * Hook function type extracted from the OpenCode plugin's Hooks interface.
 * This avoids SDK version mismatches by deriving the type from the plugin itself.
 */
export type ChatMessageHook = NonNullable<Hooks['chat.message']>;

/**
 * List of Warcraft agent names that can have variants configured.
 */
export const WARCRAFT_AGENT_NAMES = [
  'khadgar',
  'mimiron',
  'saurfang',
  'brann',
  'mekkatorque',
  'algalon',
] as const;

export type WarcraftAgentName = typeof WARCRAFT_AGENT_NAMES[number];

/**
 * Check if an agent name is a Warcraft agent.
 */
export function isWarcraftAgent(agent: string | undefined): agent is WarcraftAgentName {
  return agent !== undefined && WARCRAFT_AGENT_NAMES.includes(agent as WarcraftAgentName);
}

/**
 * Normalize a variant string: trim whitespace and return undefined if empty.
 */
export function normalizeVariant(variant: string | undefined): string | undefined {
  if (variant === undefined) return undefined;
  const trimmed = variant.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Create the chat.message hook for variant injection.
 * 
 * The hook signature matches OpenCode plugin's expected type:
 * - input: { sessionID, agent?, model?, messageID?, variant? }
 * - output: { message: UserMessage, parts: Part[] }
 * 
 * We only access output.message.variant which exists on UserMessage.
 * 
 * @param configService - The ConfigService instance to read agent configs from
 * @returns The chat.message hook function
 */
export function createVariantHook(configService: ConfigService): ChatMessageHook {
  return async (input, output): Promise<void> => {
    const { agent } = input;

    // Skip if no agent specified
    if (!agent) return;

    // Skip if not a Warcraft agent
    if (!isWarcraftAgent(agent)) return;

    // The framework extends UserMessage at runtime with a `variant` field
    // that isn't in the SDK type definition. Use a targeted assertion for
    // this framework boundary rather than casting the entire hook as `any`.
    const message = output.message as typeof output.message & { variant?: string };

    // Skip if variant is already set (respect explicit selection)
    if (message.variant !== undefined) return;

    // Look up configured variant for this agent
    const agentConfig = configService.getAgentConfig(agent);
    const configuredVariant = normalizeVariant(agentConfig.variant);

    // Apply configured variant if present
    if (configuredVariant !== undefined) {
      message.variant = configuredVariant;
    }
  };
}
