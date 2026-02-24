/**
 * Tests for file-based skill loader.
 *
 * Verifies skill ID validation, search path order, and YAML frontmatter parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadFileSkill } from './file-loader.js';

// ============================================================================
// Test Fixtures
// ============================================================================

const VALID_SKILL_CONTENT = `---
name: test-skill
description: A test skill for unit tests
---
# Test Skill

This is the skill body content.
`;

const SKILL_WITH_MISMATCHED_NAME = `---
name: wrong-name
description: A test skill with wrong name
---
# Wrong Name Skill
`;

const SKILL_MISSING_NAME = `---
description: Missing the name field
---
# Missing Name
`;

const SKILL_MISSING_DESCRIPTION = `---
name: test-skill
---
# Missing Description
`;

const INVALID_FRONTMATTER = `# No frontmatter
Just content without YAML.
`;

// ============================================================================
// Test Helpers
// ============================================================================

let tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-loader-test-'));
  tempDirs.push(dir);
  return dir;
}

function createSkillFile(baseDir: string, relativePath: string, content: string): void {
  const fullPath = path.join(baseDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

// ============================================================================
// Skill ID Validation
// ============================================================================

describe('loadFileSkill - ID validation', () => {
  const dummyRoot = '/dummy';
  const dummyHome = '/dummy-home';

  it('rejects empty skill ID', async () => {
    const result = await loadFileSkill('', dummyRoot, dummyHome);
    expect(result.found).toBe(false);
    expect(result.error).toContain('empty');
  });

  it('rejects skill ID with forward slash', async () => {
    const result = await loadFileSkill('foo/bar', dummyRoot, dummyHome);
    expect(result.found).toBe(false);
    expect(result.error).toContain('path traversal');
  });

  it('rejects skill ID with backslash', async () => {
    const result = await loadFileSkill('foo\\bar', dummyRoot, dummyHome);
    expect(result.found).toBe(false);
    expect(result.error).toContain('path traversal');
  });

  it('rejects skill ID with double dot', async () => {
    const result = await loadFileSkill('..', dummyRoot, dummyHome);
    expect(result.found).toBe(false);
    expect(result.error).toContain('path traversal');
  });

  it('rejects skill ID with dot-dot in the middle', async () => {
    const result = await loadFileSkill('foo..bar', dummyRoot, dummyHome);
    expect(result.found).toBe(false);
    expect(result.error).toContain('path traversal');
  });

  it('rejects skill ID that is just a single dot', async () => {
    const result = await loadFileSkill('.', dummyRoot, dummyHome);
    expect(result.found).toBe(false);
    expect(result.error).toContain('path traversal');
  });
});

// ============================================================================
// Search Path Order
// ============================================================================

describe('loadFileSkill - search path order', () => {
  let projectRoot: string;
  let homeDir: string;

  beforeEach(() => {
    projectRoot = createTempDir();
    homeDir = createTempDir();
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it('finds skill in project .opencode/skills first', async () => {
    // Create skill in all 4 locations
    createSkillFile(projectRoot, '.opencode/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);
    createSkillFile(homeDir, '.config/opencode/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);
    createSkillFile(projectRoot, '.claude/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);
    createSkillFile(homeDir, '.claude/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);

    const result = await loadFileSkill('test-skill', projectRoot, homeDir);

    expect(result.found).toBe(true);
    expect(result.source).toBe(path.join(projectRoot, '.opencode/skills/test-skill/SKILL.md'));
  });

  it('falls back to global .config/opencode/skills', async () => {
    // Create skill in global opencode and both claude locations
    createSkillFile(homeDir, '.config/opencode/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);
    createSkillFile(projectRoot, '.claude/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);
    createSkillFile(homeDir, '.claude/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);

    const result = await loadFileSkill('test-skill', projectRoot, homeDir);

    expect(result.found).toBe(true);
    expect(result.source).toBe(path.join(homeDir, '.config/opencode/skills/test-skill/SKILL.md'));
  });

  it('falls back to project .claude/skills', async () => {
    // Create skill in project claude and global claude
    createSkillFile(projectRoot, '.claude/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);
    createSkillFile(homeDir, '.claude/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);

    const result = await loadFileSkill('test-skill', projectRoot, homeDir);

    expect(result.found).toBe(true);
    expect(result.source).toBe(path.join(projectRoot, '.claude/skills/test-skill/SKILL.md'));
  });

  it('falls back to global .claude/skills', async () => {
    // Create skill only in global claude
    createSkillFile(homeDir, '.claude/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);

    const result = await loadFileSkill('test-skill', projectRoot, homeDir);

    expect(result.found).toBe(true);
    expect(result.source).toBe(path.join(homeDir, '.claude/skills/test-skill/SKILL.md'));
  });

  it('returns not found when skill does not exist in any location', async () => {
    const result = await loadFileSkill('nonexistent-skill', projectRoot, homeDir);

    expect(result.found).toBe(false);
    expect(result.error).toContain('not found');
  });
});

// ============================================================================
// Frontmatter Parsing
// ============================================================================

describe('loadFileSkill - frontmatter parsing', () => {
  let projectRoot: string;
  let homeDir: string;

  beforeEach(() => {
    projectRoot = createTempDir();
    homeDir = createTempDir();
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it('parses valid YAML frontmatter and returns skill definition', async () => {
    createSkillFile(projectRoot, '.opencode/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);

    const result = await loadFileSkill('test-skill', projectRoot, homeDir);

    expect(result.found).toBe(true);
    expect(result.skill).toBeDefined();
    expect(result.skill!.name).toBe('test-skill');
    expect(result.skill!.description).toBe('A test skill for unit tests');
    expect(result.skill!.template).toContain('# Test Skill');
    expect(result.skill!.template).toContain('This is the skill body content.');
  });

  it('returns error when frontmatter name does not match skill ID', async () => {
    createSkillFile(projectRoot, '.opencode/skills/test-skill/SKILL.md', SKILL_WITH_MISMATCHED_NAME);

    const result = await loadFileSkill('test-skill', projectRoot, homeDir);

    expect(result.found).toBe(false);
    expect(result.error).toContain('name mismatch');
  });

  it('returns error when frontmatter is missing name field', async () => {
    createSkillFile(projectRoot, '.opencode/skills/test-skill/SKILL.md', SKILL_MISSING_NAME);

    const result = await loadFileSkill('test-skill', projectRoot, homeDir);

    expect(result.found).toBe(false);
    expect(result.error).toContain('frontmatter');
  });

  it('returns error when frontmatter is missing description field', async () => {
    createSkillFile(projectRoot, '.opencode/skills/test-skill/SKILL.md', SKILL_MISSING_DESCRIPTION);

    const result = await loadFileSkill('test-skill', projectRoot, homeDir);

    expect(result.found).toBe(false);
    expect(result.error).toContain('frontmatter');
  });

  it('returns error when file has no frontmatter', async () => {
    createSkillFile(projectRoot, '.opencode/skills/test-skill/SKILL.md', INVALID_FRONTMATTER);

    const result = await loadFileSkill('test-skill', projectRoot, homeDir);

    expect(result.found).toBe(false);
    expect(result.error).toContain('frontmatter');
  });
});

// ============================================================================
// Body Content Preservation
// ============================================================================

describe('loadFileSkill - body content preservation', () => {
  let projectRoot: string;
  let homeDir: string;

  beforeEach(() => {
    projectRoot = createTempDir();
    homeDir = createTempDir();
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it('preserves body content without modification', async () => {
    const bodyWithWhitespace = `---
name: whitespace-skill
description: Test whitespace preservation
---

# Heading

   Indented content
   
Trailing newlines follow

`;
    createSkillFile(projectRoot, '.opencode/skills/whitespace-skill/SKILL.md', bodyWithWhitespace);

    const result = await loadFileSkill('whitespace-skill', projectRoot, homeDir);

    expect(result.found).toBe(true);
    expect(result.skill!.template).toContain('   Indented content');
    // Body after frontmatter starts from the line after the closing ---
    expect(result.skill!.template).toContain('# Heading');
  });

  it('appends references markdown files when present', async () => {
    createSkillFile(projectRoot, '.opencode/skills/test-skill/SKILL.md', VALID_SKILL_CONTENT);
    createSkillFile(
      projectRoot,
      '.opencode/skills/test-skill/references/rule_reference.md',
      '# Rule Reference\n\nUse `all` and `any` for composition.\n',
    );

    const result = await loadFileSkill('test-skill', projectRoot, homeDir);

    expect(result.found).toBe(true);
    expect(result.skill!.template).toContain('# Test Skill');
    expect(result.skill!.template).toContain('## Reference: rule_reference.md');
    expect(result.skill!.template).toContain('Use `all` and `any` for composition.');
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('loadFileSkill - edge cases', () => {
  let projectRoot: string;
  let homeDir: string;

  beforeEach(() => {
    projectRoot = createTempDir();
    homeDir = createTempDir();
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it('handles quoted values in frontmatter', async () => {
    const quotedContent = `---
name: "quoted-skill"
description: "A skill with 'quotes' in it"
---
# Quoted Skill
`;
    createSkillFile(projectRoot, '.opencode/skills/quoted-skill/SKILL.md', quotedContent);

    const result = await loadFileSkill('quoted-skill', projectRoot, homeDir);

    expect(result.found).toBe(true);
    expect(result.skill!.name).toBe('quoted-skill');
    expect(result.skill!.description).toBe("A skill with 'quotes' in it");
  });

  it('handles single-quoted values in frontmatter', async () => {
    const quotedContent = `---
name: 'single-quoted'
description: 'Another "quoted" skill'
---
# Single Quoted
`;
    createSkillFile(projectRoot, '.opencode/skills/single-quoted/SKILL.md', quotedContent);

    const result = await loadFileSkill('single-quoted', projectRoot, homeDir);

    expect(result.found).toBe(true);
    expect(result.skill!.name).toBe('single-quoted');
    expect(result.skill!.description).toBe('Another "quoted" skill');
  });

  it('allows hyphens and underscores in skill IDs', async () => {
    const content = `---
name: my-skill_v2
description: Skill with valid special chars
---
# Valid ID
`;
    createSkillFile(projectRoot, '.opencode/skills/my-skill_v2/SKILL.md', content);

    const result = await loadFileSkill('my-skill_v2', projectRoot, homeDir);

    expect(result.found).toBe(true);
    expect(result.skill!.name).toBe('my-skill_v2');
  });

  it('does not throw on unreadable file', async () => {
    // Create a directory where a file is expected (unreadable as file)
    fs.mkdirSync(path.join(projectRoot, '.opencode/skills/dir-skill/SKILL.md'), { recursive: true });

    const result = await loadFileSkill('dir-skill', projectRoot, homeDir);

    expect(result.found).toBe(false);
    // Should not throw, just return not found or error
    expect(result.error).toBeDefined();
  });
});
