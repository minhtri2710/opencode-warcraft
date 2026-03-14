import { describe, expect, it } from 'bun:test';
import { DEFAULT_AGENT_MODELS, DEFAULT_WARCRAFT_CONFIG } from './defaults.js';

describe('defaults more validation', () => {
  describe('DEFAULT_AGENT_MODELS', () => {
    it('has khadgar agent', () => {
      expect(DEFAULT_AGENT_MODELS.khadgar).toBeDefined();
    });

    it('has mimiron agent', () => {
      expect(DEFAULT_AGENT_MODELS.mimiron).toBeDefined();
    });

    it('has saurfang agent', () => {
      expect(DEFAULT_AGENT_MODELS.saurfang).toBeDefined();
    });

    it('has brann agent', () => {
      expect(DEFAULT_AGENT_MODELS.brann).toBeDefined();
    });

    it('has mekkatorque agent', () => {
      expect(DEFAULT_AGENT_MODELS.mekkatorque).toBeDefined();
    });

    it('has algalon agent', () => {
      expect(DEFAULT_AGENT_MODELS.algalon).toBeDefined();
    });

    it('each agent model is a non-empty string', () => {
      for (const [key, model] of Object.entries(DEFAULT_AGENT_MODELS)) {
        expect(typeof model).toBe('string');
        expect((model as string).length).toBeGreaterThan(0);
      }
    });

    it('has exactly 6 agents', () => {
      expect(Object.keys(DEFAULT_AGENT_MODELS)).toHaveLength(6);
    });
  });

  describe('DEFAULT_WARCRAFT_CONFIG', () => {
    it('has agents section', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.agents).toBeDefined();
    });

    it('has parallelExecution', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.parallelExecution).toBeDefined();
    });

    it('parallelExecution maxConcurrency is positive', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.parallelExecution!.maxConcurrency).toBeGreaterThan(0);
    });

    it('has beadsMode', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.beadsMode).toBeDefined();
    });

    it('beadsMode is on or off', () => {
      expect(['on', 'off']).toContain(DEFAULT_WARCRAFT_CONFIG.beadsMode);
    });

    it('has agentMode', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.agentMode).toBeDefined();
    });

    it('has sandbox setting', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.sandbox).toBeDefined();
    });
  });
});
