import { z } from 'zod';

export const Id = z.string().uuid();
export const Short = z.string().trim().min(1).max(500);
export const Provider = z.enum(['openai', 'anthropic']);
export const FactKind = z.enum(['experience', 'skill', 'education', 'achievement']);
export const Fact = z.strictObject({
  id: Id, kind: FactKind, value: z.string().min(1).max(4000),
  excerpt: z.string().max(8000), source: Short, documentId: Id.nullable(),
  verified: z.boolean(), confirmedAt: z.string().nullable(),
});
export type Fact = z.infer<typeof Fact>;
export const Selection = z.strictObject({ provider: Provider, model: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9._:-]+$/) });
export type Selection = z.infer<typeof Selection>;
export const Settings = Selection.extend({
  dailyRefresh: z.boolean(), dailyRequestLimit: z.number().int().min(0).max(500),
  dailyTokenLimit: z.number().int().min(0).max(10_000_000), aiConsent: z.boolean(),
});
export const PreferenceField = z.strictObject({ value: z.string().max(500), hard: z.boolean() });
export const Preferences = z.strictObject({
  version: z.number().int().nonnegative(), roles: PreferenceField, location: PreferenceField,
  workMode: z.strictObject({ value: z.enum(['', 'remote', 'hybrid', 'onsite']), hard: z.boolean() }),
  seniority: PreferenceField, compensation: z.strictObject({
    minimum: z.number().nonnegative().nullable(), currency: z.string().max(8), hard: z.boolean(),
  }), workAuthorization: PreferenceField,
});
export const Source = z.strictObject({
  id: Id, name: Short, provider: z.enum(['greenhouse', 'lever', 'lever-eu', 'ashby', 'workday', 'shopee', 'website']), board: Short,
  url: z.string().url(), lastSuccess: z.string().nullable(), lastAttempt: z.string().nullable(),
  error: z.string().nullable(), complete: z.boolean(), enabled: z.boolean(),
});
export type Source = z.infer<typeof Source>;
export const Requirement = z.strictObject({
  id: Id, text: z.string().min(1).max(2000), excerpt: z.string().min(1).max(4000),
  category: z.enum(['required', 'experience', 'preferred', 'unclear']),
});
export type Requirement = z.infer<typeof Requirement>;
export const Snapshot = z.strictObject({
  id: Id, hash: Short, title: Short, company: Short, description: z.string().max(150000),
  location: z.string().max(500).nullable(), workMode: z.enum(['remote', 'hybrid', 'onsite']).nullable(),
  seniority: z.string().nullable(), salaryMin: z.number().nullable(), salaryMax: z.number().nullable(),
  currency: z.string().nullable(), workAuthorization: z.string().nullable(),
  url: z.string().url().nullable(), applyUrl: z.string().url().nullable(), createdAt: z.string(),
  requirements: z.array(Requirement).max(120), analysis: Selection.extend({ promptVersion: z.string() }).nullable(),
});
export type Snapshot = z.infer<typeof Snapshot>;
export const Job = z.strictObject({
  id: Id, sourceId: Id.nullable(), externalId: Short, snapshotId: Id,
  firstSeen: z.string(), lastSeen: z.string(), active: z.boolean(), missingCount: z.number().int(),
  possibleDuplicate: Id.nullable(),
});
export type Job = z.infer<typeof Job>;
export const Match = z.strictObject({
  id: Id, jobId: Id, snapshotId: Id, profileVersion: z.number().int(), preferencesVersion: z.number().int(),
  scoringVersion: z.literal('1'), score: z.number().nullable(), coverage: z.number(),
  eligibility: z.enum(['eligible', 'ineligible', 'needs-review']),
  constraints: z.array(z.string()),
  components: z.array(z.strictObject({ name: z.string(), weight: z.number(), score: z.number().nullable() })),
  evidence: z.array(z.strictObject({ requirementId: Id, factIds: z.array(Id), status: z.enum(['supported', 'partial', 'not-demonstrated']) })),
  createdAt: z.string(),
});
export type Match = z.infer<typeof Match>;
export const Ranking = z.strictObject({
  id: Id, jobId: Id, snapshotId: Id, status: z.enum(['pending', 'queued', 'running', 'completed', 'failed', 'interrupted']),
  selection: Selection.nullable(), profileVersion: z.number().int().nullable(), preferences: Preferences.nullable(),
  score: z.number().min(0).max(100).nullable(), summary: z.string().max(4000),
  strengths: z.array(z.strictObject({ factId: Id, factExcerpt: z.string().max(4000), jobExcerpt: z.string().max(4000), explanation: z.string().max(2000) })),
  gaps: z.array(z.string().max(2000)), unknowns: z.array(z.string().max(2000)),
  error: z.string().nullable(), promptVersion: z.string(), createdAt: z.string(), completedAt: z.string().nullable(),
});
export type Ranking = z.infer<typeof Ranking>;
export const Application = z.strictObject({
  id: Id, jobId: Id, status: z.enum(['saved', 'drafting', 'applied', 'archived', 'dismissed']),
  appliedDate: z.string().nullable(), updatedAt: z.string(),
});
export const Claim = z.strictObject({ text: z.string().max(4000), factIds: z.array(Id).max(20) });
export type Claim = z.infer<typeof Claim>;
export const Draft = z.strictObject({
  id: Id, applicationId: Id, jobId: Id, snapshotId: Id, profileVersion: z.number().int(),
  type: z.enum(['resume', 'cover-letter']), text: z.string().max(60000), claims: z.array(Claim),
  issues: z.array(z.string()), reviewed: z.boolean(), revision: z.number().int(), createdAt: z.string(),
  selection: Selection.nullable(), promptVersion: z.string(),
});
export type Draft = z.infer<typeof Draft>;
export const Task = z.strictObject({
  id: Id, key: Short, kind: z.enum(['refresh', 'extract', 'analyze', 'draft', 'smoke', 'rank']),
  targetId: Id.nullable(), status: z.enum(['queued', 'running', 'completed', 'failed', 'interrupted']),
  selection: Selection.nullable(), attempts: z.number().int(), error: z.string().nullable(),
  createdAt: z.string(), finishedAt: z.string().nullable(),
});
export type Task = z.infer<typeof Task>;
export const Usage = z.strictObject({ taskId: Id, date: z.string(), provider: Provider, model: z.string(), input: z.number(), output: z.number() });
export const DocumentRecord = z.strictObject({
  id: Id, path: z.string().regex(/^uploads\/[a-f0-9-]+\.(pdf|txt)$/), mime: z.enum(['application/pdf', 'text/plain']), text: z.string().max(100000), createdAt: z.string(),
});
export const ApplicationField = z.strictObject({
  index: z.number().int().nonnegative(), label: z.string().max(4000), name: z.string().max(500),
  type: z.string().max(50), required: z.boolean(), options: z.array(z.strictObject({ value: z.string().max(4000), label: z.string().max(4000) })).max(500),
  value: z.string().max(60000), attachment: z.enum(['', 'resume', 'cover-letter']),
  group: z.string().max(4000).optional(), groupRequired: z.boolean().optional(),
});
export type ApplicationField = z.infer<typeof ApplicationField>;
export const ApplicationForm = z.strictObject({
  root: z.enum(['form', 'body']).optional(),
  url: z.string().url(), frameUrl: z.string().url(), formIndex: z.number().int().nonnegative(),
  action: z.string().max(4000), method: z.string().max(30), button: z.string().max(500), fields: z.array(ApplicationField).min(1).max(150),
});
export type ApplicationForm = z.infer<typeof ApplicationForm>;
export const Submission = z.strictObject({
  id: Id, jobId: Id, snapshotId: Id, resumeId: Id, letterId: Id,
  status: z.enum(['preparing', 'review', 'submitting', 'submitted', 'blocked', 'uncertain']),
  form: ApplicationForm.nullable(), reviewToken: z.string(), error: z.string().nullable(), receipt: z.string().nullable(),
  createdAt: z.string(), approvedAt: z.string().nullable(), finishedAt: z.string().nullable(),
});
export type Submission = z.infer<typeof Submission>;
export const State = z.strictObject({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), updatedAt: z.string(),
  settings: Settings, profileVersion: z.number().int().nonnegative(), facts: z.array(Fact),
  profileVersions: z.array(z.strictObject({ version: z.number().int(), facts: z.array(Fact), createdAt: z.string() })),
  preferences: Preferences, sources: z.array(Source).max(5000), jobs: z.array(Job), snapshots: z.array(Snapshot),
  matches: z.array(Match), applications: z.array(Application), drafts: z.array(Draft), tasks: z.array(Task),
  rankings: z.array(Ranking).default([]),
  submissions: z.array(Submission).default([]),
  documents: z.array(DocumentRecord), usage: z.array(Usage),
  feedFilters: z.strictObject({ search: z.string().max(200), status: z.string().max(30), location: z.string().max(200), showIneligible: z.boolean() }),
});
export type State = z.infer<typeof State>;

