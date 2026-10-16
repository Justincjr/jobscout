import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { initialState, State } from '../src/shared/schema.js';
import { newFact, bumpProfile } from '../src/modules/profile/index.js';
import { IncomingJob, makeSnapshot } from '../src/modules/sources/index.js';

export function confirmedState(): State {
  const state = initialState();
  state.facts = [newFact('experience', 'Software engineer at Acme, 2020–2024. Built React dashboards.'), newFact('skill', 'React'), newFact('skill', 'TypeScript'), newFact('achievement', 'Reduced build time by 25% at Acme.')];
  for (const fact of state.facts) { fact.verified = true; fact.confirmedAt = new Date().toISOString(); }
  bumpProfile(state);
  return state;
}
export function incoming(overrides: Partial<IncomingJob> = {}): IncomingJob {
  return { externalId: 'job-1', title: 'Software Engineer', company: 'Acme', description: 'Requirements\nExperience with React\nTypeScript\nResponsibilities\nBuild dashboards for the operations team.\nPreferred\nKnowledge of Python', location: 'Singapore', workMode: null, seniority: null, salaryMin: null, salaryMax: null, currency: null, workAuthorization: null, url: 'https://example.com/job', applyUrl: 'https://example.com/job/apply', ...overrides };
}
export function addJob(state: State, overrides: Partial<IncomingJob> = {}): string {
  const snapshot = makeSnapshot(incoming(overrides)), id = randomUUID(), now = new Date().toISOString();
  state.snapshots.push(snapshot);
  state.jobs.push({ id, sourceId: null, externalId: randomUUID(), snapshotId: snapshot.id, firstSeen: now, lastSeen: now, active: true, missingCount: 0, possibleDuplicate: null });
  return id;
}
export async function testDirectory(): Promise<string> {
  const root = path.resolve('.cache/tests');
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, 'case-'));
}
export async function removeTestDirectory(directory: string): Promise<void> {
  if (!path.resolve(directory).startsWith(path.resolve('.cache/tests') + path.sep)) throw new Error('Test cleanup escaped its workspace.');
  await fs.rm(directory, { recursive: true, force: true });
}
