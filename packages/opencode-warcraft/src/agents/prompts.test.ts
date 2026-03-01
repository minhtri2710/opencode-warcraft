import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import * as path from 'path';
import { ALGALON_PROMPT } from './algalon';
import { BRANN_PROMPT } from './brann';
import { KHADGAR_PROMPT } from './khadgar';
import { MEKKATORQUE_PROMPT } from './mekkatorque';
import { MIMIRON_PROMPT } from './mimiron';
import { SAURFANG_PROMPT } from './saurfang';

describe('Khadgar (Hybrid) prompt', () => {
  describe('delegation planning alignment', () => {
    it('contains the Canonical Delegation Threshold block', () => {
      expect(KHADGAR_PROMPT).toContain('### Canonical Delegation Threshold');
      expect(KHADGAR_PROMPT).toContain('cannot name the file path upfront');
      expect(KHADGAR_PROMPT).toContain('expect to inspect 2+ files');
      expect(KHADGAR_PROMPT).toContain('open-ended');
      expect(KHADGAR_PROMPT).toContain('Local `read/grep/glob`');
    });

    it('contains read-only exploration is allowed', () => {
      expect(KHADGAR_PROMPT).toContain('Read-only exploration is allowed');
    });

    it('does NOT contain the old planning iron law "Don\'t execute - plan only"', () => {
      expect(KHADGAR_PROMPT).not.toContain("- Don't execute - plan only");
    });

    it('explains task() is BLOCKING', () => {
      expect(KHADGAR_PROMPT).toContain('BLOCKING');
      expect(KHADGAR_PROMPT).toContain('returns when done');
    });

    it('includes internal codebase exploration in Research intent', () => {
      expect(KHADGAR_PROMPT).toContain('Internal codebase exploration');
    });

    it('routes trivial/simple intent to lightweight workflow path', () => {
      expect(KHADGAR_PROMPT).toContain('Lightweight workflow path');
      expect(KHADGAR_PROMPT).toContain('Workflow Path: lightweight');
    });

    it('includes task() guidance for research', () => {
      expect(KHADGAR_PROMPT).toContain('task(');
      expect(KHADGAR_PROMPT).toContain('brann');
    });
  });

  describe('turn termination and hard blocks', () => {
    it('defines turn termination rules', () => {
      expect(KHADGAR_PROMPT).toContain('### Turn Termination');
      expect(KHADGAR_PROMPT).toContain('Valid endings');
      expect(KHADGAR_PROMPT).toContain('NEVER end with');
    });

    it('separates hard blocks from anti-patterns', () => {
      expect(KHADGAR_PROMPT).toContain('### Hard Blocks');
      expect(KHADGAR_PROMPT).toContain('### Anti-Patterns');
    });
  });

  it('contains hard blocks section', () => {
    expect(KHADGAR_PROMPT).toContain('Hard Blocks');
  });

  it('contains turn termination', () => {
    expect(KHADGAR_PROMPT).toContain('Turn Termination');
  });

  it('contains docker-mastery skill reference', () => {
    expect(KHADGAR_PROMPT).toContain('docker-mastery');
  });

  it('contains agents-md-mastery skill reference', () => {
    expect(KHADGAR_PROMPT).toContain('agents-md-mastery');
  });
});

describe('Mimiron (Planner) prompt', () => {
  describe('delegation planning alignment', () => {
    it('allows read-only research delegation to Brann', () => {
      expect(MIMIRON_PROMPT).toContain('read-only research delegation to Brann is allowed');
    });

    it('permits research and review delegation via task()', () => {
      expect(MIMIRON_PROMPT).toContain(
        'You may use task() to delegate read-only research to Brann and plan review to Algalon.',
      );
      expect(MIMIRON_PROMPT).toContain('Never use task() to delegate implementation or coding work.');
    });

    it('does NOT contain the blanket prohibition "Delegate work or spawn workers"', () => {
      expect(MIMIRON_PROMPT).not.toContain('Delegate work or spawn workers');
    });

    it('contains the Canonical Delegation Threshold block', () => {
      expect(MIMIRON_PROMPT).toContain('### Canonical Delegation Threshold');
      expect(MIMIRON_PROMPT).toContain('cannot name the file path upfront');
      expect(MIMIRON_PROMPT).toContain('expect to inspect 2+ files');
      expect(MIMIRON_PROMPT).toContain('open-ended');
      expect(MIMIRON_PROMPT).toContain('Local `read/grep/glob`');
    });

    it('broadens research to include internal repo exploration', () => {
      expect(MIMIRON_PROMPT).toContain('internal codebase');
    });

    it('requires checklist and lightweight mini-record in plans', () => {
      expect(MIMIRON_PROMPT).toContain('Plan Review Checklist');
      expect(MIMIRON_PROMPT).toContain('Workflow Path: lightweight');
    });
  });

  it('contains expanded clearance checklist', () => {
    expect(MIMIRON_PROMPT).toContain('Test strategy confirmed');
    expect(MIMIRON_PROMPT).toContain('blocking questions outstanding');
  });

  it('contains turn termination rules', () => {
    expect(MIMIRON_PROMPT).toContain('Turn Termination');
    expect(MIMIRON_PROMPT).toContain('NEVER end with');
  });

  it('contains test strategy assessment', () => {
    expect(MIMIRON_PROMPT).toContain('Test Strategy');
  });
});

