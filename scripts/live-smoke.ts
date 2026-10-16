import { config } from 'dotenv';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { structured, providerStatus } from '../src/providers/index.js';
import { parseState } from '../src/storage/repository.js';

config({ path: '.env.local', quiet: true });
const projectRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const stateFile = path.join(projectRoot, process.env.SCOUT_DATA_DIR ?? 'data', 'job-scout.json');
const { settings } = parseState(await fs.readFile(stateFile, 'utf8'));

let attempted = 0;
for (const provider of ['openai', 'anthropic'] as const) {
  if (!providerStatus()[provider]) { console.log(`${provider}: skipped (no server-side key configured)`); continue; }
  if (settings.provider !== provider) { console.log(`${provider}: skipped (app is configured to use ${settings.provider})`); continue; }
  attempted++;
  const model = settings.model;
  try {
    const result = await structured({ provider, model }, z.strictObject({ ok: z.boolean() }), 'Return {"ok":true}. Connectivity check only; no personal data.', {});
    if (!result.value.ok) throw new Error('Connectivity response was false.');
    console.log(`${provider} / ${model}: passed (${result.input + result.output} tokens)`);
  } catch (error) { console.error(`${provider}: ${(error as Error).message}`); process.exitCode = 1; }
}
if (!attempted) console.log('No live requests were sent. Configure a key in .env.local and set a provider/model in app settings to run live provider checks.');
