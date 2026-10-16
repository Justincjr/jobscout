import { afterEach, describe, expect, it } from 'vitest';
import { Repository, parseState } from '../src/storage/repository.js';
import { TaskEngine } from '../src/tasks/engine.js';
import { AiTransport } from '../src/providers/index.js';
import { addJob, confirmedState, incoming, removeTestDirectory, testDirectory } from './helpers.js';
import { ingest, parseBoard } from '../src/modules/sources/index.js';
import { rankingStale, stageNewRanking } from '../src/modules/matching/ranking.js';
import { recompute } from '../src/modules/matching/index.js';
import { bumpProfile } from '../src/modules/profile/index.js';

const fixtures: { repo: Repository; engine: TaskEngine }[] = [];
const validResponse: AiTransport = async (_selection, _schema, _instruction, raw) => {
  const data = raw as { confirmedFacts: { id: string }[] };
  return { text: JSON.stringify({ score: 87, summary: 'Strong React alignment with experience to review.', strengths: [{ factId: data.confirmedFacts[0].id, factExcerpt: 'Built React dashboards.', jobExcerpt: 'Experience with React', explanation: 'Prior React dashboard work is relevant.' }], gaps: ['Python is not demonstrated.'], unknowns: ['Work mode is undisclosed.'] }), input: 100, output: 30 };
};
async function setup(transport: AiTransport = validResponse) {
  const repo = new Repository(await testDirectory()); await repo.open();
  await repo.update(s => { Object.assign(s, confirmedState()); s.settings.aiConsent = true; s.sources.push(parseBoard('Acme', 'https://jobs.lever.co/acme')); });
  const engine = new TaskEngine(repo, transport, async () => [incoming()]); fixtures.push({ repo, engine });
  return { repo, engine, sourceId: repo.read().sources[0].id };
}
afterEach(async () => { for (const { repo, engine } of fixtures.splice(0)) { await engine.pause(); await repo.close(); await removeTestDirectory(repo.directory); } });

