import { randomUUID, createHash } from 'node:crypto';
import { decode } from 'he';
import { z } from 'zod';
import { Source, Snapshot, State, Requirement } from '../../shared/schema.js';
import { AppError, assert } from '../../shared/errors.js';
import { stageNewRanking } from '../matching/ranking.js';
import { publicUrl, readJson, JsonRead } from './network.js';
import { parseWorkday, fetchWorkday } from './workday.js';
import { parseShopee, fetchShopee } from './shopee.js';
import { fetchWebsite } from './website.js';
import { fetchAshby } from './ashby.js';
export { privateAddress } from './network.js';

export const starterBoards = [
  { name: 'Stripe', url: 'https://boards.greenhouse.io/stripe' },
  { name: 'Figma', url: 'https://boards.greenhouse.io/figma' },
  { name: 'Plaid', url: 'https://jobs.ashbyhq.com/plaid' },
  { name: 'Shopee', url: 'https://careers.shopee.sg/jobs?level=4' },
];
const hosts: Record<string, Source['provider']> = {
  'boards.greenhouse.io': 'greenhouse', 'job-boards.greenhouse.io': 'greenhouse',
  'jobs.lever.co': 'lever', 'jobs.eu.lever.co': 'lever-eu',
  'jobs.ashbyhq.com': 'ashby',
};

export function parseBoard(name: string, input: string): Source {
  const url = publicUrl(input);
  const workday = parseWorkday(url);
  const shopee = parseShopee(url);
  if (workday || shopee) return { id: randomUUID(), name, ...(workday ?? shopee)!, lastSuccess: null, lastAttempt: null, error: null, complete: false, enabled: true };
  const board = url.pathname.split('/').filter(Boolean)[0];
  const provider = hosts[url.hostname];
  if (!provider) {
    assert(!/greenhouse|lever\.co|ashbyhq|myworkdayjobs|myworkdaysite|shopee/i.test(url.hostname), 'This career hostname is not supported. Use the official board URL.');
    url.hash = '';
    return { id: randomUUID(), name, provider: 'website', board: createHash('sha256').update(url.href).digest('hex'), url: url.href, lastSuccess: null, lastAttempt: null, error: null, complete: false, enabled: true };
  }
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.port && provider && board && /^[a-zA-Z0-9_-]{1,100}$/.test(board),
    'This site is not supported. Use a public Greenhouse, Lever, or Ashby board URL, or paste a job description.');
  return { id: randomUUID(), name, provider, board, url: `https://${url.hostname}/${board}`, lastSuccess: null, lastAttempt: null, error: null, complete: false, enabled: true };
}

