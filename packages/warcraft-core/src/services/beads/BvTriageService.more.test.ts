import { describe, expect, it } from 'bun:test';
import { createNoopLogger } from '../../utils/logger.js';
import { BvTriageService } from './BvTriageService.js';

describe('BvTriageService comprehensive', () => {
  const logger = createNoopLogger();

  it('constructor accepts logger', () => {
    const service = new BvTriageService(logger);
    expect(service).toBeDefined();
  });

  it('has getHealth method', () => {
    const service = new BvTriageService(logger);
    expect(typeof service.getHealth).toBe('function');
  });

  it('getHealth returns health object', () => {
    const service = new BvTriageService(logger);
    const health = service.getHealth();
    expect(health).toBeDefined();
    expect(typeof health).toBe('object');
  });

  it('has getBlockerTriage method', () => {
    const service = new BvTriageService(logger);
    expect(typeof service.getBlockerTriage).toBe('function');
  });

  it('getBlockerTriage returns null for unknown bead', () => {
    const service = new BvTriageService(logger);
    const result = service.getBlockerTriage('nonexistent-bead-id');
    expect(result).toBeNull();
  });
});