describe('LLM ranking of new jobs only', () => {
  it('preserves a saved result if the server stops before task completion is recorded', async () => {
    let calls = 0;
    const { repo, engine, sourceId } = await setup(async (...args) => { calls++; return validResponse(...args); });
    await repo.update(s => { ingest(s, sourceId, [incoming()], true); });
    await engine.start(false); await engine.idle(); await engine.pause();
    await repo.update(s => { s.tasks.find(t => t.kind === 'rank')!.status = 'running'; });
    const resumed = new TaskEngine(repo, async (...args) => { calls++; return validResponse(...args); });
    await resumed.start(false); await resumed.idle();
    expect(repo.read().rankings[0].status).toBe('completed'); expect(repo.read().tasks.find(t => t.kind === 'rank')?.status).toBe('completed'); expect(calls).toBe(1);
    await resumed.pause();
  });
  it('marks an unfinished ranking interrupted after restart rather than billing again', async () => {
    let calls = 0;
    const { repo, engine, sourceId } = await setup(async (...args) => { calls++; return validResponse(...args); });
    await repo.update(s => {
      ingest(s, sourceId, [incoming()], true);
      const rank = s.rankings[0]; Object.assign(rank, { status: 'running', selection: { provider: 'openai', model: 'gpt-4.1-mini' }, profileVersion: s.profileVersion, preferences: structuredClone(s.preferences) });
      s.tasks.push({ id: rank.id, key: 'unfinished-ranking', kind: 'rank', targetId: rank.jobId, status: 'running', selection: rank.selection, attempts: 1, error: null, createdAt: new Date().toISOString(), finishedAt: null });
    });
    await engine.start(false); await engine.idle();
    expect(calls).toBe(0); expect(repo.read().rankings[0].status).toBe('interrupted');
  });
  it('reuses the same official posting across overlapping company sources without another paid call', async () => {
    let calls = 0;
    const { repo, engine, sourceId } = await setup(async (...args) => { calls++; return validResponse(...args); });
    await repo.update(s => { ingest(s, sourceId, [incoming()], true); });
    await engine.start(false); await engine.idle();
    await repo.update(s => {
      const other = parseBoard('Acme', 'https://jobs.lever.co/acme-other'); s.sources.push(other);
      ingest(s, other.id, [incoming()], true);
    });
    engine.wake(); await engine.idle();
    expect(calls).toBe(1); expect(repo.read().rankings).toHaveLength(2);
    expect(repo.read().rankings.every(r => r.status === 'completed' && r.score === 87)).toBe(true);
  });
  it('ranks a newly ingested posting once and persists score, rationale, model and evidence', async () => {
    let calls = 0;
    const { repo, engine, sourceId } = await setup(async (...args) => { calls++; return validResponse(...args); });
    await engine.start(false); await engine.enqueue('refresh', sourceId); await engine.idle();
    expect(calls).toBe(1); const ranking = repo.read().rankings[0];
    expect(ranking).toMatchObject({ status: 'completed', score: 87, selection: { provider: 'openai', model: 'gpt-4.1-mini' }, profileVersion: 1 });
    expect(ranking.strengths[0].jobExcerpt).toBe('Experience with React'); expect(repo.read().usage).toHaveLength(1);
    await engine.enqueue('refresh', sourceId); await engine.idle(); expect(calls).toBe(1);
  });
  it('never backfills old jobs automatically and marks changed inputs stale without extra calls', async () => {
    let calls = 0;
    const { repo, engine, sourceId } = await setup(async (...args) => { calls++; return validResponse(...args); });
    await repo.update(s => { addJob(s, { externalId: 'legacy' }); });
    await engine.start(false); await engine.enqueue('refresh', sourceId); await engine.idle();
    expect(repo.read().jobs).toHaveLength(2); expect(repo.read().rankings).toHaveLength(1);
    await repo.update(s => {
      s.preferences.version++; s.settings.provider = 'anthropic'; s.settings.model = 'claude-sonnet-5-5';
      bumpProfile(s); ingest(s, sourceId, [incoming({ title: 'Updated Engineer' })], true); recompute(s);
    });
    engine.wake(); await engine.idle();
    const state = repo.read(); expect(rankingStale(state, state.rankings[0])).toBe(true); expect(calls).toBe(1);
    await expect(engine.enqueue('rank', state.rankings[0].jobId)).rejects.toThrow('already has');
    expect(state.rankings[0].selection?.provider).toBe('openai');
  });
  it('does not repeat a completed ranking after a server restart or task-history pruning', async () => {
    let calls = 0;
    const { repo, engine, sourceId } = await setup(async (...args) => { calls++; return validResponse(...args); });
    await engine.start(false); await engine.enqueue('refresh', sourceId); await engine.idle(); await engine.pause();
    await repo.update(s => { s.tasks = []; }); await repo.close(); await repo.open();
    const resumed = new TaskEngine(repo, async (...args) => { calls++; return validResponse(...args); });
    await resumed.start(false); await resumed.idle();
    expect(calls).toBe(1); expect(repo.read().rankings[0].score).toBe(87); await resumed.pause();
  });
  it('waits for consent and confirmed profile facts before sending pending new jobs', async () => {
    let calls = 0;
    const { repo, engine, sourceId } = await setup(async (...args) => { calls++; return validResponse(...args); });
    await repo.update(s => { s.settings.aiConsent = false; ingest(s, sourceId, [incoming()], true); });
    await engine.start(false); await engine.idle(); expect(calls).toBe(0);
    await repo.update(s => { s.settings.aiConsent = true; }); engine.wake(); await engine.idle();
    expect(calls).toBe(1);
  });
  it('limits automatic queues to the remaining daily request budget', async () => {
    let calls = 0;
    const { repo, engine, sourceId } = await setup(async (...args) => { calls++; return validResponse(...args); });
    await repo.update(s => { s.settings.dailyRequestLimit = 1; ingest(s, sourceId, [incoming(), incoming({ externalId: 'second' })], true); });
    await engine.start(false); await engine.idle();
    expect(calls).toBe(1); expect(repo.read().rankings.map(r => r.status)).toEqual(['completed', 'pending']);
  });
  it('does not automatically retry paid failures and allows an explicit retry', async () => {
    let calls = 0;
    const { repo, engine, sourceId } = await setup(async (...args) => { calls++; if (calls === 1) throw { status: 429 }; return validResponse(...args); });
    await repo.update(s => { ingest(s, sourceId, [incoming()], true); }); await engine.start(false); await engine.idle();
    expect(repo.read().rankings[0].status).toBe('failed'); engine.wake(); await engine.idle(); expect(calls).toBe(1);
    await engine.enqueue('rank', repo.read().jobs[0].id); await engine.idle(); expect(calls).toBe(2); expect(repo.read().rankings[0].status).toBe('completed');
  });
  it('rejects fabricated evidence, invalid fact IDs and out-of-range scores without saving a ranking', async () => {
    const { repo, engine, sourceId } = await setup(async () => ({ text: JSON.stringify({ score: 110, summary: 'Fake', strengths: [{ factId: 'invented', factExcerpt: 'CEO at Fake Corp', jobExcerpt: 'Unstated requirement', explanation: 'Fake' }], gaps: [], unknowns: [] }), input: 1, output: 1 }));
    await repo.update(s => { ingest(s, sourceId, [incoming()], true); }); await engine.start(false); await engine.idle();
    expect(repo.read().rankings[0]).toMatchObject({ status: 'failed', score: null });
  });
  it('loads earlier JSON without ranking records and never creates candidates for existing postings', () => {
    const state = confirmedState(), jobId = addJob(state);
    const { rankings: _rankings, ...old } = state;
    expect(parseState(JSON.stringify(old)).rankings).toEqual([]);
    stageNewRanking(state, jobId, state.snapshots[0].id); stageNewRanking(state, jobId, state.snapshots[0].id);
    expect(state.rankings).toHaveLength(1);
  });
});
