import { describe, expect, it } from 'bun:test';
import { DEFAULT_AGENT_MODELS, DEFAULT_WARCRAFT_CONFIG } from './defaults.js';

describe('defaults extra edge cases', () => {
  describe('DEFAULT_AGENT_MODELS', () => {
    it('khadgar and mimiron use the same model', () => {
      expect(DEFAULT_AGENT_MODELS.khadgar).toBe(DEFAULT_AGENT_MODELS.mimiron);
    });

    it('saurfang uses the same model as khadgar', () => {
      expect(DEFAULT_AGENT_MODELS.saurfang).toBe(DEFAULT_AGENT_MODELS.khadgar);
    });

    it('brann uses a different model from khadgar', () => {
      expect(DEFAULT_AGENT_MODELS.brann).not.toBe(DEFAULT_AGENT_MODELS.khadgar);
    });

    it('mekkatorque uses a different model from khadgar', () => {
      expect(DEFAULT_AGENT_MODELS.mekkatorque).not.toBe(DEFAULT_AGENT_MODELS.khadgar);
    });

    it('algalon uses a different model from khadgar', () => {
      expect(DEFAULT_AGENT_MODELS.algalon).not.toBe(DEFAULT_AGENT_MODELS.khadgar);
    });
  });

  describe('DEFAULT_WARCRAFT_CONFIG', () => {
    it('$schema points to a URL', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.$schema).toStartWith('https://');
    });

    it('enableToolsFor is an empty array by default', () => {
      expect(DEFAULT_WARCRAFT_CONFIG.enableToolsFor).toEqual([]);
    });

    it('saurfang has dispatching and executing skills', () => {
      const saurfang = DEFAULT_WARCRAFT_CONFIG.agents!.saurfang;
      expect(saurfang.skills).toContain('dispatching-parallel-agents');
      expect(saurfang.skills).toContain('executing-plans');
    });

    it('algalon has debugging and code review skills', () => {
      const algalon = DEFAULT_WARCRAFT_CONFIG.agents!.algalon;
      expect(algalon.skills).toContain('systematic-debugging');
      expect(algalon.skills).toContain('code-reviewer');
    });

    it('brann has highest temperature (creative agent)', () => {
      const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
      const brannTemp = agents.brann.temperature!;
      for (const [name, config] of Object.entries(agents)) {
        if (name !== 'brann') {
          expect(brannTemp).toBeGreaterThanOrEqual(config.temperature!);
        }
      }
    });

    it('mimiron has lower temperature than khadgar', () => {
      const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
      expect(agents.mimiron.temperature).toBeLessThanOrEqual(agents.khadgar.temperature!);
    });

    it('all agents have defined autoLoadSkills array', () => {
      const agents = DEFAULT_WARCRAFT_CONFIG.agents!;
      for (const config of Object.values(agents)) {
        expect(Array.isArray(config.autoLoadSkills)).toBe(true);
      }
    });
  });
});
