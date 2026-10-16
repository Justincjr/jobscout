import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseBoard } from '../src/modules/sources/index.js';
import { fetchWorkday } from '../src/modules/sources/workday.js';
import { fetchShopee } from '../src/modules/sources/shopee.js';
import { candidateLinks, fetchWebsite, htmlJob, robotsPolicy, structuredJobs } from '../src/modules/sources/website.js';
import { privateAddress, publicUrl } from '../src/modules/sources/network.js';
import { confirmedState } from './helpers.js';
import { AppError } from '../src/shared/errors.js';

describe('Workday', () => {
  it('does not refetch full details for a posting already imported from the same source', async () => {
    const state = confirmedState(), source = parseBoard('Acme', 'https://acme.wd1.myworkdayjobs.com/External'); state.sources.push(source);
    const snapshotId = randomUUID(), now = new Date().toISOString();
    const { makeSnapshot } = await import('../src/modules/sources/index.js');
    const { incoming } = await import('./helpers.js');
    const snapshot = makeSnapshot(incoming({ url: source.url + '/job/Engineer_JR1' }));
    state.snapshots.push(snapshot); state.jobs.push({ id: snapshotId, sourceId: source.id, externalId: 'JR1', snapshotId: snapshot.id, firstSeen: now, lastSeen: now, active: true, missingCount: 0, possibleDuplicate: null });
    let calls = 0;
    const result = await fetchWorkday(source, async url => { calls++; expect(url).toMatch(/\/jobs$/); return { total: 1, jobPostings: [{ title: 'Engineer', externalPath: '/job/Engineer_JR1', locationsText: 'Singapore' }] }; }, state);
    expect(calls).toBe(1); expect(result[0].description).toBe(snapshot.description); expect(result.complete).toBe(true);
  });
  it('parses a canonical site identity from localized and detail URLs', () => {
    const source = parseBoard('NVIDIA', 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US/Test_1');
    expect(source.provider).toBe('workday'); expect(source.board).toBe('nvidia/NVIDIAExternalCareerSite');
    expect(source.url).toBe('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');
  });
  it('paginates lists and imports full descriptions with stable requisition IDs', async () => {
    const source = parseBoard('Acme', 'https://acme.wd5.myworkdayjobs.com/External');
    let pages = 0, details = 0;
    const jobs = await fetchWorkday(source, async (url, options) => {
      if (url.endsWith('/jobs')) {
        expect(options?.method).toBe('POST'); pages++;
        const offset = (options?.body as { offset: number }).offset;
        return { total: 21, jobPostings: Array.from({ length: offset ? 1 : 20 }, (_, i) => ({ title: 'Engineer', externalPath: `/job/Singapore/Engineer_JR${offset + i}`, locationsText: 'Singapore' })) };
      }
      details++; return { jobPostingInfo: { title: 'Engineer', jobDescription: '<p>Build React applications for the product team.</p>', jobReqId: url.split('_').at(-1), location: 'Singapore' } };
    });
    expect(pages).toBe(2); expect(details).toBe(21); expect(jobs).toHaveLength(21); expect(jobs.complete).toBe(true);
    expect(jobs[0].externalId).toBe('JR0'); expect(jobs[0].description).not.toContain('<p>');
  });
  it('rejects a hostile detail path and changing totals without returning a complete result', async () => {
    const source = parseBoard('Acme', 'https://acme.wd1.myworkdayjobs.com/External');
    await expect(fetchWorkday(source, async () => ({ total: 1, jobPostings: [{ title: 'X', externalPath: '//127.0.0.1/private' }] }))).rejects.toThrow('invalid');
    let calls = 0;
    await expect(fetchWorkday(source, async () => { calls++; return { total: calls === 1 ? 25 : 26, jobPostings: [{ title: 'X', externalPath: '/job/one' }] }; })).rejects.toThrow('changed');
  });
  it('caps new detail requests and explicitly labels a partial import', async () => {
    const source = parseBoard('Acme', 'https://acme.wd1.myworkdayjobs.com/External');
    const jobs = await fetchWorkday(source, async (url, options) => {
      if (url.endsWith('/jobs')) { const offset = (options?.body as { offset: number }).offset; return { total: 101, jobPostings: Array.from({ length: Math.min(20, 101 - offset) }, (_, i) => ({ title: 'Engineer', externalPath: `/job/Test_JR${offset + i}` })) }; }
      return { jobPostingInfo: { title: 'Engineer', jobDescription: 'A full job description for a React engineer.', jobReqId: url.split('_').at(-1) } };
    });
    expect(jobs).toHaveLength(100); expect(jobs.complete).toBe(false); expect(jobs.warning).toContain('100');
  });
});

describe('Shopee', () => {
  it('preserves filters while normalizing pagination out of source identity', () => {
    const a = parseBoard('Shopee', 'https://careers.shopee.sg/jobs?level=4&limit=50&offset=0');
    const b = parseBoard('Shopee', 'https://careers.shopee.sg/jobs?offset=50&level=4');
    expect(a.board).toBe(b.board); expect(a.url).toBe('https://careers.shopee.sg/jobs?level=4');
    expect(parseBoard('Shopee', 'https://careers.shopee.sg/jobs?level=1').board).not.toBe(a.board);
  });
  it('maps website filters to the real feed parameters, paginates and resolves metadata', async () => {
    const source = parseBoard('Shopee', 'https://careers.shopee.sg/jobs?level=4&region_id=2');
    let pages = 0;
    const result = await fetchShopee(source, async url => {
      if (url.includes('/meta/')) return { code: 0, data: { flat_locations: [{ city_id: 2, city_name: 'Singapore', region_name: 'Singapore' }], employment_level_list: [{ employment_level_id: 4, default_text: 'Internship' }] } };
      const params = new URL(url).searchParams;
      expect(params.get('employment_ids')).toBe('4'); expect(params.get('city_ids')).toBe('2');
      const offset = Number(params.get('offset')); pages++;
      return { code: 0, data: { total_count: 51, job_list: Array.from({ length: offset ? 1 : 50 }, (_, i) => ({ id: offset + i, job_id: `J${offset + i}`, job_name: 'Engineering Intern', job_description: '<p>Build React dashboards.</p>', requirements: '<p>Knowledge of TypeScript.</p>', city_id: 2, employment_id: 4 })) } };
    });
    expect(pages).toBe(2); expect(result).toHaveLength(51); expect(result[0].seniority).toBe('Internship');
    expect(result[0].url).toBe('https://careers.shopee.sg/job-detail/J0/1?channel=10001');
    expect(result[0].description).toContain('Requirements\nKnowledge of TypeScript.');
  });
  it('fails closed when the feed repeats IDs or responds with an error code', async () => {
    const source = parseBoard('Shopee', 'https://careers.shopee.sg/jobs');
    await expect(fetchShopee(source, async () => ({ code: 1, data: {} }))).rejects.toThrow();
    const post = { id: 1, job_id: 'one', job_name: 'Engineer', job_description: 'React dashboards', requirements: 'React' };
    await expect(fetchShopee(source, async url => url.includes('/meta/') ? { code: 0, data: {} } : { code: 0, data: { total_count: 2, job_list: [post, post] } })).rejects.toThrow('repeated');
  });
});

describe('public proprietary career pages', () => {
  const source = parseBoard('Acme', 'https://careers.acme.com/openings');
  const structured = '<script type="application/ld+json">' + JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'JobPosting', title: 'Engineer', description: '<p>Build React applications with our product team.</p>', url: '/jobs/engineer', jobLocation: { address: { addressLocality: 'Singapore' } } }] }) + '</script>';
  it('accepts public HTTPS sites and blocks local addresses and credentialed URLs', () => {
    expect(source.provider).toBe('website');
    for (const value of ['https://127.0.0.1/jobs', 'https://[::1]/jobs', 'https://foo.local/jobs', 'https://user:pass@public.com/jobs', 'http://careers.acme.com/jobs']) expect(() => publicUrl(value)).toThrow();
    expect(privateAddress('169.254.169.254')).toBe(true); expect(privateAddress('::ffff:10.0.0.1')).toBe(true);
  });
  it('extracts JobPosting data from JSON-LD graphs without executing scripts', () => {
    const jobs = structuredJobs(structured, source.url, source);
    expect(jobs).toHaveLength(1); expect(jobs[0].location).toBe('Singapore'); expect(jobs[0].url).toBe('https://careers.acme.com/jobs/engineer');
    expect(structuredJobs('<script type="application/ld+json">alert(1)</script>', source.url, source)).toEqual([]);
  });
  it('restricts links to the approved origin and job paths', () => {
    const links = candidateLinks('<a href="/jobs/engineer">Job</a><a href="https://evil.com/jobs/one">bad</a><a href="/jobs/apply/x">apply</a><a href="javascript:alert(1)">bad</a>', source.url);
    expect(links).toEqual(['https://careers.acme.com/jobs/engineer']);
  });
  it('honors robots allow specificity and crawl delays', () => {
    const rules = 'User-agent: *\nDisallow: /jobs/\nAllow: /jobs/public/\nCrawl-delay: 2';
    expect(robotsPolicy(rules, '/jobs/private')).toMatchObject({ allowed: false, delay: 2000 });
    expect(robotsPolicy(rules, '/jobs/public/engineer').allowed).toBe(true);
  });
  it('imports structured listings as partial and never follows off-site links', async () => {
    const calls: string[] = [];
    const jobs = await fetchWebsite(source, async url => { calls.push(url); return url.endsWith('robots.txt') ? 'User-agent: *\nAllow: /' : structured; });
    expect(jobs).toHaveLength(1); expect(jobs.complete).toBe(false); expect(calls).toHaveLength(2);
  });
  it('rejects blocked and JavaScript-only pages without pretending to connect', async () => {
    await expect(fetchWebsite(source, async () => 'User-agent: *\nDisallow: /')).rejects.toThrow('robots');
    await expect(fetchWebsite(source, async url => { if (url.endsWith('robots.txt')) throw new AppError(502, 'Not found', 'NOT_FOUND'); return '<div id="app"></div>'; })).rejects.toThrow('No readable');
  });
  it('uses a conservative HTML fallback only for a readable job page', () => {
    expect(htmlJob('<h1>Careers</h1><main>Welcome</main>', source.url, source)).toEqual([]);
    expect(htmlJob('<h1>Software Engineer</h1><main>Responsibilities: Build accessible React dashboards for the product team. Requirements: Demonstrated TypeScript experience and strong communication skills.</main>', 'https://careers.acme.com/jobs/engineer', source)).toHaveLength(1);
  });
});
