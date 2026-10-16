import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { matchJob, evidenceFor, skillsIn, recompute } from '../src/modules/matching/index.js';
import { newFact, redactContacts } from '../src/modules/profile/index.js';
import { addJob, confirmedState } from './helpers.js';

describe('explainable matching', () => {
  it('normalizes controlled aliases without substring collisions', () => {
    expect(skillsIn('React.js, k8s, Amazon Web Services')).toEqual(['react', 'aws', 'kubernetes']);
    expect(skillsIn('Django, reactive, PostgreSQL')).toEqual(['sql']);
  });
  it('excludes unconfirmed facts', () => {
    expect(evidenceFor('React', [newFact('skill', 'React')]).status).toBe('not-demonstrated');
    const state = confirmedState(); state.facts.forEach(f => { f.verified = false; f.confirmedAt = null; });
    addJob(state); recompute(state); expect(state.matches).toEqual([]);
  });
  it('does not turn skill mentions into proven years or responsibility', () => {
    const state = confirmedState();
    expect(evidenceFor('5 years of React leadership', state.facts).status).toBe('partial');
    expect(evidenceFor('Experience with React', state.facts).status).toBe('supported');
  });
  it('excludes absent components from denominator and reports coverage', () => {
    const state = confirmedState(), id = addJob(state);
    const snapshot = state.snapshots[0]; snapshot.requirements = [{ id: randomUUID(), text: 'React', excerpt: 'React', category: 'required' }];
    const match = matchJob(state, id, snapshot);
    expect(match.score).toBe(100); expect(match.coverage).toBe(40);
  });
  it('shows insufficient information instead of a zero score', () => {
    const state = confirmedState(), id = addJob(state);
    state.snapshots[0].requirements = [];
    expect(matchJob(state, id, state.snapshots[0]).score).toBeNull();
  });
  it('uses 1, 0.5, and 0 with the documented weights', () => {
    const state = confirmedState(), id = addJob(state);
    const snapshot = state.snapshots[0];
    snapshot.requirements = [
      { id: randomUUID(), text: 'React', excerpt: 'React', category: 'required' },
      { id: randomUUID(), text: '5 years React', excerpt: '5 years React', category: 'experience' },
      { id: randomUUID(), text: 'Python', excerpt: 'Python', category: 'preferred' },
    ];
    const match = matchJob(state, id, snapshot);
    expect(match.score).toBe(66); expect(match.coverage).toBe(80);
    expect(match.evidence.map(e => e.status)).toEqual(['supported', 'partial', 'not-demonstrated']);
  });
  it('keeps unknown constraints visible and flags only explicit conflicts', () => {
    const state = confirmedState(), id = addJob(state);
    state.preferences.workMode = { value: 'remote', hard: true };
    expect(matchJob(state, id, state.snapshots[0]).eligibility).toBe('needs-review');
    state.preferences.location = { value: 'London', hard: true };
    expect(matchJob(state, id, state.snapshots[0]).eligibility).toBe('ineligible');
  });
  it('does not compare incompatible currencies or infer authorization', () => {
    const state = confirmedState(), id = addJob(state, { salaryMax: 100000, currency: 'USD' });
    state.preferences.compensation = { minimum: 50000, currency: 'SGD', hard: true };
    state.preferences.workAuthorization = { value: 'sponsorship', hard: true };
    const match = matchJob(state, id, state.snapshots[0]);
    expect(match.eligibility).toBe('needs-review'); expect(match.constraints).toHaveLength(2);
  });
  it('redacts contact details without removing employment date ranges', () => {
    const text = redactContacts('jane@example.com +65 9123 4567 2020 - 2024 github.com/jane');
    expect(text).not.toContain('jane@example'); expect(text).not.toContain('9123'); expect(text).toContain('2020 - 2024');
  });
});
