import { describe, expect, it } from 'bun:test';
import type { Hooks, PluginInput } from '@opencode-ai/plugin';

import CopilotMessage, { CopilotMessage as NamedCopilotMessage } from './index.js';

type TransformHook = NonNullable<Hooks['experimental.chat.messages.transform']>;

describe('CopilotMessage plugin', () => {
  const ctx = {} as PluginInput;

  it('exports named and default plugin', () => {
    expect(typeof CopilotMessage).toBe('function');
    expect(CopilotMessage).toBe(NamedCopilotMessage);
  });

  it('registers the experimental chat messages transform hook', async () => {
    const hooks = await CopilotMessage(ctx);

    expect(hooks['experimental.chat.messages.transform']).toBeDefined();
    expect(typeof hooks['experimental.chat.messages.transform']).toBe('function');
  });

  it('continues when message role is not user', async () => {
    const hooks = await CopilotMessage(ctx);
    const transformHook = hooks['experimental.chat.messages.transform'] as TransformHook;

    const output = {
      messages: [
        {
          info: { role: 'assistant', id: 'a-1' },
          parts: [{ type: 'text', text: 'response' }],
        },
      ],
    };

    await transformHook({}, output);

    expect(output.messages[0].parts).toEqual([{ type: 'text', text: 'response' }]);
  });

  it('sets message role to assistant for github-copilot user messages', async () => {
    const hooks = await CopilotMessage(ctx);
    const transformHook = hooks['experimental.chat.messages.transform'] as TransformHook;

    const output = {
      messages: [
        {
          info: {
            role: 'user',
            model: { providerID: 'github-copilot' },
            id: 'u-2',
          },
          parts: [{ type: 'text', text: 'copilot response' }],
        },
      ],
    };

    await transformHook({}, output);

    expect(output.messages[0].info.role).toBe('assistant');
    expect(output.messages[0].parts).toEqual([{ type: 'text', text: 'copilot response' }]);
  });
});
