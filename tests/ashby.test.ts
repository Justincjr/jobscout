import { describe, expect, it } from 'vitest';
import { fetchBoard, ingest, migrateLegacyBoards, parseBoard } from '../src/modules/sources/index.js';
import { initialState } from '../src/shared/schema.js';
import { incoming } from './helpers.js';

const job = { title: 'Engineer', location: 'New York', secondaryLocations: [{ location: 'Seattle' }], isListed: true,
  descriptionHtml: '<p>Build reliable financial services.</p>', jobUrl: 'https://jobs.ashbyhq.com/plaid/one', applyUrl: 'https://jobs.ashbyhq.com/plaid/one/application', workplaceType: 'Hybrid' };

describe('Ashby boards and retired Plaid starter', () => {
  it('imports listed postings, full descriptions, locations and stable IDs', async () => {
    const source = parseBoard('Plaid', job.jobUrl);
    expect(source.provider).toBe('ashby'); expect(source.url).toBe('https://jobs.ashbyhq.com/plaid');
    const jobs = await fetchBoard(source, async url => {
      expect(url).toBe('https://api.ashbyhq.com/posting-api/job-board/plaid');
      return { apiVersion: '1', jobs: [job, { ...job, isListed: false }] };
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ externalId: 'one', location: 'New York; Seattle', workMode: 'hybrid', description: 'Build reliable financial services.' });
    const state = initialState(); state.sources.push(source);
    ingest(state, source.id, jobs, true); ingest(state, source.id, jobs, true);
    expect(state.jobs).toHaveLength(1); expect(state.rankings).toHaveLength(1);
  });
  it.each([
    { ...job, jobUrl: 'https://jobs.ashbyhq.com/other/one' },
    { ...job, applyUrl: 'javascript:alert(1)' },
    { ...job, descriptionHtml: '' },
  ])('rejects unusable results before applying a refresh', async invalid => {
    await expect(fetchBoard(parseBoard('Plaid', 'https://jobs.ashbyhq.com/plaid'), async () => ({ apiVersion: '1', jobs: [invalid] }))).rejects.toThrow();
  });
  it('rejects repeated identities and spoofed hosts', async () => {
    await expect(fetchBoard(parseBoard('Plaid', job.jobUrl), async () => ({ apiVersion: '1', jobs: [job, job] }))).rejects.toThrow('duplicate');
    expect(() => parseBoard('Plaid', 'https://jobs.ashbyhq.com.evil.com/plaid')).toThrow();
  });
  it('repairs the failed legacy starter in place once, preserving its history and follow preference', () => {
    const state = initialState(), source = parseBoard('Plaid', 'https://jobs.lever.co/plaid');
    source.error = 'Previous 404'; source.enabled = false; state.sources.push(source);
    expect(migrateLegacyBoards(state)).toBe(true);
    expect(state.sources[0]).toMatchObject({ id: source.id, provider: 'ashby', url: 'https://jobs.ashbyhq.com/plaid', enabled: false, error: 'Previous 404' });
    expect(migrateLegacyBoards(state)).toBe(false);
  });
  it('does not reinterpret identities for a legacy source with imported jobs', () => {
    const state = initialState(), source = parseBoard('Plaid', 'https://jobs.lever.co/plaid'); state.sources.push(source);
    ingest(state, source.id, [incoming()], true);
    expect(migrateLegacyBoards(state)).toBe(false); expect(source.provider).toBe('lever');
  });
});
