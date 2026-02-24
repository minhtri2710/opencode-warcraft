import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import plugin from "../index";
import { BUILTIN_SKILLS } from "../skills/registry.generated.js";

/**
 * Helper to create a file-based skill in the given location.
 */
function createFileSkill(
  skillDir: string,
  skillId: string,
  description: string,
  body: string,
): void {
  const skillPath = path.join(skillDir, skillId, "SKILL.md");
  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  const content = `---
name: ${skillId}
description: ${description}
---
${body}`;
  fs.writeFileSync(skillPath, content);
}

const OPENCODE_CLIENT = createOpencodeClient({ baseUrl: "http://localhost:1" });

const TEST_ROOT_BASE = "/tmp/warcraft-config-autoload-skills-test";

function createProject(worktree: string) {
  return {
    id: "test",
    worktree,
    time: { created: Date.now() },
  };
}

describe("config hook autoLoadSkills injection", () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    fs.rmSync(TEST_ROOT_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT_BASE, { recursive: true });
    testRoot = fs.mkdtempSync(path.join(TEST_ROOT_BASE, "project-"));
    process.env.HOME = testRoot;
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT_BASE, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it("injects default autoLoadSkills into agent prompt in config hook (unified mode)", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    // khadgar should have parallel-exploration injected by default
    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();

    const parallelExplorationSkill = BUILTIN_SKILLS.find(s => s.name === "parallel-exploration");
    expect(parallelExplorationSkill).toBeDefined();
    expect(khadgarPrompt).toContain(parallelExplorationSkill!.template);

    // brann should NOT have parallel-exploration injected by default
    // (removed to prevent recursive delegation - brann cannot spawn brann)
    const brannPrompt = opencodeConfig.agent["brann"]?.prompt as string;
    expect(brannPrompt).toBeDefined();
    expect(brannPrompt).not.toContain(parallelExplorationSkill!.template);

    // mekkatorque should have test-driven-development and verification-before-completion by default
    const mekkatorquePrompt = opencodeConfig.agent["mekkatorque"]?.prompt as string;
    expect(mekkatorquePrompt).toBeDefined();
    const tddSkill = BUILTIN_SKILLS.find(s => s.name === "test-driven-development");
    const verificationSkill = BUILTIN_SKILLS.find(s => s.name === "verification-before-completion");
    expect(tddSkill).toBeDefined();
    expect(verificationSkill).toBeDefined();
    expect(mekkatorquePrompt).toContain(tddSkill!.template);
    expect(mekkatorquePrompt).toContain(verificationSkill!.template);
    // mekkatorque should NOT have parallel-exploration
    expect(mekkatorquePrompt).not.toContain(parallelExplorationSkill!.template);
  });

  it("injects user-configured autoLoadSkills into agent prompt in config hook", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          // Add brainstorming (not a default for mekkatorque) on top of defaults
          "mekkatorque": {
            autoLoadSkills: ["brainstorming"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    // mekkatorque should have brainstorming (user-configured) AND default skills
    const mekkatorquePrompt = opencodeConfig.agent["mekkatorque"]?.prompt as string;
    expect(mekkatorquePrompt).toBeDefined();

    const brainstormingSkill = BUILTIN_SKILLS.find(s => s.name === "brainstorming");
    const tddSkill = BUILTIN_SKILLS.find(s => s.name === "test-driven-development");
    const verificationSkill = BUILTIN_SKILLS.find(s => s.name === "verification-before-completion");
    expect(brainstormingSkill).toBeDefined();
    expect(tddSkill).toBeDefined();
    expect(verificationSkill).toBeDefined();
    // User-configured skill should be present
    expect(mekkatorquePrompt).toContain(brainstormingSkill!.template);
    // Default skills should also still be present
    expect(mekkatorquePrompt).toContain(tddSkill!.template);
    expect(mekkatorquePrompt).toContain(verificationSkill!.template);
  });

  it("respects disableSkills when injecting autoLoadSkills", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        disableSkills: ["parallel-exploration"],
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    // khadgar should NOT have parallel-exploration (it's disabled globally)
    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();

    const parallelExplorationSkill = BUILTIN_SKILLS.find(s => s.name === "parallel-exploration");
    expect(parallelExplorationSkill).toBeDefined();
    expect(khadgarPrompt).not.toContain(parallelExplorationSkill!.template);
  });

  it("warns on unknown skill ID but continues without error", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            autoLoadSkills: ["nonexistent-skill"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    // Should not throw, just warn
    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    // khadgar should still be defined
    expect(opencodeConfig.agent["khadgar"]).toBeDefined();
  });

  it("injects autoLoadSkills for all agents in dedicated mode", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "dedicated",
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    // mimiron should have parallel-exploration injected by default
    const mimironPrompt = opencodeConfig.agent["mimiron"]?.prompt as string;
    expect(mimironPrompt).toBeDefined();

    const parallelExplorationSkill = BUILTIN_SKILLS.find(s => s.name === "parallel-exploration");
    expect(parallelExplorationSkill).toBeDefined();
    expect(mimironPrompt).toContain(parallelExplorationSkill!.template);

    // saurfang should NOT have parallel-exploration (default is empty autoLoadSkills)
    const saurfangPrompt = opencodeConfig.agent["saurfang"]?.prompt as string;
    expect(saurfangPrompt).toBeDefined();
    expect(saurfangPrompt).not.toContain(parallelExplorationSkill!.template);
  });

  it("ensures skills are in prompt, not requiring system.transform input", async () => {
    // This test validates that skills are injected via config hook (into prompt field)
    // rather than relying on system.transform which may not have agent info at runtime
    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            autoLoadSkills: ["brainstorming"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    // The skill should be in the agent's prompt field directly
    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();

    const brainstormingSkill = BUILTIN_SKILLS.find(s => s.name === "brainstorming");
    expect(brainstormingSkill).toBeDefined();
    expect(khadgarPrompt).toContain(brainstormingSkill!.template);

    // Also verify default skill (parallel-exploration) is present
    const parallelExplorationSkill = BUILTIN_SKILLS.find(s => s.name === "parallel-exploration");
    expect(parallelExplorationSkill).toBeDefined();
    expect(khadgarPrompt).toContain(parallelExplorationSkill!.template);
  });

  it("system.transform does NOT inject skills (current path removed)", async () => {
    // This test verifies that the current autoLoadSkills injection in system.transform
    // has been completely removed. Skills should ONLY be injected via config hook.
    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            autoLoadSkills: ["brainstorming", "parallel-exploration"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);

    // Get skill templates to check
    const brainstormingSkill = BUILTIN_SKILLS.find(s => s.name === "brainstorming");
    const parallelExplorationSkill = BUILTIN_SKILLS.find(s => s.name === "parallel-exploration");
    expect(brainstormingSkill).toBeDefined();
    expect(parallelExplorationSkill).toBeDefined();

    // Call system.transform WITH agent specified
    const outputWithAgent = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.({ agent: "khadgar" }, outputWithAgent);
    const joinedWithAgent = outputWithAgent.system.join("\n");

    // Skills should NOT be in system.transform output (current path removed)
    expect(joinedWithAgent).not.toContain(brainstormingSkill!.template);
    expect(joinedWithAgent).not.toContain(parallelExplorationSkill!.template);

    // WARCRAFT_SYSTEM_PROMPT should still be there
    expect(joinedWithAgent).toContain("## Warcraft - Feature Development System");

    // Call system.transform WITHOUT agent (simulates runtime scenario)
    const outputWithoutAgent = { system: [] as string[] };
    await hooks["experimental.chat.system.transform"]?.({}, outputWithoutAgent);
    const joinedWithoutAgent = outputWithoutAgent.system.join("\n");

    // Skills should also NOT be in system.transform output when agent is missing
    expect(joinedWithoutAgent).not.toContain(brainstormingSkill!.template);
    expect(joinedWithoutAgent).not.toContain(parallelExplorationSkill!.template);

    // WARCRAFT_SYSTEM_PROMPT should still be there
    expect(joinedWithoutAgent).toContain("## Warcraft - Feature Development System");

    // Verify skills ARE in the config hook prompt (the correct path)
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);
    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toContain(brainstormingSkill!.template);
    expect(khadgarPrompt).toContain(parallelExplorationSkill!.template);
  });
});

