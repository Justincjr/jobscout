import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { providerError, sdkTransport, structured } from '../src/providers/index.js';
import { Selection } from '../src/shared/schema.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const schema = z.strictObject({ ok: z.boolean() });
describe.each(['openai', 'anthropic'] as const)('%s adapter contract', provider => {
  const selection: Selection = { provider, model: provider === 'openai' ? 'gpt-4.1-mini' : 'claude-sonnet-5-5' };
  it('validates structured results and records usage', async () => {
    const result = await structured(selection, schema, 'Test only', {}, async (s, jsonSchema) => {
      expect(s).toEqual(selection); expect(jsonSchema.additionalProperties).toBe(false);
      return { text: '{"ok":true}', input: 11, output: 5 };
    });
    expect(result).toEqual({ value: { ok: true }, input: 11, output: 5 });
  });
  it.each(['not JSON', '{"ok":"yes"}', '{"ok":true,"extra":1}'])('rejects malformed output %s', async text => {
    await expect(structured(selection, schema, 'Test', {}, async () => ({ text, input: 1, output: 1 }))).rejects.toMatchObject({ status: 502 });
  });
  it('uses official SDK request shapes with no tools or fallback', async () => {
    vi.stubEnv(provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY', 'test-only-placeholder');
    const payload = provider === 'openai' ? {
      id: 'resp_test', object: 'response', status: 'completed', output: [{ id: 'msg_test', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}', annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
    } : { id: 'msg_test', type: 'message', role: 'assistant', model: selection.model, content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 4 } };
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit) => {
      expect(String(_url)).toMatch(provider === 'openai' ? /^https:\/\/api\.openai\.com\/v1\/responses/ : /^https:\/\/api\.anthropic\.com\/v1\/messages/);
      expect(init.redirect).toBe('error');
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe(selection.model); expect(body.tools).toBeUndefined();
      if (provider === 'openai') { expect(body.store).toBe(false); expect(body.text.format.type).toBe('json_schema'); }
      else expect(body.output_config.format.type).toBe('json_schema');
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await structured(selection, schema, 'Test', {});
    expect(result.value.ok).toBe(true); expect(result.input).toBe(10); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it('reports missing keys without requiring the other provider', async () => {
    vi.stubEnv(provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY', '');
    await expect(sdkTransport(selection, {}, 'Test', {})).rejects.toThrow('Set ');
  });
  it('handles refusals and truncated output without parsing as success', async () => {
    vi.stubEnv(provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY', 'test-only-placeholder');
    const response = provider === 'openai' ? { id: 'resp_test', status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }] } : { stop_reason: 'refusal', content: [], usage: { input_tokens: 1, output_tokens: 1 } };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } }));
    await expect(structured(selection, schema, 'Test', {})).rejects.toMatchObject({ status: 422 });
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(provider === 'openai' ? { status: 'incomplete', output: [] } : { stop_reason: 'max_tokens', content: [] }), { headers: { 'Content-Type': 'application/json' } }));
    await expect(structured(selection, schema, 'Test', {})).rejects.toMatchObject({ status: 502 });
  });
});
describe('safe provider errors', () => {
  it.each([[401, 'INVALID_KEY'], [403, 'INVALID_KEY'], [400, 'INVALID_MODEL'], [404, 'INVALID_MODEL'], [429, 'RATE_LIMIT'], [500, 'PROVIDER_FAILED']])('normalizes %s without exposing provider bodies', (status, code) => {
    const result = providerError({ status, message: 'private resume and credential' });
    expect(result.code).toBe(code); expect(result.message).not.toContain('private resume');
  });
  it('normalizes timeouts', () => expect(providerError({ name: 'APIConnectionTimeoutError' }).code).toBe('TIMEOUT'));
});
