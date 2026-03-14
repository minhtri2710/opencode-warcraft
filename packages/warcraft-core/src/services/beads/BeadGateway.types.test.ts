import { describe, expect, it } from 'bun:test';
import { BeadGatewayError } from './BeadGateway.types.js';

describe('BeadGatewayError', () => {
  it('creates error with code and message', () => {
    const error = new BeadGatewayError('parse_error', 'Failed to parse');
    expect(error.code).toBe('parse_error');
    expect(error.message).toBe('Failed to parse');
    expect(error.name).toBe('BeadGatewayError');
  });

  it('creates error with optional internal code', () => {
    const error = new BeadGatewayError('command_failed', 'Command failed', 'BR_NOT_FOUND');
    expect(error.internalCode).toBe('BR_NOT_FOUND');
  });

  it('is instanceof Error', () => {
    const error = new BeadGatewayError('parse_error', 'test');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof BeadGatewayError).toBe(true);
  });

  it('has undefined internalCode when not provided', () => {
    const error = new BeadGatewayError('missing_field', 'Missing id');
    expect(error.internalCode).toBeUndefined();
  });

  it('stack trace is available', () => {
    const error = new BeadGatewayError('test', 'message');
    expect(error.stack).toBeDefined();
  });
});
