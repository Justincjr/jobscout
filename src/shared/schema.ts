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
  id: Id, name: Short, provider: z.enum(['greenhouse', 'lever', 'lever-eu']), board: Short,
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
  id: Id, key: Short, kind: z.enum(['refresh', 'extract', 'analyze', 'draft', 'smoke']),
  targetId: Id.nullable(), status: z.enum(['queued', 'running', 'completed', 'failed', 'interrupted']),
  selection: Selection.nullable(), attempts: z.number().int(), error: z.string().nullable(),
  createdAt: z.string(), finishedAt: z.string().nullable(),
});
export type Task = z.infer<typeof Task>;
export const Usage = z.strictObject({ taskId: Id, date: z.string(), provider: Provider, model: z.string(), input: z.number(), output: z.number() });
export const DocumentRecord = z.strictObject({
  id: Id, path: z.string().regex(/^uploads\/[a-f0-9-]+\.(pdf|txt)$/), mime: z.enum(['application/pdf', 'text/plain']), text: z.string().max(100000), createdAt: z.string(),
});
export const State = z.strictObject({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), updatedAt: z.string(),
  settings: Settings, profileVersion: z.number().int().nonnegative(), facts: z.array(Fact),
  profileVersions: z.array(z.strictObject({ version: z.number().int(), facts: z.array(Fact), createdAt: z.string() })),
  preferences: Preferences, sources: z.array(Source).max(5000), jobs: z.array(Job), snapshots: z.array(Snapshot),
  matches: z.array(Match), applications: z.array(Application), drafts: z.array(Draft), tasks: z.array(Task),
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
    sources: [], jobs: [], snapshots: [], matches: [], applications: [], drafts: [], tasks: [], documents: [], usage: [],
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
  for (const collection of [state.facts, state.sources, state.jobs, state.snapshots, state.applications, state.drafts, state.tasks, state.documents]) {
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
