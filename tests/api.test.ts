import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Repository } from '../src/storage/repository.js';
import { TaskEngine } from '../src/tasks/engine.js';
import { createApp } from '../src/server/app.js';
import { removeTestDirectory, testDirectory } from './helpers.js';
import { addJob, confirmedState } from './helpers.js';
import { stageNewRanking } from '../src/modules/matching/ranking.js';
import { recompute } from '../src/modules/matching/index.js';

let repo: Repository, engine: TaskEngine, agent: ReturnType<typeof supertest>;
const host = '127.0.0.1:4310';
beforeEach(async () => {
  repo = new Repository(await testDirectory()); await repo.open();
  engine = new TaskEngine(repo); agent = supertest(createApp(repo, engine, 4310));
});
afterEach(async () => { await engine.pause(); await repo.close(); await removeTestDirectory(repo.directory); });
async function send(url: string, body?: unknown, method: 'post' | 'put' | 'delete' = 'post') {
  const bootstrap = await agent.get('/api/state').set('Host', host);
  return agent[method](url).set('Host', host).set('X-Scout-Token', bootstrap.body.token).set('X-Revision', String(bootstrap.body.state.revision)).send(body as object | undefined);
}
async function profileAndJob() {
  await send('/api/facts', { kind: 'experience', value: 'Software engineer at Acme, 2020–2024. Built React dashboards.' });
  await send('/api/facts', { kind: 'skill', value: 'React' });
  const confirm = await send('/api/facts/confirm', { ids: repo.read().facts.map(f => f.id) }); expect(confirm.status).toBe(200);
  await send('/api/jobs', { title: 'Frontend Engineer', company: 'Acme', location: 'Singapore', url: 'https://example.com/job', description: 'Requirements\nExperience with React\nResponsibilities\nBuild accessible dashboards.' });
  return repo.read().jobs[0].id;
}

