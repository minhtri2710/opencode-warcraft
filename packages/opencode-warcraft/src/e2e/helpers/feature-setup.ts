/**
 * Deterministic feature creation helper for E2E tests.
 *
 * Replaces the antipattern of try/catch swallowing all errors:
 * ```
 * try { await create() } catch (_e) {} // BAD: hides real failures
 * ```
 *
 * With explicit error classification that only ignores 'already exists'.
 */

type ToolContext = {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
};

type ToolHooks = {
  tool?: Record<string, { execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown> }>;
};

/**
 * Create a feature, ignoring only 'already exists' errors.
 * Throws on unexpected failures (permissions, br CLI errors, etc.).
 */
export async function ensureFeatureExists(
  hooks: ToolHooks,
  featureName: string,
  toolContext: ToolContext,
): Promise<void> {
  try {
    const output = await hooks.tool!.warcraft_feature_create.execute({ name: featureName }, toolContext);

    // Handle non-throwing error responses (JSON with success: false)
    const result = typeof output === 'string' ? JSON.parse(output) : output;
    if (result && result.success === false) {
      const msg = result.error || '';
      // Only ignore 'already exists' errors
      if (!msg.includes('already exists')) {
        throw new Error(`Failed to create feature '${featureName}': ${msg}`);
      }
      // If it's 'already exists', silently ignore (feature already created)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Only ignore 'already exists' errors
    if (!message.includes('already exists')) {
      throw new Error(`Failed to create feature '${featureName}': ${message}`);
    }
    // If it's 'already exists', silently ignore (feature already created)
  }
}