describe("file-based skill fallback in autoLoadSkills", () => {
  let testRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    fs.rmSync(TEST_ROOT_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEST_ROOT_BASE, { recursive: true });
    testRoot = fs.mkdtempSync(path.join(TEST_ROOT_BASE, "project-"));
    process.env.HOME = testRoot;
  });

  afterEach(() => {
    fs.rmSync(TEST_ROOT_BASE, { recursive: true, force: true });
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  });

  it("loads project OpenCode skill when not a builtin", async () => {
    // Create a project-level OpenCode skill
    const projectSkillDir = path.join(testRoot, ".opencode", "skills");
    createFileSkill(
      projectSkillDir,
      "my-custom-skill",
      "A custom project skill",
      "# My Custom Skill\n\nThis is custom skill content.",
    );

    // Configure agent to auto-load this custom skill
    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            autoLoadSkills: ["my-custom-skill"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();
    expect(khadgarPrompt).toContain("# My Custom Skill");
    expect(khadgarPrompt).toContain("This is custom skill content.");
  });

  it("falls back to global OpenCode skill when project skill not found", async () => {
    // Create a global OpenCode skill (not project)
    const globalSkillDir = path.join(testRoot, ".config", "opencode", "skills");
    createFileSkill(
      globalSkillDir,
      "global-skill",
      "A global OpenCode skill",
      "# Global Skill\n\nThis is from global config.",
    );

    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            autoLoadSkills: ["global-skill"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();
    expect(khadgarPrompt).toContain("# Global Skill");
    expect(khadgarPrompt).toContain("This is from global config.");
  });

  it("falls back to project Claude skill when OpenCode skills not found", async () => {
    // Create a project Claude skill (not OpenCode)
    const claudeSkillDir = path.join(testRoot, ".claude", "skills");
    createFileSkill(
      claudeSkillDir,
      "claude-skill",
      "A Claude-compatible skill",
      "# Claude Skill\n\nThis is Claude-compatible.",
    );

    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            autoLoadSkills: ["claude-skill"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();
    expect(khadgarPrompt).toContain("# Claude Skill");
    expect(khadgarPrompt).toContain("This is Claude-compatible.");
  });

  it("builtin skill wins over file-based skill with same ID", async () => {
    // Create a file-based skill with same name as a builtin
    const projectSkillDir = path.join(testRoot, ".opencode", "skills");
    createFileSkill(
      projectSkillDir,
      "brainstorming", // Same as builtin
      "Fake brainstorming",
      "# Fake Brainstorming\n\nThis should NOT appear.",
    );

    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            autoLoadSkills: ["brainstorming"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();

    // Builtin skill template should be present
    const builtinBrainstorming = BUILTIN_SKILLS.find(s => s.name === "brainstorming");
    expect(builtinBrainstorming).toBeDefined();
    expect(khadgarPrompt).toContain(builtinBrainstorming!.template);

    // File-based fake should NOT be present
    expect(khadgarPrompt).not.toContain("# Fake Brainstorming");
    expect(khadgarPrompt).not.toContain("This should NOT appear.");
  });

  it("warns and skips when file-based skill does not exist", async () => {
    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            autoLoadSkills: ["nonexistent-file-skill", "brainstorming"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    // Should not throw
    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();

    // Builtin brainstorming should still be present (other skill in list)
    const builtinBrainstorming = BUILTIN_SKILLS.find(s => s.name === "brainstorming");
    expect(khadgarPrompt).toContain(builtinBrainstorming!.template);
  });

  it("project OpenCode skill takes precedence over global OpenCode skill", async () => {
    // Create both project and global OpenCode skills with same ID
    const projectSkillDir = path.join(testRoot, ".opencode", "skills");
    createFileSkill(
      projectSkillDir,
      "my-skill",
      "Project version",
      "# Project Version\n\nThis is the PROJECT version.",
    );

    const globalSkillDir = path.join(testRoot, ".config", "opencode", "skills");
    createFileSkill(
      globalSkillDir,
      "my-skill",
      "Global version",
      "# Global Version\n\nThis is the GLOBAL version.",
    );

    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            autoLoadSkills: ["my-skill"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();

    // Project version should be present
    expect(khadgarPrompt).toContain("# Project Version");
    expect(khadgarPrompt).toContain("This is the PROJECT version.");

    // Global version should NOT be present
    expect(khadgarPrompt).not.toContain("# Global Version");
    expect(khadgarPrompt).not.toContain("This is the GLOBAL version.");
  });

  it("preserves order of skills from autoLoadSkills config", async () => {
    // Create two custom skills
    const projectSkillDir = path.join(testRoot, ".opencode", "skills");
    createFileSkill(
      projectSkillDir,
      "skill-a",
      "First skill",
      "# Skill A Content",
    );
    createFileSkill(
      projectSkillDir,
      "skill-b",
      "Second skill",
      "# Skill B Content",
    );

    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            autoLoadSkills: ["skill-a", "skill-b"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();

    // Both skills should be present
    expect(khadgarPrompt).toContain("# Skill A Content");
    expect(khadgarPrompt).toContain("# Skill B Content");

    // Order should be preserved (A before B)
    const indexA = khadgarPrompt.indexOf("# Skill A Content");
    const indexB = khadgarPrompt.indexOf("# Skill B Content");
    expect(indexA).toBeLessThan(indexB);
  });

  it("disableSkills prevents injection of a file-based skill", async () => {
    // Create a file-based skill that would otherwise be loaded
    const projectSkillDir = path.join(testRoot, ".opencode", "skills");
    createFileSkill(
      projectSkillDir,
      "my-disabled-skill",
      "A skill that should be disabled",
      "# Disabled Skill\n\nThis should NOT appear because it's disabled.",
    );

    // Also create another skill that should NOT be disabled
    createFileSkill(
      projectSkillDir,
      "my-enabled-skill",
      "A skill that should remain enabled",
      "# Enabled Skill\n\nThis SHOULD appear.",
    );

    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        disableSkills: ["my-disabled-skill"],
        agents: {
          "khadgar": {
            autoLoadSkills: ["my-disabled-skill", "my-enabled-skill"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();

    // Disabled skill should NOT be present
    expect(khadgarPrompt).not.toContain("# Disabled Skill");
    expect(khadgarPrompt).not.toContain("This should NOT appear because it's disabled.");

    // Enabled skill should still be present
    expect(khadgarPrompt).toContain("# Enabled Skill");
    expect(khadgarPrompt).toContain("This SHOULD appear.");
  });

  it("invalid IDs do not throw and do not prevent other skills from loading", async () => {
    // Create a valid file-based skill
    const projectSkillDir = path.join(testRoot, ".opencode", "skills");
    createFileSkill(
      projectSkillDir,
      "valid-skill",
      "A valid skill",
      "# Valid Skill\n\nThis should load successfully.",
    );

    const configPath = path.join(testRoot, ".config", "opencode", "opencode_warcraft.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        agentMode: "unified",
        agents: {
          "khadgar": {
            // Include invalid IDs (path traversal, nonexistent) alongside valid skill
            autoLoadSkills: ["../traversal-attempt", "valid-skill", "nonexistent-skill-xyz"],
          },
        },
      }),
    );

    const ctx: any = {
      directory: testRoot,
      worktree: testRoot,
      serverUrl: new URL("http://localhost:1"),
      project: createProject(testRoot),
      client: OPENCODE_CLIENT,
    };

    // Should NOT throw even with invalid IDs
    const hooks = await plugin(ctx);
    const opencodeConfig: any = { agent: {} };
    await hooks.config!(opencodeConfig);

    const khadgarPrompt = opencodeConfig.agent["khadgar"]?.prompt as string;
    expect(khadgarPrompt).toBeDefined();

    // Valid skill should still be loaded despite invalid IDs in the list
    expect(khadgarPrompt).toContain("# Valid Skill");
    expect(khadgarPrompt).toContain("This should load successfully.");
  });
});
