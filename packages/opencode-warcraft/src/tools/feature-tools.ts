import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import type { FeatureService } from 'warcraft-core';
import { validatePathSegment } from './index.js';

export interface FeatureToolsDependencies {
  featureService: FeatureService;
}

/**
 * Feature domain tools - Create and complete features
 */
export class FeatureTools {
  constructor(private readonly deps: FeatureToolsDependencies) {}

  /**
   * Create a new feature and set it as active
   */
  createFeatureTool(): ToolDefinition {
    // Capture deps in closure to avoid 'this' binding issues
    const { featureService } = this.deps;
    return tool({
      description: 'Create a new feature and set it as active',
      args: {
        name: tool.schema.string().describe('Feature name'),
        ticket: tool.schema.string().optional().describe('Ticket reference'),
        priority: tool.schema.number().optional().describe('Priority (1-5, default: 3)'),
      },
      async execute({ name, ticket, priority }) {
        const priorityValue = priority ?? 3;
        if (!Number.isInteger(priorityValue) || priorityValue < 1 || priorityValue > 5) {
          return `Error: Priority must be an integer between 1 and 5 (inclusive), got: ${priorityValue}`;
        }
        const feature = featureService.create(name, ticket, priorityValue);
        const epicBeadId = (feature as { epicBeadId?: string }).epicBeadId;
        return `Feature "${name}" created (epic: ${epicBeadId || 'unknown'}).

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

NEXT: Ask your first clarifying question about this feature.`;
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
      description: 'Mark feature as completed (irreversible)',
      args: {
        name: tool.schema
          .string()
          .optional()
          .describe('Feature name (defaults to active)'),
      },
      async execute({ name }) {
        if (name) validatePathSegment(name, 'feature');
        const feature = resolveFeature(name);
        if (!feature)
          return 'Error: No feature specified. Create a feature or provide name.';
        featureService.complete(feature);
        return `Feature "${feature}" marked as completed`;
      },
    });
  }
}
