import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { addJob, confirmedState } from './helpers.js';
import { matchJob } from '../src/modules/matching/index.js';
import { createDrafts } from '../src/modules/drafts/index.js';

// Synthetic, manually labeled rubric cases. No personal resume or job data.
const cases = [
  ['React frontend', 'React', 'required', 100, 'eligible'],
  ['TypeScript frontend', 'TypeScript', 'required', 100, 'eligible'],
  ['React + TypeScript', 'React and TypeScript', 'required', 100, 'eligible'],
  ['React.js alias', 'React.js', 'required', 100, 'eligible'],
  ['Duration not proven', '5 years React experience', 'experience', 50, 'eligible'],
  ['Leadership not proven', 'Lead React engineering teams', 'experience', 50, 'eligible'],
  ['Domain not proven', 'Build financial React applications', 'required', 50, 'eligible'],
  ['Partial stack', 'React and Python', 'required', 50, 'eligible'],
  ['Python gap', 'Python', 'required', 0, 'eligible'],
  ['Java gap', 'Java', 'required', 0, 'eligible'],
  ['Go gap', 'Golang', 'required', 0, 'eligible'],
  ['Kubernetes gap', 'K8s', 'required', 0, 'eligible'],
  ['Unknown credential', 'Certified cloud architect', 'preferred', 0, 'eligible'],
  ['Unknown management', 'Manage 20 engineers', 'experience', 0, 'eligible'],
  ['Known preferred skill', 'React', 'preferred', 100, 'eligible'],
  ['Unknown authorization', 'React', 'required', 100, 'needs-review'],
  ['Unknown work mode', 'React', 'required', 100, 'needs-review'],
  ['Conflicting location', 'React', 'required', 100, 'ineligible'],
  ['Unknown salary', 'React', 'required', 100, 'needs-review'],
  ['Conflicting salary', 'React', 'required', 100, 'ineligible'],
] as const;
describe('20 labeled relevance and draft evaluation pairs', () => {
  it.each(cases)('%s', (label, requirement, category, expectedScore, eligibility) => {
    const state = confirmedState();
    const jobId = addJob(state), snapshot = state.snapshots[0];
    snapshot.requirements = [{ id: randomUUID(), text: requirement, excerpt: requirement, category }];
    if (label === 'Unknown authorization') state.preferences.workAuthorization = { value: 'sponsorship available', hard: true };
    if (label === 'Unknown work mode') state.preferences.workMode = { value: 'remote', hard: true };
    if (label === 'Conflicting location') state.preferences.location = { value: 'London', hard: true };
    if (label.includes('salary')) state.preferences.compensation = { minimum: 80000, currency: 'SGD', hard: true };
    if (label === 'Conflicting salary') { snapshot.salaryMax = 70000; snapshot.currency = 'SGD'; }
    const match = matchJob(state, jobId, snapshot);
    expect(match.score).toBe(expectedScore); expect(match.eligibility).toBe(eligibility);
    for (const e of match.evidence) expect(e.factIds.every(id => state.facts.some(f => f.id === id && f.verified))).toBe(true);
    const facts = state.profileVersions[0].facts;
    const drafts = createDrafts(state, jobId, snapshot, state.profileVersion, facts, { resumeFactIds: facts.map(f => f.id), letterFactIds: [facts[0].id] }, null);
    for (const draft of drafts) expect(draft.issues).toEqual([]);
  });
});