export function plainText(input: string): string {
  return decode(decode(input).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|li|div|h[1-6])\s*>|<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
export function safeUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function localRequirements(description: string): Requirement[] {
  let category: Requirement['category'] = 'unclear';
  const result: Requirement[] = [];
  for (const raw of description.split(/\n|(?<=[.;])\s+/)) {
    const text = raw.replace(/^[•*\-]\s*/, '').trim();
    if (/preferred|nice to have|bonus|ideally/i.test(text)) category = 'preferred';
    else if (/requirements|qualifications|must have|you bring/i.test(text)) category = 'required';
    else if (/responsibilities|what you.ll do/i.test(text)) category = 'experience';
    if (text.length < 12 || text.length > 2000) continue;
    if (/experience|proficien|knowledge|ability|build|develop|design|lead|manage|python|typescript|javascript|react|sql|java\b|golang|aws|kubernetes|degree|certif/i.test(text)) {
      result.push({ id: randomUUID(), text, excerpt: text, category: /\b\d+\+? years?|senior|leadership/i.test(text) ? 'experience' : category });
    }
    if (result.length >= 80) break;
  }
  return result;
}

export type IncomingJob = Omit<Snapshot, 'id' | 'hash' | 'createdAt' | 'requirements' | 'analysis'> & { externalId: string };
export function makeSnapshot(job: IncomingJob): Snapshot {
  const { externalId: _externalId, ...content } = job;
  return { ...content, id: randomUUID(), hash: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    createdAt: new Date().toISOString(), requirements: localRequirements(job.description), analysis: null };
}

const greenhouseJob = z.object({ id: z.number(), title: z.string(), content: z.string(), absolute_url: z.string(), location: z.object({ name: z.string() }).nullish() });
const leverJob = z.object({
  id: z.string(), text: z.string(), descriptionPlain: z.string().optional(), description: z.string().optional(),
  additionalPlain: z.string().optional(), lists: z.array(z.object({ text: z.string(), content: z.string() })).optional(),
  categories: z.object({ location: z.string().optional() }).optional(), hostedUrl: z.string(), applyUrl: z.string(),
  workplaceType: z.string().optional(), salaryRange: z.object({ min: z.number(), max: z.number(), currency: z.string(), interval: z.string() }).nullish(),
});
export function common(title: string, company: string, description: string, location: string | null): Omit<IncomingJob, 'externalId' | 'url' | 'applyUrl'> {
  return { title, company, description, location, workMode: null, seniority: title.match(/\b(intern|junior|senior|staff|principal|director|lead)\b/i)?.[0].toLowerCase() ?? null,
    salaryMin: null, salaryMax: null, currency: null, workAuthorization: null };
}
export function normalizeGreenhouse(data: unknown, source: Source): IncomingJob[] {
  const parsed = z.object({ jobs: z.array(greenhouseJob), meta: z.object({ total: z.number() }) }).parse(data);
  assert(parsed.jobs.length === parsed.meta.total, 'The board returned an incomplete result. Existing jobs were kept active.', 502);
  return parsed.jobs.map(j => ({ ...common(j.title, source.name, plainText(j.content), j.location?.name || null),
    externalId: String(j.id), url: safeUrl(j.absolute_url), applyUrl: safeUrl(j.absolute_url) }));
}
export function normalizeLever(data: unknown, source: Source): IncomingJob[] {
  return z.array(leverJob).parse(data).map(j => ({
    ...common(j.text, source.name, plainText([j.descriptionPlain ?? j.description, ...j.lists?.map(l => `${l.text}\n${l.content}`) ?? [], j.additionalPlain].filter(Boolean).join('\n\n')), j.categories?.location || null),
    externalId: j.id, url: safeUrl(j.hostedUrl), applyUrl: safeUrl(j.applyUrl),
    workMode: ['remote', 'hybrid', 'onsite'].includes(j.workplaceType ?? '') ? j.workplaceType as Snapshot['workMode'] : null,
    salaryMin: j.salaryRange?.interval === 'per-year-salary' ? j.salaryRange.min : null,
    salaryMax: j.salaryRange?.interval === 'per-year-salary' ? j.salaryRange.max : null,
    currency: j.salaryRange?.interval === 'per-year-salary' ? j.salaryRange.currency : null,
  }));
}

export async function publicJson(url: string, options?: Parameters<JsonRead>[1]): Promise<unknown> {
  const parsed = new URL(url);
  assert(['boards-api.greenhouse.io', 'api.lever.co', 'api.eu.lever.co', 'api.ashbyhq.com', 'ats.workatsea.com'].includes(parsed.hostname) || /^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(parsed.hostname), 'Network destination is not permitted.');
  // Greenhouse returns every full description in one response, including large boards.
  return readJson(url, { ...options, maxBytes: parsed.hostname === 'boards-api.greenhouse.io' ? 20_000_000 : options?.maxBytes });
}

export function migrateLegacyBoards(state: State): boolean {
  let changed = false;
  for (const source of state.sources) {
    if (source.provider !== 'lever' || source.board !== 'plaid' || source.url !== 'https://jobs.lever.co/plaid' || state.jobs.some(job => job.sourceId === source.id)) continue;
    source.provider = 'ashby'; source.url = 'https://jobs.ashbyhq.com/plaid'; source.complete = false;
    changed = true;
  }
  return changed;
}

export type BoardJobs = IncomingJob[] & { complete?: boolean; warning?: string };
export async function fetchBoard(source: Source, get: JsonRead = publicJson, state?: State): Promise<BoardJobs> {
  if (source.provider === 'workday') return fetchWorkday(source, get, state);
  if (source.provider === 'shopee') return fetchShopee(source, get);
  if (source.provider === 'ashby') return fetchAshby(source, get);
  if (source.provider === 'website') return fetchWebsite(source, undefined, state);
  if (source.provider === 'greenhouse') return normalizeGreenhouse(await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.board)}/jobs?content=true`), source);
  const result: IncomingJob[] = [];
  const host = source.provider === 'lever-eu' ? 'api.eu.lever.co' : 'api.lever.co';
  for (let skip = 0; skip <= 10000; skip += 100) {
    const data = await get(`https://${host}/v0/postings/${encodeURIComponent(source.board)}?mode=json&limit=100&skip=${skip}`);
    const page = normalizeLever(data, source);
    if (page.some(job => result.some(existing => existing.externalId === job.externalId))) throw new AppError(502, 'Source pagination repeated results. Refresh was not applied.');
    result.push(...page);
    if (page.length < 100) return result;
  }
  throw new AppError(502, 'Board exceeds the refresh capacity. Refresh was not applied.');
}

