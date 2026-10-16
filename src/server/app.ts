import express, { ErrorRequestHandler, Request } from 'express';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Repository } from '../storage/repository.js';
import { TaskEngine } from '../tasks/engine.js';
import { AppError, assert } from '../shared/errors.js';
import { Id, FactKind, Preferences, Settings, Selection, State, initialState, profileReady } from '../shared/schema.js';
import { bumpProfile, newFact } from '../modules/profile/index.js';
import { recompute } from '../modules/matching/index.js';
import { IncomingJob, makeSnapshot, parseBoard, safeUrl, starterBoards } from '../modules/sources/index.js';
import { saveDocument } from '../modules/profile/documents.js';
import { createDrafts, exportPdf, validateClaims } from '../modules/drafts/index.js';
import { providerStatus } from '../providers/index.js';
import { createBackup, readBackup, restoreBackup } from '../storage/backup.js';

const date = () => new Date().toISOString();
function expected(req: Request): number {
  const raw = req.get('X-Revision');
  assert(raw && /^\d+$/.test(raw), 'Refresh the page before making changes.', 409);
  return Number(raw);
}
const factInput = z.strictObject({ kind: FactKind, value: z.string().trim().min(1).max(4000), excerpt: z.string().max(8000).optional() });

export function createApp(repo: Repository, engine: TaskEngine, port: number) {
  const app = express();
  const token = randomUUID();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(req.get('host') ?? '')) return res.status(403).json({ error: 'Unexpected Host header.' });
    const origin = req.get('origin');
    if (origin && !allowedHosts.some(host => origin === `http://${host}`)) return res.status(403).json({ error: 'Cross-origin requests are not permitted.' });
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not permitted.' });
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Frame-Options': 'DENY' });
    if (req.path.startsWith('/api')) {
      res.set('Cache-Control', 'no-store');
      if (!['GET', 'HEAD'].includes(req.method)) {
        const supplied = Buffer.from(req.get('X-Scout-Token') ?? '');
        if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return res.status(403).json({ error: 'Local session expired. Reload the page.' });
      }
    }
    next();
  });
  app.use('/api/restore', express.json({ limit: '55mb' }));
  app.use(express.json({ limit: '8mb', strict: true }));
  app.get('/api/state', (req, res) => {
    if (req.query.since === String(repo.revision)) return void res.json({ unchanged: true });
    const state = repo.read();
    const stats = { active: state.jobs.filter(j => j.active).length, saved: state.applications.filter(a => a.status === 'saved' || a.status === 'drafting').length, applied: state.applications.filter(a => a.status === 'applied').length };
    res.json({ state: { ...state, jobs: [], snapshots: [], matches: [] }, stats, token, providers: providerStatus(), starters: starterBoards });
  });
  app.get('/api/jobs/:id', (req, res) => {
    const state = repo.read(), job = state.jobs.find(j => j.id === req.params.id);
    assert(job, 'Job not found.', 404);
    res.json({ job, snapshot: state.snapshots.find(s => s.id === job.snapshotId), match: state.matches.find(m => m.jobId === job.id), application: state.applications.find(a => a.jobId === job.id) });
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/jobs', (req, res) => {
    const state = repo.read();
    const query = z.object({ search: z.string().max(200).default(''), location: z.string().max(200).default(''), status: z.enum(['active', 'all', 'saved', 'drafting', 'applied', 'archived', 'dismissed']).default('active'), showIneligible: z.enum(['true', 'false']).default('false'), page: z.coerce.number().int().min(1).max(10000).default(1) }).parse(req.query);
    const snapshots = new Map(state.snapshots.map(s => [s.id, s]));
    const matches = new Map(state.matches.map(m => [m.jobId, m]));
    const apps = new Map(state.applications.map(a => [a.jobId, a]));
    const rows = state.jobs.flatMap(job => {
      const snapshot = snapshots.get(job.snapshotId)!;
      const match = matches.get(job.id), application = apps.get(job.id);
      if (query.status === 'active' && (!job.active || application?.status === 'dismissed' || application?.status === 'archived')) return [];
      if (!['active', 'all'].includes(query.status) && application?.status !== query.status) return [];
      if (query.showIneligible !== 'true' && match?.eligibility === 'ineligible') return [];
      if (!`${snapshot.title} ${snapshot.company} ${snapshot.description}`.toLowerCase().includes(query.search.toLowerCase())) return [];
      if (!(snapshot.location ?? '').toLowerCase().includes(query.location.toLowerCase())) return [];
      return [{ job, snapshot: { ...snapshot, description: '', requirements: [] }, match, application }];
    });
    rows.sort((a, b) => Number((b.match?.coverage ?? 0) >= 50) - Number((a.match?.coverage ?? 0) >= 50) || (b.match?.score ?? -1) - (a.match?.score ?? -1) || b.job.lastSeen.localeCompare(a.job.lastSeen));
    res.json({ total: rows.length, items: rows.slice((query.page - 1) * 30, query.page * 30), revision: state.revision });
  });
  app.put('/api/settings', async (req, res) => res.json(await repo.update(s => { s.settings = Settings.parse(req.body); }, expected(req))));
  app.put('/api/preferences', async (req, res) => {
    const input = Preferences.omit({ version: true }).parse(req.body);
    res.json(await repo.update(s => { s.preferences = { ...input, version: s.preferences.version + 1 }; recompute(s); }, expected(req)));
  });
  app.put('/api/filters', async (req, res) => res.json(await repo.update(s => { s.feedFilters = State.shape.feedFilters.parse(req.body); }, expected(req))));
  app.post('/api/facts', async (req, res) => {
    const input = factInput.parse(req.body);
    assert(!input.value.includes('\n'), 'Use one fact per entry. Split separate claims into individual facts.');
    res.json(await repo.update(s => { s.facts.push(newFact(input.kind, input.value)); bumpProfile(s); recompute(s); }, expected(req)));
  });
  app.put('/api/facts/:id', async (req, res) => {
    const id = Id.parse(req.params.id), input = factInput.parse(req.body);
    res.json(await repo.update(s => {
      const fact = s.facts.find(f => f.id === id); assert(fact, 'Fact not found.', 404);
      if (fact.value !== input.value || fact.kind !== input.kind) { fact.value = input.value; fact.kind = input.kind; fact.verified = false; fact.confirmedAt = null; }
      bumpProfile(s); recompute(s);
    }, expected(req)));
  });
  app.post('/api/facts/confirm', async (req, res) => {
    const { ids } = z.strictObject({ ids: z.array(Id).min(1).max(300) }).parse(req.body);
    res.json(await repo.update(s => {
      assert(ids.every(id => s.facts.some(f => f.id === id)), 'One or more selected facts no longer exists.');
      for (const fact of s.facts.filter(f => ids.includes(f.id))) { fact.verified = true; fact.confirmedAt = date(); }
      bumpProfile(s); recompute(s);
    }, expected(req)));
  });
  app.delete('/api/facts/:id', async (req, res) => res.json(await repo.update(s => {
    s.facts = s.facts.filter(f => f.id !== Id.parse(req.params.id)); bumpProfile(s); recompute(s);
  }, expected(req))));
  app.post('/api/documents', async (req, res) => {
    const input = z.union([z.strictObject({ text: z.string().max(100000) }), z.strictObject({ pdf: z.string().max(6800000).regex(/^[A-Za-z0-9+/]*={0,2}$/) })]).parse(req.body);
    res.json({ documentId: await saveDocument(repo, input, expected(req)) });
  });
  app.post('/api/sources', async (req, res) => {
    const input = z.strictObject({ name: z.string().trim().min(1).max(100), url: z.string().max(2000) }).parse(req.body);
    const source = parseBoard(input.name, input.url);
    res.json(await repo.update(s => {
      assert(s.sources.filter(source => source.enabled).length < 50, 'You can follow up to 50 company boards.');
      const existing = s.sources.find(existing => existing.provider === source.provider && existing.board === source.board);
      assert(!existing?.enabled, 'This board is already followed.');
      if (existing) { existing.enabled = true; existing.name = source.name; }
      else s.sources.push(source);
    }, expected(req)));
  });
  app.put('/api/sources/:id', async (req, res) => {
    const input = z.strictObject({ enabled: z.boolean() }).parse(req.body);
    res.json(await repo.update(s => {
      const source = s.sources.find(source => source.id === Id.parse(req.params.id)); assert(source, 'Board not found.', 404);
      assert(!input.enabled || source.enabled || s.sources.filter(source => source.enabled).length < 50, 'You can follow up to 50 company boards.');
      source.enabled = input.enabled;
    }, expected(req)));
  });
  app.post('/api/jobs', async (req, res) => {
    const input = z.strictObject({ title: z.string().trim().min(1).max(300), company: z.string().trim().min(1).max(200), description: z.string().trim().min(30).max(100000), location: z.string().max(300), url: z.string().max(2000) }).parse(req.body);
    assert(!input.url || safeUrl(input.url), 'Use an HTTPS posting URL or leave it blank.');
    const incoming: IncomingJob = { ...input, externalId: randomUUID(), location: input.location || null, url: safeUrl(input.url), applyUrl: safeUrl(input.url), workMode: null, seniority: null, salaryMin: null, salaryMax: null, currency: null, workAuthorization: null };
    const snapshot = makeSnapshot(incoming);
    res.json(await repo.update(s => {
      s.snapshots.push(snapshot);
      s.jobs.push({ id: randomUUID(), sourceId: null, externalId: incoming.externalId, snapshotId: snapshot.id, firstSeen: date(), lastSeen: date(), active: true, missingCount: 0, possibleDuplicate: null });
      recompute(s);
    }, expected(req)));
  });
  app.put('/api/applications/:jobId', async (req, res) => {
    const jobId = Id.parse(req.params.jobId);
    const input = z.strictObject({ status: z.enum(['saved', 'drafting', 'applied', 'archived', 'dismissed']), appliedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).parse(req.body);
    assert(input.status !== 'applied' || input.appliedDate, 'Choose the date you applied.');
    res.json(await repo.update(s => {
      assert(s.jobs.some(j => j.id === jobId), 'Job not found.', 404);
      const app = s.applications.find(a => a.jobId === jobId);
      if (app) Object.assign(app, input, { updatedAt: date() });
      else s.applications.push({ id: randomUUID(), jobId, ...input, updatedAt: date() });
    }, expected(req)));
  });
  app.post('/api/tasks', async (req, res) => {
    const input = z.strictObject({ kind: z.enum(['refresh', 'extract', 'analyze', 'draft', 'smoke']), targetId: Id.nullable(), selection: Selection.optional() }).parse(req.body);
    res.status(202).json(await engine.enqueue(input.kind, input.targetId, input.selection));
  });
  app.post('/api/drafts/manual', async (req, res) => {
    const { jobId } = z.strictObject({ jobId: Id }).parse(req.body);
    res.json(await repo.update(s => {
      assert(profileReady(s), 'Confirm experience and skills first.');
      const job = s.jobs.find(j => j.id === jobId); assert(job, 'Job not found.', 404);
      const snapshot = s.snapshots.find(snapshot => snapshot.id === job.snapshotId)!;
      const facts = s.profileVersions.find(v => v.version === s.profileVersion)!.facts;
      s.drafts.push(...createDrafts(s, job.id, snapshot, s.profileVersion, facts, { resumeFactIds: facts.map(f => f.id), letterFactIds: facts.filter(f => f.kind === 'experience' || f.kind === 'achievement').map(f => f.id) }, null));
    }, expected(req)));
  });
  app.put('/api/drafts/:id', async (req, res) => {
    const id = Id.parse(req.params.id);
    const input = z.strictObject({ text: z.string().max(60000), reviewed: z.boolean() }).parse(req.body);
    res.json(await repo.update(s => {
      const draft = s.drafts.find(d => d.id === id); assert(draft, 'Draft not found.', 404);
      const facts = s.profileVersions.find(v => v.version === draft.profileVersion)!.facts;
      const snapshot = s.snapshots.find(snapshot => snapshot.id === draft.snapshotId)!;
      const claims = [...draft.claims];
      for (const fact of facts) if (input.text.includes(fact.value) && !claims.some(c => c.text === fact.value)) claims.push({ text: fact.value, factIds: [fact.id] });
      const issues = validateClaims(input.text, claims, facts, snapshot);
      s.drafts.push({ ...draft, id: randomUUID(), text: input.text, reviewed: input.reviewed, claims, issues, revision: s.drafts.filter(d => d.jobId === draft.jobId && d.type === draft.type).length + 1, createdAt: date() });
    }, expected(req)));
  });
  app.get('/api/drafts/:id/export', async (req, res) => {
    const state = repo.read(), draft = state.drafts.find(d => d.id === req.params.id);
    assert(draft, 'Draft not found.', 404);
    assert(draft.reviewed, 'Review and save this draft before exporting.');
    assert(!draft.issues.length || req.query.acknowledge === 'true', 'This draft contains unsupported edited text. Review the warnings and explicitly acknowledge them before exporting.');
    const format = z.enum(['pdf', 'txt']).parse(req.query.format ?? 'txt');
    let bytes: Buffer;
    try { bytes = format === 'pdf' ? Buffer.from(await exportPdf(draft)) : Buffer.from(draft.text, 'utf8'); }
    catch { throw new AppError(400, 'The PDF font cannot represent some characters. Download plain text to preserve your content.'); }
    await fs.writeFile(path.join(repo.directory, 'exports', `${draft.id}.${format}`), bytes, { mode: 0o600 });
    res.set({ 'Content-Type': format === 'pdf' ? 'application/pdf' : 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${draft.type}.${format}"` }).send(bytes);
  });
  app.get('/api/backup', async (_req, res) => res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="job-scout-backup.zip"' }).send(Buffer.from(await createBackup(repo))));
  app.post('/api/restore', async (req, res) => {
    const input = z.strictObject({ archive: z.string().max(54000000), confirmation: z.literal('RESTORE') }).parse(req.body);
    const backup = readBackup(Buffer.from(input.archive, 'base64'));
    assert(expected(req) === repo.read().revision, 'Local data changed. Review and retry restore.', 409);
    await engine.pause();
    try { await restoreBackup(repo, backup, repo.read().revision); res.json({ ok: true }); }
    finally { engine.resume(); }
  });
  app.post('/api/data/delete', async (req, res) => {
    z.strictObject({ confirmation: z.literal('DELETE') }).parse(req.body);
    assert(expected(req) === repo.read().revision, 'Local data changed. Review and retry deletion.', 409);
    await engine.pause();
    try {
      await repo.update(s => Object.assign(s, initialState()));
      for (const folder of ['uploads', 'exports', 'backups']) {
        const directory = path.join(repo.directory, folder);
        const resolved = path.resolve(directory);
        assert(resolved.startsWith(path.resolve(repo.directory) + path.sep), 'Invalid local data directory.');
        await fs.rm(directory, { recursive: true, force: true }); await fs.mkdir(directory);
      }
      res.json({ ok: true });
    } finally { engine.resume(); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError) return void res.status(400).json({ error: 'Check your input. ' + error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join('; ') });
    if (error instanceof AppError) return void res.status(error.status).json({ error: error.message, code: error.code });
    if (error.type === 'entity.too.large') return void res.status(413).json({ error: 'The uploaded content exceeds the size limit.' });
    if (error instanceof SyntaxError) return void res.status(400).json({ error: 'Request contains invalid JSON.' });
    // Do not log request bodies, provider responses, credentials, or personal content.
    res.status(500).json({ error: 'The operation could not be saved. Existing data was preserved. Check free disk space and folder access, then retry.' });
  };
  app.use(errorHandler);
  return app;
}
