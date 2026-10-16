import { JobRow } from '../api';
import { ScreenProps } from '../main';
import { Badge, Icon } from '../ui';

export function RankingScore({ row }: { row: JobRow }) {
  const ranking = row.ranking;
  if (ranking?.status === 'completed') return <><span className="match-score">{ranking.score}<small>/100 AI alignment</small></span><span className="coverage">{row.rankingStale ? 'Earlier profile or posting' : 'Ranked once · saved'}</span></>;
  if (ranking) return <span className="muted small">{ranking.status === 'pending' ? 'Awaiting AI ranking · setup and daily budget apply' : ranking.status === 'failed' || ranking.status === 'interrupted' ? 'AI ranking needs explicit retry' : 'AI ranking ' + ranking.status}</span>;
  return row.match?.score !== undefined && row.match.score !== null
    ? <><span className="match-score">{row.match.score}<small>% local alignment</small></span><span className="coverage">{row.match.coverage}% coverage · existing job</span></>
    : <span className="muted small">Confirm your profile to see alignment</span>;
}

export function RankingView({ row, data, mutate }: Pick<ScreenProps, 'data' | 'mutate'> & { row: JobRow }) {
  const ranking = row.ranking;
  const facts = data.state.profileVersions.find(v => v.version === ranking?.profileVersion)?.facts ?? [];
  return <section className="panel" style={{ marginTop: 20 }}>
    <div className="section-heading"><div><h3>LLM assessment</h3><p>Each new posting is sent once. Refreshes reuse the saved result.</p></div>
      <button className="primary" disabled={ranking && ['queued', 'running', 'completed'].includes(ranking.status)} onClick={() => { void mutate('/api/tasks', { kind: 'rank', targetId: row.job.id }).catch(() => undefined); }}><Icon name="spark" size={15}/>{ranking?.status === 'completed' ? 'Ranking saved' : ranking?.status === 'failed' || ranking?.status === 'interrupted' ? 'Retry ranking explicitly' : 'Rank this job'}</button>
    </div>
    {ranking?.status === 'completed' ? <>
      <div className="score-summary"><strong>{ranking.score}<small>/ 100</small></strong><div><b>{ranking.selection?.provider} / {ranking.selection?.model}</b><p>Profile version {ranking.profileVersion} · {new Date(ranking.completedAt!).toLocaleString()}</p></div></div>
      {row.rankingStale && <div className="warning-box">Your profile, preferences, or this posting changed after ranking. This saved assessment uses the earlier snapshot; it has not been sent again.</div>}
      <p>{ranking.summary}</p>
      {ranking.strengths.map((strength, i) => <div className="evidence-row" key={i}><Badge tone="green">AI assessment · cited evidence</Badge><p>{strength.explanation}</p><blockquote>Job: {strength.jobExcerpt}</blockquote><blockquote>Profile: {strength.factExcerpt}<br/><small>Confirmed fact: {facts.find(f => f.id === strength.factId)?.kind}</small></blockquote></div>)}
      {!!ranking.gaps.length && <><h3>Not demonstrated in your profile</h3><ul>{ranking.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul></>}
      {!!ranking.unknowns.length && <><h3>Unknown or needs review</h3><ul>{ranking.unknowns.map((unknown, i) => <li key={i}>{unknown}</li>)}</ul></>}
      <p className="small muted">Model judgments can be wrong. The score measures alignment, not interview probability. Hard constraints are checked separately below.</p>
    </> : <div className={ranking?.error ? 'warning-box' : 'info-box'}>{ranking?.error ?? (ranking ? `Ranking ${ranking.status}. New jobs wait for a confirmed profile, an enabled AI provider with a key, and available daily budget.` : 'This job existed before automatic ranking was enabled. It will not be sent automatically. You can explicitly rank it here.')}</div>}
  </section>;
}
