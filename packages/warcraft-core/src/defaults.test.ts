import { describe, expect, it } from 'bun:test';
import { DEFAULT_AGENT_MODELS, DEFAULT_WARCRAFT_CONFIG } from './defaults.js';

describe('defaults', () => {
  describe('DEFAULT_AGENT_MODELS', () => {
    it('defines models for all six agents', () => {
      expect(DEFAULT_AGENT_MODELS.khadgar).toBeDefined();
      expect(DEFAULT_AGENT_MODELS.mimiron).toBeDefined();
      expect(DEFAULT_AGENT_MODELS.saurfang).toBeDefined();
      expect(DEFAULT_AGENT_MODELS.brann).toBeDefined();
      expect(DEFAULT_AGENT_MODELS.mekkatorque).toBeDefined();
      expect(DEFAULT_AGENT_MODELS.algalon).toBeDefined();
    });

    it('uses provider/model format for all models', () => {
      for (const [, model] of Object.entries(DEFAULT_AGENT_MODELS)) {
        expect(model).toContain('/');
      }
    });
  });

  describe('DEFAULT_WARCRAFT_CONFIG', () => {
    it('has all required top-level fields', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.$schema).toBeDefined();
      expect(DEFAULT_WARCRAFT_CONFIG.enableToolsFor).toEqual([]);
      expect(DEFAULT_WARCRAFT_CONFIG.disableSkills).toEqual([]);
      expect(DEFAULT_WARCRAFT_CONFIG.disableMcps).toEqual([]);
      expect(DEFAULT_WARCRAFT_CONFIG.agentMode).toBe('unified');
      expect(DEFAULT_WARCRAFT_CONFIG.sandbox).toBe('none');
      expect(DEFAULT_WARCRAFT_CONFIG.beadsMode).toBe('on');
    });

    it('has parallelExecution with unbounded strategy and maxConcurrency 4', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.parallelExecution).toEqual({
        strategy: 'unbounded',
        maxConcurrency: 4,
      });
    });

    it('defines agent configs for all six agents', () => {
      const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
      expect(Object.keys(agents).sort()).toEqual(['algalon', 'brann', 'khadgar', 'mekkatorque', 'mimiron', 'saurfang']);
    });

    it('all agent configs have model and temperature', () => {
      const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
      for (const [_name, config] of Object.entries(agents)) {
        expect(config.model).toBeDefined();
        expect(typeof config.temperature).toBe('number');
        expect(config.temperature).toBeGreaterThanOrEqual(0);
        expect(config.temperature).toBeLessThanOrEqual(1);
      }
    });

    it('planner agents (khadgar, mimiron) have planning-related skills', () => {
      const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
      expect(agents.khadgar.skills).toContain('writing-plans');
      expect(agents.mimiron.skills).toContain('writing-plans');
      expect(agents.khadgar.skills).toContain('brainstorming');
      expect(agents.mimiron.skills).toContain('brainstorming');
    });

    it('worker agents have autoLoadSkills defined', () => {
      const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
      expect(agents.mekkatorque.autoLoadSkills).toBeDefined();
      expect(agents.mekkatorque.autoLoadSkills).toContain('test-driven-development');
    });

    it('khadgar and mimiron have parallel-exploration auto-loaded', () => {
      const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
      expect(agents.khadgar.autoLoadSkills).toContain('parallel-exploration');
      expect(agents.mimiron.autoLoadSkills).toContain('parallel-exploration');
    });

    it('brann has empty autoLoadSkills (leaf agent, no recursive delegation)', () => {
      const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
      expect(agents.brann.autoLoadSkills).toEqual([]);
    });

    it('agent models match DEFAULT_AGENT_MODELS', () => {
      const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
      expect(agents.khadgar.model).toBe(DEFAULT_AGENT_MODELS.khadgar);
      expect(agents.mimiron.model).toBe(DEFAULT_AGENT_MODELS.mimiron);
      expect(agents.saurfang.model).toBe(DEFAULT_AGENT_MODELS.saurfang);
      expect(agents.brann.model).toBe(DEFAULT_AGENT_MODELS.brann);
      expect(agents.mekkatorque.model).toBe(DEFAULT_AGENT_MODELS.mekkatorque);
      expect(agents.algalon.model).toBe(DEFAULT_AGENT_MODELS.algalon);
    });
  });
});
