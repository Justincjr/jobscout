import { useEffect, useState } from 'react';
import { ScreenProps } from '../main';
import { JobRow } from '../api';
import { ApplicationField } from '../../shared/schema';
import { Badge, Field } from '../ui';
import './ApplicationReview.css';

export function ApplicationReview({ row, data, mutate, notify }: ScreenProps & { row: JobRow }) {
  const packet = data.state.submissions.filter(p => p.jobId === row.job.id).at(-1);
  const [fields, setFields] = useState<ApplicationField[]>([]), [approved, setApproved] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { setFields(packet?.form?.fields ?? []); setApproved(false); }, [packet?.id, packet?.reviewToken, packet?.status]);
  const drafts = (['resume', 'cover-letter'] as const).map(type => data.state.drafts.filter(d => d.jobId === row.job.id && d.type === type).sort((a, b) => b.revision - a.revision)[0]);
  const ready = drafts.every(d => d?.reviewed && !d.issues.length && d.profileVersion === data.state.profileVersion && d.snapshotId === row.snapshot.id);
  const dirty = JSON.stringify(fields) !== JSON.stringify(packet?.form?.fields ?? []);
  const update = (index: number, patch: Partial<ApplicationField>) => {
    const selected = fields.find(f => f.index === index);
    setFields(previous => previous.map(f => f.index === index ? { ...f, ...patch } : selected?.type === 'radio' && f.type === 'radio' && f.name === selected.name && patch.value === 'true' ? { ...f, value: 'false' } : f)); setApproved(false);
  };
  const run = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); } catch {} finally { setBusy(false); } };
  const prepare = () => { void run(() => mutate(`/api/applications/${row.job.id}/prepare`, {}).then(() => notify('Reading the employer’s application questions. Nothing will be submitted until you approve.'))); };
  const locked = packet && ['preparing', 'submitting', 'submitted', 'uncertain'].includes(packet.status);
  return <section className="panel application-review"><h3>Review and submit your application</h3>
    <p>Review and save both drafts below. Then prepare the employer’s questions here, check every answer and attachment, and approve this one application.</p>
    {!ready && <div className="info-box">Generate the resume and cover letter, review both tabs, and save each with “I have reviewed this draft” checked. Resolve draft warnings before preparing.</div>}
    {!locked && <button className="primary" disabled={!ready || busy} onClick={prepare}>{packet ? 'Prepare application again' : 'Prepare application'}</button>}
    {packet && <><p><Badge tone={packet.status === 'submitted' ? 'green' : 'amber'}>{({ preparing: 'Reading application questions', review: 'Awaiting your review', submitting: 'Submitting your approved application', submitted: 'Employer confirmation received', blocked: 'Needs attention', uncertain: 'Confirmation needs checking' })[packet.status]}</Badge></p>
      {packet.error && <div className="warning-box">{packet.error}</div>}{packet.receipt && <p className="small">{packet.receipt}</p>}
      {packet.status === 'uncertain' && <div><p>Check the employer’s application history or confirmation email, then record the result:</p>{(['submitted', 'not-submitted'] as const).map(outcome => <button className="secondary" key={outcome} disabled={busy} onClick={() => { void run(() => mutate(`/api/submissions/${packet.id}/resolve`, { outcome, confirmation: 'I_CHECKED_WITH_EMPLOYER' })); }}>{outcome === 'submitted' ? 'I confirmed the application was received' : 'I verified it was not submitted'}</button>)}</div>}
      {packet.status === 'review' && packet.form && <>
        <p><strong>Employer:</strong> {row.snapshot.company}<br/><strong>Role:</strong> {row.snapshot.title}<br/><strong>Send to:</strong> {new URL(packet.form.action).hostname}</p>
        {fields.some(f => f.attachment) && (['resume', 'cover-letter'] as const).filter(type => fields.some(f => f.attachment === type)).map(type => {
          const draft = data.state.drafts.find(d => d.id === (type === 'resume' ? packet.resumeId : packet.letterId));
          return <details key={type}><summary>Review attachment: {type}.pdf · revision {draft?.revision}</summary><pre className="application-preview">{draft?.text}</pre></details>;
        })}
        <p className="small muted">Answers are saved locally. Personal details and screening answers are yours to provide; the assistant does not guess them.</p>
        {fields.map(field => <Field key={field.index} label={`${field.label}${field.required || field.groupRequired ? ' *' : ' (optional)'}`}>
          {field.type === 'file' ? <select value={field.attachment} onChange={e => update(field.index, { attachment: e.target.value as ApplicationField['attachment'] })}><option value="">No attachment</option><option value="resume">Reviewed resume (PDF)</option><option value="cover-letter">Reviewed cover letter (PDF)</option></select>
            : ['select', 'choice'].includes(field.type) ? <select value={field.value} onChange={e => update(field.index, { value: e.target.value })}><option value="">Choose an answer</option>{field.options.filter(o => o.value).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
            : field.type === 'radio' ? <label className="check-label"><input type="radio" name={field.name} checked={field.value === 'true'} onChange={() => update(field.index, { value: 'true' })}/>Select this answer</label>
            : field.type === 'checkbox' ? <label className="check-label"><input type="checkbox" checked={field.value === 'true'} onChange={e => update(field.index, { value: String(e.target.checked) })}/>Agree to this statement</label>
            : field.type === 'textarea' ? <textarea rows={5} value={field.value} onChange={e => update(field.index, { value: e.target.value })}/>
            : <input type={['email', 'tel', 'url', 'number', 'date'].includes(field.type) ? field.type : 'text'} placeholder={field.type === 'combobox' ? 'Enter the exact name of the employer’s choice' : undefined} value={field.value} onChange={e => update(field.index, { value: e.target.value })}/>}
        </Field>)}
        <button className="secondary" disabled={!dirty || busy} onClick={() => { void run(() => mutate(`/api/submissions/${packet.id}`, { fields: fields.map(({ index, value, attachment }) => ({ index, value, attachment })) }, 'PUT').then(() => notify('Answers saved. Review the saved answers before approving.'))); }}>Save answers</button>
        <label className="check-label review-check"><input type="checkbox" checked={approved} disabled={dirty} onChange={e => setApproved(e.target.checked)}/>I reviewed these answers and the selected draft attachments. I approve sending this application to {row.snapshot.company}.</label>
        <button className="primary" disabled={dirty || !approved || !ready || busy} onClick={() => { void run(() => mutate(`/api/submissions/${packet.id}/approve`, { reviewToken: packet.reviewToken, approval: 'APPROVE_AND_SUBMIT' }).then(() => notify('Your approved application is being submitted.'))); }}>Approve and submit application</button>
      </>}
    </>}
  </section>;
}
