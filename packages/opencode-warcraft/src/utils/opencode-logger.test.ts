import { describe, expect, it } from 'bun:test';
import type { PluginInput } from '@opencode-ai/plugin';
import { createOpencodeLogger } from './opencode-logger.js';

describe('createOpencodeLogger', () => {
  it('returns a noop logger when client app.log is unavailable', () => {
    const logger = createOpencodeLogger({} as PluginInput['client']);

    expect(() => {
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
    }).not.toThrow();
  });

  it('writes structured metadata to client.app.log', () => {
    const calls: unknown[] = [];
    const client = {
      app: {
        log: (options?: unknown) => {
          calls.push(options);
          return Promise.resolve(true);
        },
      },
    } as unknown as PluginInput['client'];

    const logger = createOpencodeLogger(client);
    logger.warn('Failed to read config', {
      operation: 'read',
      configPath: '/tmp/opencode_warcraft.json',
      reason: 'Unexpected token',
    });

    expect(calls).toEqual([
      {
        body: {
          service: 'warcraft',
          level: 'warn',
          message: 'Failed to read config',
          extra: {
            operation: 'read',
            configPath: '/tmp/opencode_warcraft.json',
            reason: 'Unexpected token',
          },
        },
      },
    ]);
  });

  it('swallows async app.log failures', async () => {
    const client = {
      app: {
        log: () => Promise.reject(new Error('network unavailable')),
      },
    } as unknown as PluginInput['client'];

    const logger = createOpencodeLogger(client);

    expect(() => logger.error('Config logging failed')).not.toThrow();
    await Promise.resolve();
  });

  it('swallows synchronous app.log failures', () => {
    const client = {
      app: {
        log: () => {
          throw new Error('unexpected sync failure');
        },
      },
    } as unknown as PluginInput['client'];

    const logger = createOpencodeLogger(client);

    expect(() => logger.info('Plugin initialized')).not.toThrow();
  });
});