export function initialState(): State {
  return State.parse({
    schemaVersion: 1, revision: 0, updatedAt: new Date().toISOString(),
    settings: { provider: 'openai', model: 'gpt-4.1-mini', dailyRefresh: false, dailyRequestLimit: 30, dailyTokenLimit: 200000, aiConsent: false },
    profileVersion: 0, facts: [], profileVersions: [],
    preferences: {
      version: 0, roles: { value: '', hard: false }, location: { value: '', hard: false },
      workMode: { value: '', hard: false }, seniority: { value: '', hard: false },
      compensation: { minimum: null, currency: '', hard: false }, workAuthorization: { value: '', hard: false },
    },
    sources: [], jobs: [], snapshots: [], matches: [], applications: [], drafts: [], tasks: [], documents: [], usage: [], rankings: [],
    feedFilters: { search: '', status: 'active', location: '', showIneligible: false },
  });
}

export function profileReady(state: State): boolean {
  return ['experience', 'skill'].every(kind => state.facts.some(fact => fact.kind === kind && fact.verified));
}

export function validateReferences(state: State): void {
  const requireRef = (ok: boolean) => { if (!ok) throw new Error('Invalid data references. Restore a complete Job Scout backup.'); };
  const snapshots = new Map(state.snapshots.map(s => [s.id, s]));
  const jobs = new Map(state.jobs.map(j => [j.id, j]));
  const documents = new Set(state.documents.map(d => d.id));
  const sources = new Set(state.sources.map(s => s.id));
  const applications = new Map(state.applications.map(a => [a.id, a]));
  const versions = new Map(state.profileVersions.map(v => [v.version, v]));
  requireRef(new Set(state.rankings.map(r => r.jobId)).size === state.rankings.length);
  for (const ranking of state.rankings) {
    requireRef(jobs.has(ranking.jobId) && snapshots.has(ranking.snapshotId));
    if (ranking.profileVersion !== null) requireRef(versions.has(ranking.profileVersion));
    const facts = new Map(versions.get(ranking.profileVersion ?? -1)?.facts.map(f => [f.id, f]));
    requireRef(ranking.strengths.every(s => Boolean(facts.get(s.factId)?.value.includes(s.factExcerpt)) && Boolean(snapshots.get(ranking.snapshotId)?.description.includes(s.jobExcerpt))));
  }
  const drafts = new Map(state.drafts.map(d => [d.id, d]));
  for (const packet of state.submissions) {
    requireRef(jobs.has(packet.jobId) && snapshots.has(packet.snapshotId));
    requireRef(drafts.get(packet.resumeId)?.jobId === packet.jobId && drafts.get(packet.resumeId)?.type === 'resume');
    requireRef(drafts.get(packet.letterId)?.jobId === packet.jobId && drafts.get(packet.letterId)?.type === 'cover-letter');
  }
  for (const collection of [state.facts, state.sources, state.jobs, state.snapshots, state.applications, state.drafts, state.tasks, state.documents, state.submissions]) {
    requireRef(new Set(collection.map(item => item.id)).size === collection.length);
  }
  requireRef(new Set(state.profileVersions.map(item => item.version)).size === state.profileVersions.length);
  for (const job of state.jobs) {
    requireRef(snapshots.has(job.snapshotId));
    requireRef(job.sourceId === null || sources.has(job.sourceId));
    requireRef(job.possibleDuplicate === null || jobs.has(job.possibleDuplicate));
  }
  for (const fact of [...state.facts, ...state.profileVersions.flatMap(v => v.facts)]) {
    requireRef(fact.documentId === null || documents.has(fact.documentId));
    requireRef(fact.verified === Boolean(fact.confirmedAt));
  }
  for (const app of state.applications) requireRef(jobs.has(app.jobId));
  for (const draft of state.drafts) {
    requireRef(snapshots.has(draft.snapshotId));
    requireRef(applications.get(draft.applicationId)?.jobId === draft.jobId);
    requireRef(versions.has(draft.profileVersion));
    const facts = new Set(versions.get(draft.profileVersion)?.facts.map(f => f.id));
    requireRef(draft.claims.every(c => c.factIds.every(id => facts.has(id))));
  }
  for (const match of state.matches) {
    requireRef(jobs.has(match.jobId));
    requireRef(snapshots.has(match.snapshotId));
    const requirements = new Set(snapshots.get(match.snapshotId)?.requirements.map(r => r.id));
    const facts = new Set(versions.get(match.profileVersion)?.facts.map(f => f.id));
    requireRef(match.evidence.every(e => requirements.has(e.requirementId) && e.factIds.every(id => facts.has(id))));
  }
}
