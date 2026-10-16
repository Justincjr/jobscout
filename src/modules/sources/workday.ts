import { z } from 'zod';
import { Source, State } from '../../shared/schema.js';
import { assert } from '../../shared/errors.js';
import { BoardJobs, common, plainText } from './index.js';
import { JsonRead } from './network.js';

export function parseWorkday(url: URL): Pick<Source, 'provider' | 'board' | 'url'> | null {
  const match = url.hostname.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i);
  if (!match) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (/^[a-z]{2}-[A-Z]{2}$/.test(parts[0] ?? '')) parts.shift();
  const site = parts[0];
  assert(site && /^[a-zA-Z0-9_-]{1,120}$/.test(site), 'Use the external Workday career-site URL, including its site name.');
  return { provider: 'workday', board: `${match[1]}/${site}`, url: `${url.origin}/${site}` };
}
const Listing = z.object({ total: z.number().int().min(0), jobPostings: z.array(z.object({ title: z.string(), externalPath: z.string(), locationsText: z.string().optional() })) });
const Detail = z.object({ jobPostingInfo: z.object({ title: z.string(), jobDescription: z.string(), jobReqId: z.string(), location: z.string().optional(), externalUrl: z.string().optional(), canApply: z.boolean().optional() }) });

export async function fetchWorkday(source: Source, get: JsonRead, state?: State): Promise<BoardJobs> {
  const parsed = parseWorkday(new URL(source.url));
  assert(parsed && parsed.board === source.board, 'Workday board identity does not match its approved URL.');
  const origin = new URL(source.url).origin, api = `${origin}/wday/cxs/${source.board}`;
  const listings: z.infer<typeof Listing>['jobPostings'] = [], paths = new Set<string>();
  let total: number | undefined;
  for (let offset = 0; offset < 2000; offset += 20) {
    const page = Listing.parse(await get(`${api}/jobs`, { method: 'POST', body: { appliedFacets: {}, limit: 20, offset, searchText: '' } }));
    total ??= page.total;
    assert(total === page.total && (page.jobPostings.length > 0 || offset >= total), 'Workday changed during pagination. Retry; no jobs were closed.', 502);
    for (const job of page.jobPostings) {
      assert(/^\/job\/[A-Za-z0-9_/%.,()+'-]+$/.test(job.externalPath) && !job.externalPath.includes('..') && !/%2f|%5c/i.test(job.externalPath) && !paths.has(job.externalPath), 'Workday returned invalid or repeated pagination.', 502);
      paths.add(job.externalPath); listings.push(job);
    }
    if (listings.length >= total) break;
  }
  const snapshots = new Map(state?.snapshots.map(s => [s.id, s]));
  const existing = new Map(state?.jobs.filter(j => j.sourceId === source.id).map(j => { const s = snapshots.get(j.snapshotId)!; return [s.url, { ...s, externalId: j.externalId }]; }));
  const jobs: BoardJobs = []; let fetched = 0;
  for (const item of listings) {
    const url = `${source.url}${item.externalPath}`, cached = existing.get(url);
    if (cached) { const { id: _id, hash: _hash, requirements: _requirements, analysis: _analysis, createdAt: _createdAt, ...incoming } = cached; jobs.push({ ...incoming, title: item.title, location: item.locationsText ?? incoming.location }); continue; }
    if (fetched >= 100) continue;
    const detail = Detail.parse(await get(`${api}${item.externalPath}`)).jobPostingInfo; fetched++;
    jobs.push({ ...common(detail.title, source.name, plainText(detail.jobDescription), detail.location ?? item.locationsText ?? null), externalId: detail.jobReqId, url, applyUrl: url });
  }
  jobs.complete = jobs.length === total && (total ?? 0) < 2000;
  if (!jobs.complete) jobs.warning = (total ?? 0) >= 2000 ? 'Workday reports a capped result set. Imported jobs are usable; absence cannot establish closure. Refresh again to import additional new details (100 per refresh).' : 'Imported up to 100 new posting details. Refresh again to continue. This partial refresh cannot close jobs.';
  return jobs;
}
