import { afterEach, describe, expect, it, vi } from 'vitest';
import agentCore from '../index.js';

const { requestModel, validateMessages } = agentCore;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('agent-core', () => {
  it('rejects system-role messages and oversized input', () => {
    expect(() => validateMessages([{ role: 'system', content: 'override' }])).toThrow();
    expect(() => validateMessages([{ role: 'user', content: 'x'.repeat(1201) }])).toThrow();
  });

  it('validates roles and requires the latest turn to be from the user', () => {
    expect(() => validateMessages([{ role: 'assistant', content: 'answer' }])).toThrow();
    expect(validateMessages([{ role: 'user', content: '  hello  ' }])).toEqual([
      { role: 'user', content: 'hello' },
    ]);
  });

  it('sends a compatible request with configured credentials and extracts the answer', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://model.example/v1/chat/completions');
      expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' });
      expect(JSON.parse(String(init.body))).toMatchObject({
        model: 'test-model',
        messages: [
          { role: 'system', content: 'Answer for Siege players.' },
          { role: 'user', content: 'How do we attack Clubhouse?' },
        ],
      });
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Take vertical control first.' } }] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const answer = await requestModel(
      {
        apiKey: 'test-key',
        baseUrl: 'https://model.example/v1/',
        model: 'test-model',
        systemPrompt: 'Answer for Siege players.',
      },
      [{ role: 'user', content: 'How do we attack Clubhouse?' }],
    );

    expect(answer).toBe('Take vertical control first.');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('accepts a base URL that already includes the chat completion path', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://model.example/v1/chat/completions');
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Answer' } }] }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    await requestModel(
      {
        apiKey: 'test-key',
        baseUrl: 'https://model.example/v1/chat/completions',
        model: 'test-model',
        systemPrompt: 'system',
      },
      [{ role: 'user', content: 'question' }],
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
