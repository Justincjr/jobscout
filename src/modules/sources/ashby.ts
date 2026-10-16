import { z } from 'zod';
import { Source } from '../../shared/schema.js';
import { assert } from '../../shared/errors.js';
import { common, IncomingJob, plainText, safeUrl } from './index.js';
import { JsonRead } from './network.js';

const posting = z.object({
  title: z.string(), location: z.string().nullish(), secondaryLocations: z.array(z.object({ location: z.string() })).optional(),
  descriptionPlain: z.string().optional(), descriptionHtml: z.string().optional(),
  jobUrl: z.string(), applyUrl: z.string(), isListed: z.boolean(),
  workplaceType: z.enum(['Remote', 'Hybrid', 'OnSite']).optional(), isRemote: z.boolean().optional(),
});

export async function fetchAshby(source: Source, get: JsonRead): Promise<IncomingJob[]> {
  const data = z.object({ apiVersion: z.literal('1'), jobs: z.array(posting) }).parse(
    await get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(source.board)}`));
  const seen = new Set<string>();
  return data.jobs.filter(job => job.isListed).map(job => {
    const url = safeUrl(job.jobUrl), applyUrl = safeUrl(job.applyUrl);
    assert(url && applyUrl, 'Ashby returned an invalid posting link. Refresh was not applied.', 502);
    const parsed = new URL(url), parts = parsed.pathname.split('/').filter(Boolean);
    assert(parsed.hostname === 'jobs.ashbyhq.com' && parts.length === 2 && parts[0] === source.board && /^[a-zA-Z0-9_-]{1,100}$/.test(parts[1]), 'Ashby returned an unexpected posting identity. Refresh was not applied.', 502);
    const externalId = parts[1];
    assert(!seen.has(externalId), 'Ashby returned duplicate postings. Refresh was not applied.', 502); seen.add(externalId);
    const description = job.descriptionPlain ?? plainText(job.descriptionHtml ?? '');
    assert(description.trim(), 'Ashby returned a posting without a description. Refresh was not applied.', 502);
    const location = [...new Set([job.location, ...job.secondaryLocations?.map(l => l.location) ?? []].filter(Boolean))].join('; ') || null;
    return { ...common(job.title, source.name, description, location), externalId, url, applyUrl,
      workMode: job.workplaceType ? ({ Remote: 'remote', Hybrid: 'hybrid', OnSite: 'onsite' } as const)[job.workplaceType] : job.isRemote ? 'remote' : null };
  });
}
