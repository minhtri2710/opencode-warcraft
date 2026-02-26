import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import type { SkillDefinition } from '../skills/types.js';
import { loadBuiltinSkill } from '../skills/builtin.js';
import { toolError, toolSuccess } from '../types.js';

export interface SkillToolsDependencies {
  filteredSkills: SkillDefinition[];
}

function formatSkillsXml(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';

  const skillsXml = skills
    .map((skill: SkillDefinition) => {
      return [
        '  <skill>',
        `    <name>${skill.name}</name>`,
        `    <description>(warcraft - Skill) ${skill.description}</description>`,
        '  </skill>',
      ].join('\n');
    })
    .join('\n');

  return `\n\n<available_skills\u003e\n${skillsXml}\n</available_skills>`;
}

/**
 * Skill domain tools - Load Warcraft skills
 */
export class SkillTools {
  constructor(private readonly deps: SkillToolsDependencies) {}

  /**
   * Create the warcraft_skill tool
   */
  createSkillTool(): ToolDefinition {
    const { filteredSkills } = this.deps;
    const base = `Load a Warcraft skill to get detailed instructions for a specific workflow.

Use this when a task matches an available skill's description. The descriptions below ("Use when...", "Use before...") are triggers; when one applies, you MUST load that skill before proceeding.`;
    const description =
      filteredSkills.length === 0
        ? base + '\n\nNo Warcraft skills available.'
        : base + formatSkillsXml(filteredSkills);

    const availableNames = new Set(filteredSkills.map((s: SkillDefinition) => s.name));

    return tool({
      description,
      args: {
        name: tool.schema
          .string()
          .describe('The skill name from available_skills'),
      },
      async execute({ name }) {
        if (!availableNames.has(name)) {
          const available = filteredSkills.map((s: SkillDefinition) => s.name).join(', ');
          return toolError(`Skill "${name}" not available. Available Warcraft skills: ${available || 'none'}`);
        }

        const result = loadBuiltinSkill(name);

        if (!result.found || !result.skill) {
          const available = filteredSkills.map((s: SkillDefinition) => s.name).join(', ');
          return toolError(`Skill "${name}" not found. Available Warcraft skills: ${available || 'none'}`);
        }

        const skill = result.skill;
        return toolSuccess({ message: [
          `## Warcraft Skill: ${skill.name}`,
          '',
          `**Description**: ${skill.description}`,
          '',
          skill.template,
        ].join('\n') });
      },
    });
  }
}
