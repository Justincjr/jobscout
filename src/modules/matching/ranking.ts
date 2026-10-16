import { randomUUID } from 'node:crypto';
import { Ranking, State } from '../../shared/schema.js';

export const RANK_PROMPT_VERSION = 'rank-v1';
export function stageNewRanking(state: State, jobId: string, snapshotId: string): void {
  if (state.rankings.some(r => r.jobId === jobId)) return;
  const snapshot = state.snapshots.find(s => s.id === snapshotId)!;
  const shared = reusableRanking(state, snapshotId);
  if (shared) {
    state.rankings.push({ ...structuredClone(shared), id: randomUUID(), jobId, snapshotId: snapshot.id, createdAt: new Date().toISOString() });
    return;
  }
  state.rankings.push({ id: randomUUID(), jobId, snapshotId, status: 'pending', selection: null,
    profileVersion: null, preferences: null, score: null, summary: '', strengths: [], gaps: [], unknowns: [],
    error: null, promptVersion: RANK_PROMPT_VERSION, createdAt: new Date().toISOString(), completedAt: null });
}
export function reusableRanking(state: State, snapshotId: string): Ranking | undefined {
  if (!state.rankings.some(r => r.status === 'completed')) return;
  const snapshot = state.snapshots.find(s => s.id === snapshotId)!;
  if (!snapshot.url) return;
  const snapshots = new Map(state.snapshots.map(s => [s.id, s]));
  return state.rankings.find(r => {
    const prior = snapshots.get(r.snapshotId);
    return r.status === 'completed' && prior?.url === snapshot.url && prior.title === snapshot.title && prior.description === snapshot.description;
  });
}
export function rankingStale(state: State, ranking: Ranking, currentSnapshotId?: string): boolean {
  return ranking.profileVersion !== state.profileVersion || ranking.preferences?.version !== state.preferences.version
    || (currentSnapshotId ?? state.jobs.find(j => j.id === ranking.jobId)?.snapshotId) !== ranking.snapshotId;
}
