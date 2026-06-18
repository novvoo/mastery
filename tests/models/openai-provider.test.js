import { afterEach, describe, expect, test } from 'bun:test';
import { OpenAIModelProvider } from '../../src/models/openai-provider.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenAIModelProvider request hygiene', () => {
  test('chat removes internal timeoutMs option from request body', async () => {
    let parsedBody;
    globalThis.fetch = async (url, options) => {
      parsedBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const provider = new OpenAIModelProvider('test-key', 'https://example.test/v1', 'test-model');
    const result = await provider.chat([{ role: 'user', content: 'hi' }], {
      timeoutMs: 1234,
      temperature: 0.2,
    });

    expect(result.text).toBe('ok');
    expect(parsedBody.timeoutMs).toBeUndefined();
    expect(parsedBody.temperature).toBe(0.2);
  });
});