describe('Saurfang (Orchestrator) prompt', () => {
  describe('delegation planning alignment', () => {
    it('does NOT contain "Cancel background tasks before completion"', () => {
      expect(SAURFANG_PROMPT).not.toContain('Cancel background tasks before completion');
    });

    it('contains the replacement cancel rule about stale tasks', () => {
      expect(SAURFANG_PROMPT).toContain('Cancel background tasks only when stale or no longer needed');
    });

    it('explains task() is BLOCKING for delegation', () => {
      expect(SAURFANG_PROMPT).toContain('BLOCKING');
      expect(SAURFANG_PROMPT).toContain('returns when');
    });

    it('tells to check warcraft_status() after task() returns', () => {
      expect(SAURFANG_PROMPT).toContain('warcraft_status()');
    });

    it('includes task() guidance for research fan-out', () => {
      expect(SAURFANG_PROMPT).toContain('task() for research fan-out');
    });

    it('includes lightweight constraints and evidence reminder', () => {
      expect(SAURFANG_PROMPT).toContain('keep <=2 tasks');
      expect(SAURFANG_PROMPT).toContain('verification evidence');
    });
  });

  it('does NOT contain oracle reference', () => {
    expect(SAURFANG_PROMPT).not.toContain('oracle');
  });

  it('contains turn termination', () => {
    expect(SAURFANG_PROMPT).toContain('Turn Termination');
  });

  it('contains verification checklist', () => {
    expect(SAURFANG_PROMPT).toContain('After Delegation - VERIFY');
  });
});

describe('Mekkatorque (Worker/Coder) prompt', () => {
  it('contains resolve before blocking', () => {
    expect(MEKKATORQUE_PROMPT).toContain('Resolve Before Blocking');
    expect(MEKKATORQUE_PROMPT).toContain('tried 3');
  });

  it('contains completion checklist', () => {
    expect(MEKKATORQUE_PROMPT).toContain('Completion Checklist');
  });

  it('adds resolve-before-blocking guidance', () => {
    expect(MEKKATORQUE_PROMPT).toContain('## Resolve Before Blocking');
    expect(MEKKATORQUE_PROMPT).toContain('Default to exploration, questions are LAST resort');
    expect(MEKKATORQUE_PROMPT).toContain('Context inference: Before asking "what does X do?", READ X first.');
  });

  it('adds a completion checklist before reporting done', () => {
    expect(MEKKATORQUE_PROMPT).toContain('## Completion Checklist');
    expect(MEKKATORQUE_PROMPT).toContain('Record exact commands and results');
  });

  it('expands the orient step with explicit pre-flight actions', () => {
    expect(MEKKATORQUE_PROMPT).toContain('Read the referenced files and surrounding code');
    expect(MEKKATORQUE_PROMPT).toContain('Search for similar patterns in the codebase');
  });

  it('contains Docker Sandbox section in Iron Laws', () => {
    expect(MEKKATORQUE_PROMPT).toContain('Docker Sandbox');
  });

  it('instructs to report as blocked instead of HOST: escape', () => {
    expect(MEKKATORQUE_PROMPT).toContain('report as blocked');
    expect(MEKKATORQUE_PROMPT).not.toContain('HOST:');
  });

  it('contains docker-mastery skill reference', () => {
    expect(MEKKATORQUE_PROMPT).toContain('docker-mastery');
  });
});

describe('Brann (Explorer/Researcher) prompt', () => {
  it('has clean persistence example', () => {
    expect(BRANN_PROMPT).not.toContain('Worker Prompt Builder');
    expect(BRANN_PROMPT).toContain('research-{topic}');
  });

  it('mentions year awareness', () => {
    expect(BRANN_PROMPT).toContain('current year');
  });
});

describe('Algalon (Consultant/Reviewer) prompt', () => {
  it('contains agent-executable verification guidance', () => {
    expect(ALGALON_PROMPT).toContain('agent-executable');
  });

  it('contains verification examples', () => {
    expect(ALGALON_PROMPT).toContain('without human judgment');
  });
});

describe('README.md documentation', () => {
  const README_PATH = path.resolve(import.meta.dir, '..', '..', 'README.md');
  const readmeContent = readFileSync(README_PATH, 'utf-8');

  describe('delegation planning alignment', () => {
    it('contains the heading "### Planning-mode delegation"', () => {
      expect(readmeContent).toContain('### Planning-mode delegation');
    });

    it('explains task() delegation model', () => {
      expect(readmeContent).toContain('Delegate to Scout');
      expect(readmeContent).toContain('Read-only exploration');
    });

    it('clarifies that "don\'t execute" means "don\'t implement"', () => {
      expect(readmeContent).toContain("don't implement");
    });

    it('contains the Canonical Delegation Threshold content', () => {
      expect(readmeContent).toContain('cannot name the file path upfront');
      expect(readmeContent).toContain('2+ files');
    });
  });
});

describe('AGENTS.md tool guidance', () => {
  describe('Khadgar (Hybrid) prompt', () => {
    it('contains guidance to use warcraft_agents_md tool', () => {
      expect(KHADGAR_PROMPT).toContain('warcraft_agents_md');
    });

    it('instructs to sync AGENTS.md after feature completion', () => {
      expect(KHADGAR_PROMPT).toContain('feature completion');
      expect(KHADGAR_PROMPT).toContain('sync');
    });

    it('explains the init action for bootstrapping AGENTS.md', () => {
      expect(KHADGAR_PROMPT).toContain('init');
      expect(KHADGAR_PROMPT).toContain('AGENTS.md');
    });
  });

  describe('Saurfang (Orchestrator) prompt', () => {
    it('contains guidance to use warcraft_agents_md tool', () => {
      expect(SAURFANG_PROMPT).toContain('warcraft_agents_md');
    });

    it('instructs to sync AGENTS.md after batch completion', () => {
      expect(SAURFANG_PROMPT).toContain('batch');
      expect(SAURFANG_PROMPT).toContain('sync');
    });

    it('contains agents-md-mastery skill reference', () => {
      expect(SAURFANG_PROMPT).toContain('agents-md-mastery');
    });
  });
});
