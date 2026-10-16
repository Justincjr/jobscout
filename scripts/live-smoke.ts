import { config } from 'dotenv';
import { z } from 'zod';
import { structured, providerStatus } from '../src/providers/index.js';

config({ path: '.env.local', quiet: true });
let attempted = 0;
for (const provider of ['openai', 'anthropic'] as const) {
  if (!providerStatus()[provider]) { console.log(`${provider}: skipped (no server-side key configured)`); continue; }
  attempted++;
  const model = process.env[provider === 'openai' ? 'OPENAI_SMOKE_MODEL' : 'ANTHROPIC_SMOKE_MODEL'] ?? (provider === 'openai' ? 'gpt-4.1-mini' : 'claude-sonnet-5-5');
  try {
    const result = await structured({ provider, model }, z.strictObject({ ok: z.boolean() }), 'Return {"ok":true}. Connectivity check only; no personal data.', {});
    if (!result.value.ok) throw new Error('Connectivity response was false.');
    console.log(`${provider} / ${model}: passed (${result.input + result.output} tokens)`);
  } catch (error) { console.error(`${provider}: ${(error as Error).message}`); process.exitCode = 1; }
}
if (!attempted) console.log('No live requests were sent. Configure a key in .env.local to run live provider checks.');
