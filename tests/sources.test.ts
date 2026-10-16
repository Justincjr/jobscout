import { describe, expect, it } from 'vitest';
import { fetchBoard, ingest, localRequirements, normalizeGreenhouse, normalizeLever, parseBoard, plainText, privateAddress, safeUrl } from '../src/modules/sources/index.js';
import { incoming } from './helpers.js';
import { initialState } from '../src/shared/schema.js';

describe('safe job discovery', () => {
  it('keeps an unstated requirement category unclear', () => {
    expect(localRequirements('Our team builds React applications.')[0].category).toBe('unclear');
  });
  it.each(['http://127.0.0.1/board', 'https://jobs.lever.co.evil.com/name', 'https://user:pass@jobs.lever.co/name', 'https://jobs.lever.co:444/name', 'https://localhost/careers', 'https://jobs.lever.co/'])('rejects unsupported or malicious URL %s', url => expect(() => parseBoard('Acme', url)).toThrow());
  it.each(['127.0.0.1', '169.254.169.254', '10.0.0.1', '172.16.1.2', '192.168.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1'])('blocks private address %s', ip => expect(privateAddress(ip)).toBe(true));
  it('recognizes all supported board hosts and safe link schemes', () => {
    expect(parseBoard('Acme', 'https://job-boards.greenhouse.io/acme/jobs/123').board).toBe('acme');
    expect(parseBoard('Acme', 'https://jobs.eu.lever.co/acme').provider).toBe('lever-eu');
    expect(safeUrl('javascript:alert(1)')).toBeNull(); expect(safeUrl('https://example.com')).toBeTruthy();
  });
  it('normalizes complete Greenhouse responses and strips unsafe markup', () => {
    const source = parseBoard('Acme', 'https://boards.greenhouse.io/acme');
    const jobs = normalizeGreenhouse({ jobs: [{ id: 1, title: 'Engineer', content: '&lt;p&gt;React experience&lt;/p&gt;<script>ignore</script>', absolute_url: 'https://example.com/job', location: { name: 'Singapore' } }], meta: { total: 1 } }, source);
    expect(jobs[0].description).toBe('React experience'); expect(jobs[0].salaryMin).toBeNull();
    expect(plainText('<img src=x onerror=alert(1)>Safe')).toBe('Safe');
    expect(() => normalizeGreenhouse({ jobs: [], meta: { total: 1 } }, source)).toThrow('incomplete');
  });
  it('normalizes Lever with missing metadata as unknown', () => {
    const source = parseBoard('Acme', 'https://jobs.lever.co/acme');
    const jobs = normalizeLever([{ id: 'one', text: 'Engineer', hostedUrl: 'https://jobs.lever.co/acme/one', applyUrl: 'https://jobs.lever.co/acme/one/apply', descriptionPlain: 'Build React applications' }], source);
    expect(jobs[0].location).toBeNull(); expect(jobs[0].workMode).toBeNull();
  });
  it('paginates Lever and refuses repeated or incomplete pagination', async () => {
    const source = parseBoard('Acme', 'https://jobs.lever.co/acme');
    const page = Array.from({ length: 100 }, (_, i) => ({ id: String(i), text: 'Engineer', descriptionPlain: 'React applications', hostedUrl: 'https://example.com', applyUrl: 'https://example.com' }));
    let requests = 0;
    const jobs = await fetchBoard(source, async url => { requests++; expect(url).toContain(`skip=${(requests - 1) * 100}`); return requests === 1 ? page : []; });
    expect(jobs).toHaveLength(100); expect(requests).toBe(2);
    await expect(fetchBoard(source, async () => page)).rejects.toThrow('repeated');
  });
  it('deduplicates refreshes, snapshots changed content, and requires two complete absences', () => {
    const state = initialState(), source = parseBoard('Acme', 'https://jobs.lever.co/acme'); state.sources.push(source);
    ingest(state, source.id, [incoming()], true); ingest(state, source.id, [incoming()], true);
    expect(state.jobs).toHaveLength(1); expect(state.snapshots).toHaveLength(1);
    ingest(state, source.id, [incoming({ title: 'Senior Engineer' })], true);
    expect(state.snapshots).toHaveLength(2);
    ingest(state, source.id, [], false); expect(state.jobs[0].missingCount).toBe(0);
    ingest(state, source.id, [], true); expect(state.jobs[0].active).toBe(true);
    ingest(state, source.id, [], true); expect(state.jobs[0].active).toBe(false);
    ingest(state, source.id, [incoming()], true); expect(state.jobs[0].active).toBe(true);
  });
});
