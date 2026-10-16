import { createHash, randomUUID } from 'node:crypto';
import { ApplicationField, ApplicationForm, State, Submission } from '../../shared/schema.js';
import { AppError, assert } from '../../shared/errors.js';
import { Repository } from '../../storage/repository.js';
import { exportPdf } from '../drafts/index.js';
import { publicUrl } from '../sources/network.js';

export type Attachment = { name: string; mimeType: string; buffer: Buffer };
export interface ApplicationDriver {
  inspect(url: string): Promise<ApplicationForm>;
  submit(form: ApplicationForm, files: Record<'resume' | 'cover-letter', Attachment>): Promise<{ confirmed: boolean; receipt: string }>;
}
export function formSignature(form: ApplicationForm): string {
  return createHash('sha256').update(JSON.stringify({ ...form, fields: form.fields.map(({ value: _value, attachment: _attachment, ...field }) => ({ ...field, options: field.type === 'combobox' ? [] : field.options })) })).digest('hex');
}
function latestDraft(state: State, jobId: string, type: 'resume' | 'cover-letter') {
  return state.drafts.filter(d => d.jobId === jobId && d.type === type).sort((a, b) => b.revision - a.revision)[0];
}
export function validatePacket(state: State, packet: Submission): void {
  const job = state.jobs.find(j => j.id === packet.jobId);
  assert(job?.active && job.snapshotId === packet.snapshotId, 'The posting changed or closed. Prepare this application again.', 409);
  assert(!state.submissions.some(s => s.id !== packet.id && s.jobId === packet.jobId && ['submitting', 'submitted', 'uncertain'].includes(s.status)), 'This job was already submitted or its previous outcome needs checking.', 409);
  assert(state.applications.find(a => a.jobId === packet.jobId)?.status !== 'applied', 'This job is already marked applied.', 409);
  for (const [type, id] of [['resume', packet.resumeId], ['cover-letter', packet.letterId]] as const) {
    const draft = latestDraft(state, packet.jobId, type);
    assert(draft?.id === id && draft.reviewed && draft.snapshotId === packet.snapshotId && draft.profileVersion === state.profileVersion, 'Review and save the latest resume and cover letter for the current profile and job before preparing an application.', 409);
    assert(!draft.issues.length, 'Resolve unsupported draft text before submitting an application.', 409);
  }
}
export function validateAnswers(fields: ApplicationField[]): void {
  for (const group of new Set(fields.filter(f => f.groupRequired).map(f => f.group))) {
    assert(fields.some(f => f.group === group && f.value === 'true'), `Choose at least one answer for ${group}.`);
  }
  for (const field of fields) {
    assert(!field.required || (field.type === 'file' ? field.attachment : field.type === 'radio' ? fields.some(f => f.type === 'radio' && f.name === field.name && f.value === 'true') : field.type === 'checkbox' ? field.value === 'true' : field.value.trim()), `Answer the required question: ${field.label}`);
    if (['select', 'choice'].includes(field.type) && field.value) assert(field.options.some(o => o.value === field.value), `Choose a listed answer for ${field.label}.`);
    if (['checkbox', 'radio'].includes(field.type)) assert(['true', 'false', ''].includes(field.value), 'Check the application checkbox answers.');
    if (field.type === 'email' && field.value) assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value), 'Enter a valid email address.');
  }
}
export function interruptSubmissions(state: State): void {
  for (const packet of state.submissions) {
    if (packet.status === 'preparing') { packet.status = 'blocked'; packet.error = 'Preparation was interrupted. Prepare again.'; }
    if (packet.status === 'submitting') { packet.status = 'uncertain'; packet.error = 'Submission was interrupted. Check the employer confirmation before taking further action. It will not be retried automatically.'; }
  }
}

