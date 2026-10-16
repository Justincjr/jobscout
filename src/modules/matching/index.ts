import { randomUUID } from 'node:crypto';
import { Fact, Match, Snapshot, State, profileReady } from '../../shared/schema.js';

const aliases: Record<string, string[]> = {
  javascript: ['javascript', 'js', 'ecmascript'], typescript: ['typescript', 'ts'],
  react: ['react', 'reactjs', 'react.js'], node: ['nodejs', 'node.js', 'node'],
  python: ['python'], sql: ['sql', 'postgresql', 'postgres', 'mysql'],
  aws: ['aws', 'amazon web services'], kubernetes: ['kubernetes', 'k8s'],
  java: ['java'], go: ['golang', 'go'], rust: ['rust'], csharp: ['c#', 'csharp', '.net'],
  design: ['product design', 'ux', 'user experience'], leadership: ['leadership', 'team lead', 'led a team', 'manage a team'],
  analysis: ['data analysis', 'data analytics'], machinelearning: ['machine learning', 'ml'],
  docker: ['docker'], terraform: ['terraform'], excel: ['excel'], figma: ['figma'],
};
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function contains(text: string, term: string): boolean { return new RegExp(`(^|[^a-z0-9])${escape(term)}(?=$|[^a-z0-9])`, 'i').test(text); }
export function skillsIn(text: string): string[] {
  const normalized = text.replace(/\breact\.js\b/gi, 'reactjs').replace(/\bnode\.js\b/gi, 'nodejs');
  return Object.entries(aliases).filter(([, terms]) => terms.some(term => contains(normalized, term))).map(([key]) => key);
}

export function evidenceFor(text: string, facts: Fact[]): { factIds: string[]; status: 'supported' | 'partial' | 'not-demonstrated' } {
  const targets = skillsIn(text);
  const verified = facts.filter(f => f.verified);
  const exact = verified.filter(f => f.value.toLowerCase() === text.toLowerCase());
  if (exact.length) return { factIds: exact.map(f => f.id), status: 'supported' };
  if (!targets.length) return { factIds: [], status: 'not-demonstrated' };
  const supported = verified.filter(f => targets.some(skill => skillsIn(f.value).includes(skill)));
  const covered = targets.filter(skill => supported.some(f => skillsIn(f.value).includes(skill)));
  // Skills alone do not prove responsibility, duration, metrics, or credentials.
  const simple = text.replace(/^(experience (?:with|in)|proficien(?:t|cy) (?:with|in)|knowledge of|skills?:)\s+/i, '');
  const onlySkills = simple.split(/[,/&]|\band\b|\bor\b/i).every(part => Object.values(aliases).flat().some(term => term.toLowerCase() === part.trim().replace(/[.;]$/, '').toLowerCase()));
  return { factIds: supported.map(f => f.id), status: covered.length === targets.length && onlySkills ? 'supported' : covered.length ? 'partial' : 'not-demonstrated' };
}

export function matchJob(state: State, jobId: string, snapshot: Snapshot): Match {
  const p = state.preferences;
  const constraints: string[] = [];
  let eligibility: Match['eligibility'] = 'eligible';
  const evaluate = (label: string, wanted: string, actual: string | null, hard: boolean) => {
    if (!wanted || !hard) return;
    if (!actual) { constraints.push(`${label}: not disclosed; review required.`); if (eligibility !== 'ineligible') eligibility = 'needs-review'; }
    else if (!wanted.split(',').some(value => actual.toLowerCase().includes(value.trim().toLowerCase()))) {
      constraints.push(`${label}: conflicts with your hard constraint (${wanted}).`); eligibility = 'ineligible';
    }
  };
  evaluate('Role', p.roles.value, snapshot.title, p.roles.hard);
  evaluate('Location', p.location.value, snapshot.location, p.location.hard);
  evaluate('Work mode', p.workMode.value, snapshot.workMode, p.workMode.hard);
  evaluate('Seniority', p.seniority.value, snapshot.seniority, p.seniority.hard);
  evaluate('Work authorization', p.workAuthorization.value, snapshot.workAuthorization, p.workAuthorization.hard);
  if (p.compensation.minimum !== null && p.compensation.hard) {
    if (snapshot.salaryMax === null || !snapshot.currency || p.compensation.currency.toLowerCase() !== snapshot.currency.toLowerCase()) {
      constraints.push('Compensation: comparable annual salary/currency not disclosed; review required.');
      if ((eligibility as Match['eligibility']) !== 'ineligible') eligibility = 'needs-review';
    } else if (snapshot.salaryMax < p.compensation.minimum) { eligibility = 'ineligible'; constraints.push('Compensation: below your annual minimum.'); }
  }
  const evidence = snapshot.requirements.map(r => ({ requirementId: r.id, ...evidenceFor(r.text, state.facts) }));
  const value = (status: string) => status === 'supported' ? 1 : status === 'partial' ? 0.5 : 0;
  const component = (category: string, name: string, weight: number) => {
    const rows = snapshot.requirements.flatMap((r, i) => r.category === category ? [evidence[i]] : []);
    return { name, weight, score: rows.length ? rows.reduce((sum, e) => sum + value(e.status), 0) / rows.length : null };
  };
  const soft: number[] = [];
  for (const [preference, actual] of [[p.location, snapshot.location], [p.workMode, snapshot.workMode], [p.seniority, snapshot.seniority]] as const) {
    if (preference.value && !preference.hard && actual) soft.push(preference.value.split(',').some(v => contains(actual, v.trim())) ? 1 : 0);
  }
  if (!p.compensation.hard && p.compensation.minimum !== null && snapshot.salaryMax !== null && snapshot.currency?.toLowerCase() === p.compensation.currency.toLowerCase()) soft.push(snapshot.salaryMax >= p.compensation.minimum ? 1 : 0);
  const title = p.roles.value ? p.roles.value.split(',').some(role => snapshot.title.toLowerCase().includes(role.trim().toLowerCase())) ? 1 : 0 : null;
  const components = [component('required', 'Required skills & responsibilities', 40), component('experience', 'Experience & seniority', 25),
    component('preferred', 'Preferred skills & domain', 15), { name: 'Role alignment', weight: 10, score: title },
    { name: 'Soft preferences', weight: 10, score: soft.length ? soft.reduce((a, b) => a + b, 0) / soft.length : null }];
  const assessed = components.filter(c => c.score !== null);
  const denominator = assessed.reduce((sum, c) => sum + c.weight, 0);
  return { id: randomUUID(), jobId, snapshotId: snapshot.id, profileVersion: state.profileVersion, preferencesVersion: p.version, scoringVersion: '1',
    score: denominator ? Math.round(assessed.reduce((sum, c) => sum + c.score! * c.weight, 0) / denominator * 100) : null,
    coverage: denominator, eligibility, constraints, components, evidence, createdAt: new Date().toISOString() };
}

export function recompute(state: State): void {
  if (!profileReady(state)) { state.matches = []; return; }
  const snapshots = new Map(state.snapshots.map(s => [s.id, s]));
  state.matches = state.jobs.filter(j => j.active).map(j => matchJob(state, j.id, snapshots.get(j.snapshotId)!));
}