export function ingest(state: State, sourceId: string, incoming: IncomingJob[], complete: boolean): void {
  const source = state.sources.find(s => s.id === sourceId);
  assert(source, 'Company board no longer exists.');
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const byExternal = new Map(state.jobs.filter(j => j.sourceId === sourceId).map(j => [j.externalId, j]));
  const snapshotsById = new Map(state.snapshots.map(s => [s.id, s]));
  const duplicateKey = (s: Pick<Snapshot, 'company' | 'title' | 'location' | 'applyUrl'>) => JSON.stringify([s.company.toLowerCase(), s.title.toLowerCase(), s.location, s.applyUrl]);
  const duplicateIndex = new Map(state.jobs.map(j => [duplicateKey(snapshotsById.get(j.snapshotId)!), j.id]));
  for (const raw of incoming) {
    if (seen.has(raw.externalId)) continue;
    seen.add(raw.externalId);
    const snapshot = makeSnapshot(raw);
    let job = byExternal.get(raw.externalId);
    if (!job) {
      const duplicate = duplicateIndex.get(duplicateKey(raw));
      job = { id: randomUUID(), sourceId, externalId: raw.externalId, snapshotId: snapshot.id, firstSeen: now, lastSeen: now, active: true, missingCount: 0, possibleDuplicate: duplicate ?? null };
      state.jobs.push(job);
      state.snapshots.push(snapshot);
      stageNewRanking(state, job.id, snapshot.id);
      duplicateIndex.set(duplicateKey(raw), job.id);
    } else if (snapshotsById.get(job.snapshotId)?.hash !== snapshot.hash) {
      state.snapshots.push(snapshot);
      job.snapshotId = snapshot.id;
    }
    job.lastSeen = now; job.active = true; job.missingCount = 0;
  }
  if (complete) for (const job of state.jobs.filter(j => j.sourceId === sourceId && !seen.has(j.externalId))) {
    job.missingCount += 1;
    if (job.missingCount >= 2) job.active = false;
  }
  const pinned = new Set([...state.drafts.map(d => d.snapshotId), ...state.jobs.map(j => j.snapshotId), ...state.rankings.map(r => r.snapshotId), ...state.submissions.map(p => p.snapshotId)]);
  const recent = new Set(state.snapshots.slice(-500).map(s => s.id));
  state.snapshots = state.snapshots.filter(s => pinned.has(s.id) || recent.has(s.id));
  const retained = new Set(state.snapshots.map(s => s.id));
  state.matches = state.matches.filter(m => retained.has(m.snapshotId));
  source.lastAttempt = now; source.lastSuccess = now; source.error = null; source.complete = complete;
}