export class ApplicationService {
  private active = new Set<Promise<void>>();
  constructor(private repo: Repository, private driver: ApplicationDriver) {}
  get busy(): boolean { return this.active.size > 0; }
  async drain(): Promise<void> { await Promise.allSettled([...this.active]); }
  private launch(action: () => Promise<void>): void {
    const work = action(); this.active.add(work);
    void work.finally(() => this.active.delete(work)).catch(() => undefined);
  }
  async prepare(jobId: string, revision: number): Promise<Submission> {
    assert(this.active.size < 2, 'Wait for the current application browser tasks to finish.', 409);
    let packet!: Submission;
    await this.repo.update(state => {
      const job = state.jobs.find(j => j.id === jobId); assert(job, 'Job not found.', 404);
      assert(!state.submissions.some(p => p.jobId === jobId && p.status === 'preparing'), 'This application is already being prepared.', 409);
      const resume = latestDraft(state, jobId, 'resume'), letter = latestDraft(state, jobId, 'cover-letter');
      assert(resume && letter, 'Generate and review a resume and cover letter first.', 409);
      packet = { id: randomUUID(), jobId, snapshotId: job.snapshotId, resumeId: resume.id, letterId: letter.id, status: 'preparing', form: null, reviewToken: randomUUID(), error: null, receipt: null, createdAt: new Date().toISOString(), approvedAt: null, finishedAt: null };
      validatePacket(state, packet);
      publicUrl(state.snapshots.find(s => s.id === job.snapshotId)!.applyUrl ?? '');
      state.submissions.push(packet);
    }, revision);
    this.launch(() => this.inspect(packet));
    return packet;
  }
  private async inspect(packet: Submission): Promise<void> {
    try {
      const snapshot = this.repo.read().snapshots.find(s => s.id === packet.snapshotId)!;
      const form = await this.driver.inspect(snapshot.applyUrl!);
      for (const field of form.fields) {
        if (field.type === 'file' && /resume|\bcv\b/i.test(field.label)) field.attachment = 'resume';
        if (field.type === 'file' && /cover letter/i.test(field.label)) field.attachment = 'cover-letter';
        if (field.type === 'textarea' && /cover letter/i.test(field.label)) field.value = this.repo.read().drafts.find(d => d.id === packet.letterId)!.text;
      }
      await this.repo.update(state => {
        const target = state.submissions.find(p => p.id === packet.id)!;
        validatePacket(state, target); target.form = form; target.status = 'review';
      });
    } catch (error) { await this.fail(packet.id, error, false); }
  }
  async save(id: string, fields: { index: number; value: string; attachment: ApplicationField['attachment'] }[], revision: number): Promise<void> {
    await this.repo.update(state => {
      const packet = state.submissions.find(p => p.id === id); assert(packet?.status === 'review' && packet.form, 'Prepare this application before editing answers.', 409);
      validatePacket(state, packet);
      assert(fields.length === packet.form.fields.length && new Set(fields.map(f => f.index)).size === fields.length && fields.every(f => packet.form!.fields.some(p => p.index === f.index)), 'Application questions changed. Reload and review again.', 409);
      for (const answer of fields) Object.assign(packet.form.fields.find(f => f.index === answer.index)!, { value: answer.value, attachment: answer.attachment });
      packet.reviewToken = randomUUID();
    }, revision);
  }
  async approve(id: string, token: string, revision: number): Promise<void> {
    let approved!: Submission;
    await this.repo.update(state => {
      const packet = state.submissions.find(p => p.id === id);
      assert(packet?.status === 'review' && packet.form && packet.reviewToken === token, 'This review is no longer current. Reload and review again.', 409);
      validatePacket(state, packet); validateAnswers(packet.form.fields);
      packet.status = 'submitting'; packet.approvedAt = new Date().toISOString(); approved = structuredClone(packet);
    }, revision);
    this.launch(() => this.submit(approved));
  }
  async resolve(id: string, outcome: 'submitted' | 'not-submitted', revision: number): Promise<void> {
    await this.repo.update(state => {
      const packet = state.submissions.find(p => p.id === id); assert(packet?.status === 'uncertain', 'Only an uncertain submission needs reconciliation.', 409);
      packet.status = outcome === 'submitted' ? 'submitted' : 'blocked'; packet.error = outcome === 'submitted' ? null : 'You confirmed the employer did not receive this application. Prepare again to retry.';
      packet.receipt = outcome === 'submitted' ? 'Employer receipt manually confirmed by you.' : 'You checked the employer and confirmed no submission.';
      packet.finishedAt = new Date().toISOString();
      if (outcome === 'submitted') {
        const app = state.applications.find(a => a.jobId === packet.jobId)!;
        app.status = 'applied'; app.appliedDate = packet.approvedAt!.slice(0, 10); app.updatedAt = packet.finishedAt;
      }
    }, revision);
  }
  private async submit(packet: Submission): Promise<void> {
    let attempted = false;
    try {
      const state = this.repo.read(); validatePacket(state, packet);
      const files = {} as Record<'resume' | 'cover-letter', Attachment>;
      for (const [type, id] of [['resume', packet.resumeId], ['cover-letter', packet.letterId]] as const) {
        files[type] = { name: `${type}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(await exportPdf(state.drafts.find(d => d.id === id)!)) };
      }
      attempted = true;
      const result = await this.driver.submit(packet.form!, files);
      await this.repo.update(s => {
        const target = s.submissions.find(p => p.id === packet.id)!;
        target.status = result.confirmed ? 'submitted' : 'uncertain'; target.receipt = result.receipt; target.finishedAt = new Date().toISOString();
        if (result.confirmed) {
          const app = s.applications.find(a => a.jobId === packet.jobId)!;
          app.status = 'applied'; app.appliedDate = target.finishedAt.slice(0, 10); app.updatedAt = target.finishedAt;
        } else target.error = 'The employer did not show a clear confirmation. Check before applying again; no automatic retry will occur.';
      });
    } catch (error) { await this.fail(packet.id, error, attempted); }
  }
  private async fail(id: string, error: unknown, attempted: boolean): Promise<void> {
    await this.repo.update(state => {
      const target = state.submissions.find(p => p.id === id); if (!target) return;
      // Only failures explicitly known to occur before transmitting answers are safe to retry.
      target.status = attempted && !(error instanceof AppError && error.code === 'BEFORE_SUBMIT') ? 'uncertain' : 'blocked';
      target.error = error instanceof AppError ? error.message : 'The application browser could not complete this step. Check browser availability and connection. No automatic submission retry will occur.';
      target.finishedAt = new Date().toISOString();
    });
  }
}
