import { describe, expect, it } from 'bun:test';
import { DEFAULT_AGENT_MODELS, DEFAULT_WARCRAFT_CONFIG } from './defaults.js';

describe('defaults deep agent config', () => {
  describe('agent model strings are valid format', () => {
    it('khadgar model has provider/model format', () => {
      expect(DEFAULT_AGENT_MODELS.khadgar).toContain('/');
    });

    it('mimiron model has provider/model format', () => {
      expect(DEFAULT_AGENT_MODELS.mimiron).toContain('/');
    });

    it('saurfang model has provider/model format', () => {
      expect(DEFAULT_AGENT_MODELS.saurfang).toContain('/');
    });

    it('brann model has provider/model format', () => {
      expect(DEFAULT_AGENT_MODELS.brann).toContain('/');
    });

    it('mekkatorque model has provider/model format', () => {
      expect(DEFAULT_AGENT_MODELS.mekkatorque).toContain('/');
    });

    it('algalon model has provider/model format', () => {
      expect(DEFAULT_AGENT_MODELS.algalon).toContain('/');
    });
  });

  describe('config agent entries have model', () => {
    it('khadgar config has model', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.agents!.khadgar!.model).toBeDefined();
    });

    it('saurfang config has model', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.agents!.saurfang!.model).toBeDefined();
    });

    it('brann config has model', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.agents!.brann!.model).toBeDefined();
    });

    it('config has $schema', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.$schema).toBeDefined();
    });

    it('config has enableToolsFor', () => {
      expect(Array.isArray(DEFAULT_WARCRAFT_CONFIG.enableToolsFor)).toBe(true);
    });

    it('config has parallelExecution strategy', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.parallelExecution!.strategy).toBeDefined();
    });
  });
});
