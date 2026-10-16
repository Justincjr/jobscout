import { z } from 'zod';
import { Source } from '../../shared/schema.js';
import { assert } from '../../shared/errors.js';
import { BoardJobs, common, plainText } from './index.js';
import { JsonRead } from './network.js';

export function parseShopee(url: URL): Pick<Source, 'provider' | 'board' | 'url'> | null {
  if (url.hostname !== 'careers.shopee.sg') return null;
  assert(/^\/jobs\/?$/.test(url.pathname), 'Use Shopee’s /jobs listing URL with the filters you want to follow.');
  const clean = new URL('https://careers.shopee.sg/jobs');
  for (const key of ['level', 'region_id', 'dept_id', 'name']) if (url.searchParams.has(key)) {
    const value = url.searchParams.get(key)!;
    assert(key === 'name' ? value.length <= 150 : /^\d+(,\d+)*$/.test(value), 'Shopee filters must use valid numeric IDs.');
    clean.searchParams.set(key, value);
  }
  clean.searchParams.sort();
  return { provider: 'shopee', board: `shopee${clean.search}`, url: clean.href };
}
const Post = z.object({ id: z.number(), job_id: z.string(), job_name: z.string(), job_description: z.string(), requirements: z.string(), sub_team_description: z.string().optional(), city_id: z.number().optional(), region_id: z.number().optional(), employment_id: z.number().optional() });
const Page = z.object({ code: z.literal(0), data: z.object({ total_count: z.number().int().min(0), job_list: z.array(Post) }) });
const Meta = z.object({ code: z.literal(0), data: z.object({ flat_locations: z.array(z.object({ city_id: z.number(), region_id: z.number().optional(), city_name: z.string(), region_name: z.string().optional() })).optional(), employment_level_list: z.array(z.object({ employment_level_id: z.number(), default_text: z.string() })).optional() }) });

export async function fetchShopee(source: Source, get: JsonRead): Promise<BoardJobs> {
  assert(parseShopee(new URL(source.url))?.board === source.board, 'Shopee filter identity does not match its approved URL.');
  const api = 'https://ats.workatsea.com/ats/api/v1/user';
  const meta = Meta.parse(await get(`${api}/meta/slice/?flags=2064&from_career=true`)).data;
  const selected = new URL(source.url).searchParams, query = new URLSearchParams();
  for (const [from, to] of [['level', 'employment_ids'], ['region_id', 'city_ids'], ['dept_id', 'department_ids'], ['name', 'search_content']]) {
    for (const value of (selected.has(from) ? from === 'name' ? [selected.get(from)!] : selected.get(from)!.split(',') : [])) query.append(to, value);
  }
  const result: BoardJobs = []; const ids = new Set<string>(); let total: number | undefined;
  for (let offset = 0; offset < 10000; offset += 50) {
    query.set('limit', '50'); query.set('offset', String(offset));
    const page = Page.parse(await get(`${api}/job/list/?${query}`)).data;
    total ??= page.total_count;
    assert(total === page.total_count && (page.job_list.length > 0 || offset >= total), 'Shopee changed during pagination. Refresh was not applied.', 502);
    for (const job of page.job_list) {
      assert(!ids.has(job.job_id), 'Shopee repeated a page. Refresh was not applied.', 502); ids.add(job.job_id);
      const location = meta.flat_locations?.find(l => l.city_id === job.city_id && (l.region_id === undefined || l.region_id === job.region_id));
      assert(/^[A-Za-z0-9_-]+$/.test(job.job_id), 'Shopee returned an invalid posting identifier.', 502);
      const url = `https://careers.shopee.sg/job-detail/${job.job_id}/1?channel=10001`;
      result.push({ ...common(job.job_name, source.name, plainText(`${job.sub_team_description ?? ''}\nResponsibilities\n${job.job_description}\nRequirements\n${job.requirements}`), location ? [...new Set([location.city_name, location.region_name].filter(Boolean))].join(', ') : null),
        externalId: job.job_id, url, applyUrl: url, seniority: meta.employment_level_list?.find(l => l.employment_level_id === job.employment_id)?.default_text ?? null });
    }
    if (result.length >= total) { assert(result.length === total, 'Shopee returned an inconsistent total.', 502); return result; }
  }
  assert(false, 'Shopee source exceeds the 10,000-posting limit. Add filters to its URL.', 502);
}
