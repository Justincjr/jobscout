import { FormEvent, useState } from 'react';
import { ScreenProps } from '../main';
import { Badge, Empty, Field, Icon, timeAgo } from '../ui';

export function Companies({ data, mutate, notify }: ScreenProps) {
  const [name, setName] = useState(''), [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const following = data.state.sources.filter(s => s.enabled);
  const add = async (name: string, url: string) => {
    setBusy(true);
    try { await mutate('/api/sources', { name, url }); setName(''); setUrl(''); notify('Career source added. Refresh to verify that its published jobs can be read.'); }
    catch {} finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); void add(name, url); };
  const toggle = (id: string, enabled: boolean) => {
    void mutate(`/api/sources/${id}`, { enabled }, 'PUT').then(() => notify(enabled ? 'Company followed again.' : 'Company unfollowed. Existing jobs and drafts are retained; automatic refresh is stopped.')).catch(() => undefined);
  };
  return <>
    <section className="page-heading"><div><div className="eyebrow">CHOOSE WHERE YOU WANT TO GO</div><h1>Good companies. Open doors.</h1><p>Follow the places you’re curious about. Bring their opportunities into view.</p></div><Badge>{following.length} / 50 followed boards</Badge></section>
    <div className="two-columns top-aligned">
      <section className="panel"><h2>Follow a company board</h2><p className="muted">Connect Greenhouse, Lever, Ashby, Workday, Shopee, or a public company career page. Custom pages use structured job data or readable job-detail pages; JavaScript-only sites may need a dedicated integration.</p>
        <form onSubmit={submit}>
          <Field label="Company name"><input required value={name} onChange={e => setName(e.target.value)}/></Field>
          <Field label="Career board URL" help="Paste the public listing URL. Workday uses *.myworkdayjobs.com/site; Shopee listing filters are preserved."><input required type="url" value={url} onChange={e => setUrl(e.target.value)}/></Field>
          <button className="primary" disabled={busy}><Icon name="plus" size={16}/>Follow company</button>
        </form>
      </section>
      <section className="panel starter-panel"><div className="eyebrow">A FEW PLACES TO START</div><h2>Follow your curiosity.</h2><p className="muted">A small starter collection of public company boards. Availability is checked when you refresh.</p>
        {data.starters.map(company => <div className="starter-row" key={company.name}>
          <div className={`company-monogram color-${company.name.length % 4}`}>{company.name[0]}</div>
          <div><strong>{company.name}</strong><small>{company.url.includes('shopee') ? 'Shopee · internship filter' : company.url.includes('ashbyhq') ? 'Ashby' : company.url.includes('lever') ? 'Lever' : 'Greenhouse'} board</small></div>
          <button className="secondary small" disabled={busy || following.some(s => s.url === company.url)} onClick={() => { void add(company.name, company.url); }}>{following.some(s => s.url === company.url) ? 'Following' : 'Follow'}<Icon name="plus" size={14}/></button>
        </div>)}
      </section>
    </div>
    <section className="panel"><div className="section-heading"><div><h2>Your company boards</h2><p>Failed or incomplete refreshes never close jobs. Two complete absences are needed.</p></div></div>
      {!data.state.sources.length ? <Empty icon="building" title="Start with a company you admire.">Follow its supported career board to collect published openings.</Empty> : data.state.sources.map(source => <div className="source-row" key={source.id}>
        <div className={`company-monogram color-${source.name.length % 4}`}>{source.name[0]}</div>
        <div className="source-content">
          <strong>{source.name} <Badge>{source.provider}</Badge>{!source.enabled && <Badge>Unfollowed</Badge>}</strong>
          <a href={source.url} target="_blank" rel="noreferrer">{source.url}<Icon name="external" size={12}/></a>
          <small>Last successful refresh: {timeAgo(source.lastSuccess)}{source.lastSuccess && Date.now() - Date.parse(source.lastSuccess) > 86400000 ? ' · overdue' : ''}</small>
          {source.error && <div className="warning-box">{source.error}</div>}{!source.lastSuccess && !source.error && <small>Board added; connection has not been verified by a successful refresh.</small>}
        </div>
        <button className="subtle small" onClick={() => toggle(source.id, !source.enabled)}>{source.enabled ? 'Unfollow' : 'Follow again'}</button>
        <button className="secondary" disabled={!source.enabled || data.state.tasks.some(t => t.targetId === source.id && ['queued', 'running'].includes(t.status))} onClick={() => { void mutate('/api/tasks', { kind: 'refresh', targetId: source.id }).catch(() => undefined); }}><Icon name="refresh" size={16}/>Refresh</button>
      </div>)}
    </section>
  </>;
}