describe('local HTTP security', () => {
  it('rejects unexpected Host, cross-origin, cross-site, and missing session tokens', async () => {
    expect((await agent.get('/api/state').set('Host', 'evil.example')).status).toBe(403);
    expect((await agent.get('/api/state').set('Host', host).set('Origin', 'https://evil.example')).status).toBe(403);
    expect((await agent.get('/api/state').set('Host', host).set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
    expect((await agent.post('/api/facts').set('Host', host).send({})).status).toBe(403);
  });
  it('rejects stale revisions and malformed request data', async () => {
    const bootstrap = (await agent.get('/api/state').set('Host', host)).body;
    await send('/api/facts', { kind: 'skill', value: 'React' });
    const stale = await agent.post('/api/facts').set('Host', host).set('X-Scout-Token', bootstrap.token).set('X-Revision', '0').send({ kind: 'skill', value: 'Python' });
    expect(stale.status).toBe(409); expect(repo.read().facts).toHaveLength(1);
    expect((await send('/api/facts', { kind: 'bogus', value: '' })).status).toBe(400);
  });
  it('never accepts filesystem paths and does not expose server settings or secrets', async () => {
    const result = await send('/api/documents', { path: '../../.env.local' }); expect(result.status).toBe(400);
    const state = await agent.get('/api/state').set('Host', host);
    expect(state.headers['cache-control']).toBe('no-store');
    expect(state.body.state.settings.OPENAI_API_KEY).toBeUndefined();
    expect((await agent.get('/api/unknown').set('Host', host)).status).toBe(404);
  });
  it('blocks unsupported board URLs, oversized text, and malformed PDF signatures', async () => {
    expect((await send('/api/sources', { name: 'Unsafe', url: 'https://127.0.0.1/careers' })).status).toBe(400);
    expect((await send('/api/documents', { text: 'A'.repeat(100001) })).status).toBe(400);
    expect((await send('/api/documents', { pdf: Buffer.from('Not a PDF').toString('base64') })).status).toBe(400);
  });
});

describe('complete local workflow', () => {
  it('sorts by saved LLM scores and exposes stale assessments without resending', async () => {
    await repo.update(state => {
      Object.assign(state, confirmedState());
      for (const [title, score] of [['First AI match', 91], ['Second AI match', 34]] as const) {
        const id = addJob(state, { title });
        const job = state.jobs.find(j => j.id === id)!; stageNewRanking(state, id, job.snapshotId);
        Object.assign(state.rankings.at(-1)!, { status: 'completed', score, summary: 'Synthetic assessment', selection: { provider: 'openai', model: 'gpt-4.1-mini' }, profileVersion: state.profileVersion, preferences: structuredClone(state.preferences), completedAt: new Date().toISOString() });
      }
      state.preferences.version++; recompute(state);
    });
    const response = await agent.get('/api/jobs').set('Host', host);
    expect(response.body.items.map((row: { ranking: { score: number } }) => row.ranking.score)).toEqual([91, 34]);
    expect(response.body.items.every((row: { rankingStale: boolean }) => row.rankingStale)).toBe(true);
    expect(repo.read().usage).toEqual([]);
  });
  it('unfollows and follows a company without losing its source identity', async () => {
    await send('/api/sources', { name: 'Acme', url: 'https://jobs.lever.co/acme' });
    const id = repo.read().sources[0].id;
    expect((await send(`/api/sources/${id}`, { enabled: false }, 'put')).status).toBe(200);
    expect((await send('/api/tasks', { kind: 'refresh', targetId: id })).status).toBe(400);
    await send('/api/sources', { name: 'Acme', url: 'https://jobs.lever.co/acme' });
    expect(repo.read().sources).toHaveLength(1); expect(repo.read().sources[0]).toMatchObject({ id, enabled: true });
  });
  it('confirms facts, ranks a job, invalidates edited facts, and preserves prior snapshots', async () => {
    const jobId = await profileAndJob();
    const result = await agent.get('/api/jobs').set('Host', host); expect(result.body.items).toHaveLength(1);
    expect(result.body.items[0].match.score).toBeGreaterThan(0);
    const fact = repo.read().facts.find(f => f.kind === 'skill')!;
    const response = await send(`/api/facts/${fact.id}`, { kind: 'skill', value: 'Python' }, 'put'); expect(response.status).toBe(200);
    expect(repo.read().facts.find(f => f.id === fact.id)?.verified).toBe(false); expect(repo.read().matches).toHaveLength(0);
    expect(repo.read().profileVersions.some(v => v.facts.some(f => f.value === 'React'))).toBe(true);
    expect((await agent.get(`/api/jobs/${jobId}`).set('Host', host)).status).toBe(200);
  });
  it('creates and edits draft revisions, warns on unsupported claims, and exports reviewed edits', async () => {
    const jobId = await profileAndJob();
    const generated = await send('/api/drafts/manual', { jobId }); expect(generated.status).toBe(200);
    let draft = repo.read().drafts.find(d => d.type === 'resume')!;
    expect((await agent.get(`/api/drafts/${draft.id}/export?format=txt`).set('Host', host)).status).toBe(400);
    const edited = draft.text + '\nI managed 99 engineers.';
    expect((await send(`/api/drafts/${draft.id}`, { text: edited, reviewed: true }, 'put')).status).toBe(200);
    draft = repo.read().drafts.at(-1)!;
    expect(draft.issues.length).toBeGreaterThan(0); expect(repo.read().drafts).toHaveLength(3);
    expect((await agent.get(`/api/drafts/${draft.id}/export?format=txt`).set('Host', host)).status).toBe(400);
    const exported = await agent.get(`/api/drafts/${draft.id}/export?format=txt&acknowledge=true`).set('Host', host);
    expect(exported.status).toBe(200); expect(exported.text).toBe(edited);
    const pdf = await agent.get(`/api/drafts/${draft.id}/export?format=pdf&acknowledge=true`).set('Host', host);
    expect(pdf.status).toBe(200); expect(pdf.headers['content-type']).toContain('application/pdf');
  });
  it('persists application states, user-entered dates, and feed filters across restart', async () => {
    const jobId = await profileAndJob();
    expect((await send(`/api/applications/${jobId}`, { status: 'applied', appliedDate: '2026-10-16' }, 'put')).status).toBe(200);
    await send('/api/filters', { search: 'React', location: 'Singapore', status: 'applied', showIneligible: false }, 'put');
    await repo.close(); await repo.open();
    expect(repo.read().applications[0].appliedDate).toBe('2026-10-16'); expect(repo.read().feedFilters.search).toBe('React');
    expect((await agent.get('/api/jobs?status=applied').set('Host', host)).body.total).toBe(1);
  });
  it('rejects AI generation before profile confirmation', async () => {
    await repo.update(s => { s.settings.aiConsent = true; });
    expect((await send('/api/tasks', { kind: 'draft', targetId: null })).status).toBe(400);
  });
  it('parses text PDFs in an isolated worker and reports scanned documents clearly', async () => {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('Engineer at Acme. Built React dashboards from 2020 to 2024.', { font });
    const result = await send('/api/documents', { pdf: Buffer.from(await pdf.save()).toString('base64') });
    expect(result.status, result.body.error).toBe(200); expect(repo.read().documents[0].text).toContain('Engineer at Acme');
    const scanned = await PDFDocument.create(); scanned.addPage();
    const noText = await send('/api/documents', { pdf: Buffer.from(await scanned.save()).toString('base64') });
    expect(noText.status).toBe(400); expect(noText.body.error).toContain('scanned');
  });
  it('backs up, restores, and deletes local data only with explicit confirmations', async () => {
    await profileAndJob();
    await send('/api/documents', { text: 'Engineer at Acme. Built React applications from 2020 to 2024.' });
    const backup = await agent.get('/api/backup').set('Host', host).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(Buffer.from(chunk))); res.on('end', () => callback(null, Buffer.concat(chunks)));
    });
    expect(backup.status).toBe(200);
    expect((await send('/api/data/delete', { confirmation: 'no' })).status).toBe(400);
    expect((await send('/api/data/delete', { confirmation: 'DELETE' })).status).toBe(200);
    expect(repo.read().facts).toHaveLength(0); expect(await fs.readdir(path.join(repo.directory, 'backups'))).toHaveLength(0);
    const restored = await send('/api/restore', { archive: (backup.body as Buffer).toString('base64'), confirmation: 'RESTORE' });
    expect(restored.status, restored.body.error).toBe(200); expect(repo.read().facts).toHaveLength(2); expect(repo.read().documents).toHaveLength(1);
  });
});
