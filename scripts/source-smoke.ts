import { readJson } from '../src/modules/sources/network.js';
import { fetchShopee, parseShopee } from '../src/modules/sources/shopee.js';
import { parseBoard } from '../src/modules/sources/index.js';
import { z } from 'zod';

// Explicit opt-in; published vacancies only, no AI requests or personal data.
const source = parseBoard('Shopee', 'https://careers.shopee.sg/jobs?level=4&limit=50&offset=0');
const jobs = await fetchShopee(source, readJson);
console.log(JSON.stringify({ source: source.provider, filter: parseShopee(new URL(source.url))!.url, postings: jobs.length, first: jobs[0] ? { title: jobs[0].title, location: jobs[0].location, seniority: jobs[0].seniority, url: jobs[0].url, descriptionCharacters: jobs[0].description.length } : null }));
const origin = 'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite';
const listed = z.object({ total: z.number(), jobPostings: z.array(z.object({ externalPath: z.string() })) }).parse(await readJson(`${origin}/jobs`, { method: 'POST', body: { appliedFacets: {}, limit: 1, offset: 0, searchText: '' } }));
const detail = z.object({ jobPostingInfo: z.object({ title: z.string(), jobDescription: z.string(), jobReqId: z.string() }) }).parse(await readJson(`${origin}${listed.jobPostings[0].externalPath}`));
console.log(JSON.stringify({ source: 'workday', reportedTotal: listed.total, first: { title: detail.jobPostingInfo.title, id: detail.jobPostingInfo.jobReqId, descriptionCharacters: detail.jobPostingInfo.jobDescription.length }, capped: listed.total >= 2000 }));
