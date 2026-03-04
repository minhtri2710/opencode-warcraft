/**
 * Warcraft Skills System
 *
 * Export skill infrastructure for use in warcraft_skill tool.
 */

export {
  BUILTIN_SKILLS,
  type BuiltinSkillName,
  getBuiltinSkills,
  getFilteredSkills,
  loadBuiltinSkill,
} from './builtin.js';
export { loadFileSkill } from './file-loader.js';
export type { SkillDefinition, SkillLoadResult } from './types.js';
