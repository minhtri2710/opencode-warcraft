import { type ToolDefinition, tool } from '@opencode-ai/plugin';
import type { FeatureService } from 'warcraft-core';
import { isUsable } from 'warcraft-core';
import { toolError, toolSuccess } from '../types.js';
import { resolveFeatureInput } from './tool-input.js';

export interface FeatureToolsDependencies {
  featureService: FeatureService;
}

/**
 * Feature domain tools - Create and complete features
 */
export class FeatureTools {
  constructor(private readonly deps: FeatureToolsDependencies) {}

  /**
   * Create a new feature
   */
  createFeatureTool(): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { featureService } = this.deps;
    return tool({
      description: 'Create a new feature',
      args: {
        name: tool.schema.string().describe('Feature name'),
        ticket: tool.schema.string().optional().describe('Ticket reference'),
        priority: tool.schema.number().optional().describe('Priority (1-5, default: 3)'),
      },
      async execute({ name, ticket, priority }) {
        const priorityValue = priority ?? 3;
        if (!Number.isInteger(priorityValue) || priorityValue < 1 || priorityValue > 5) {
          return toolError(`Priority must be an integer between 1 and 5 (inclusive), got: ${priorityValue}`);
        }
        const outcome = featureService.create(name, ticket, priorityValue);
        if (!isUsable(outcome)) {
          return toolError(outcome.diagnostics.map((d) => d.message).join('; '));
        }
        const feature = outcome.value;
        const epicBeadId = (feature as { epicBeadId?: string }).epicBeadId;
        return toolSuccess({
          message: `Feature "${feature.name}" created (epic: ${epicBeadId || 'unknown'}).

## Discovery Phase Required

Before writing a plan, you MUST:
1. Ask clarifying questions about the feature
2. Document Q&A in plan.md with a \`## Discovery\` section
3. Research the codebase (grep, read existing code)
4. Save findings with warcraft_context_write

Example discovery section:
\`\`\`markdown
## Discovery

**Q: What authentication system do we use?**
A: JWT with refresh tokens, see src/auth/

**Q: Should this work offline?**
A: No, online-only is fine

**Research:**
- Found existing theme system in src/theme/
- Uses CSS variables pattern
\`\`\`

## Planning Guidelines

When writing your plan, include:
- \`## Non-Goals\` - What we're explicitly NOT building (scope boundaries)
- \`## Ghost Diffs\` - Alternatives you considered but rejected

These prevent scope creep and re-proposing rejected solutions.

NEXT: Ask your first clarifying question about this feature.`,
        });
      },
    });
  }

  /**
   * Mark feature as completed (irreversible)
   */
  completeFeatureTool(resolveFeature: (name?: string) => string | null): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { featureService } = this.deps;
    return tool({
      description: 'Mark feature as completed (may be auto-reopened if task statuses change)',
      args: {
        name: tool.schema.string().optional().describe('Feature name (defaults to active)'),
      },
      async execute({ name }) {
        const resolution = resolveFeatureInput(resolveFeature, name);
        if (!resolution.ok) return toolError(resolution.error);
        const featureName = resolution.feature;
        const outcome = featureService.complete(featureName);
        if (!isUsable(outcome)) {
          return toolError(outcome.diagnostics.map((d) => d.message).join('; '));
        }
        return toolSuccess({ message: `Feature "${featureName}" marked as completed` });
      },
    });
  }
}
