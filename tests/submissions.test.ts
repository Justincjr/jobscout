import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationService, formSignature, interruptSubmissions } from '../src/modules/applications/service.js';
import { ApplicationForm } from '../src/shared/schema.js';
import { Repository } from '../src/storage/repository.js';
import { createDrafts } from '../src/modules/drafts/index.js';
import { addJob, confirmedState, removeTestDirectory, testDirectory } from './helpers.js';
import { AppError } from '../src/shared/errors.js';
import supertest from 'supertest';
import { createApp } from '../src/server/app.js';
import { TaskEngine } from '../src/tasks/engine.js';

const form: ApplicationForm = { url: 'https://careers.example.com/apply', frameUrl: 'https://careers.example.com/apply', formIndex: 0, action: 'https://careers.example.com/send', method: 'post', button: 'Submit application', fields: [
  { index: 0, label: 'Email', name: 'email', type: 'email', required: true, options: [], value: '', attachment: '' },
  { index: 1, label: 'Resume', name: 'resume', type: 'file', required: true, options: [], value: '', attachment: '' },
] };
let repo: Repository, service: ApplicationService, jobId: string;
const inspect = vi.fn(), submit = vi.fn();
beforeEach(async () => {
  inspect.mockReset().mockResolvedValue(structuredClone(form)); submit.mockReset().mockResolvedValue({ confirmed: true, receipt: 'Thank you for applying' });
  repo = new Repository(await testDirectory()); await repo.open();
  await repo.update(state => {
    Object.assign(state, confirmedState()); jobId = addJob(state, { applyUrl: form.url });
    const snapshot = state.snapshots[0], facts = state.profileVersions.at(-1)!.facts;
    state.drafts.push(...createDrafts(state, jobId, snapshot, state.profileVersion, facts, { resumeFactIds: facts.map(f => f.id), letterFactIds: [facts[0].id] }, null).map(d => ({ ...d, reviewed: true })));
  });
  service = new ApplicationService(repo, { inspect, submit });
});
afterEach(async () => { await service.drain(); await repo.close(); await removeTestDirectory(repo.directory); });
async function prepare() { const packet = await service.prepare(jobId, repo.revision); await service.drain(); return repo.read().submissions.find(p => p.id === packet.id)!; }
async function answered() {
  const packet = await prepare();
  await service.save(packet.id, [{ index: 0, value: 'candidate@example.com', attachment: '' }, { index: 1, value: '', attachment: 'resume' }], repo.revision);
  return repo.read().submissions.find(p => p.id === packet.id)!;
}

describe('approved application submission', () => {
  it('only inspects before approval and saves answers without transmitting them', async () => {
    const packet = await answered(); expect(packet.status).toBe('review'); expect(inspect).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
  });
  it('submits exactly the reviewed answers and reviewed PDF revisions once after approval', async () => {
    const packet = await answered(); await service.approve(packet.id, packet.reviewToken, repo.revision); await service.drain();
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0][0].fields[0].value).toBe('candidate@example.com');
    expect(submit.mock.calls[0][1].resume.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(repo.read().submissions[0].status).toBe('submitted'); expect(repo.read().applications[0].status).toBe('applied');
    await expect(service.approve(packet.id, packet.reviewToken, repo.revision)).rejects.toThrow('no longer current');
  });
  it('rejects missing required answers and attachments before sending', async () => {
    const packet = await prepare(); await expect(service.approve(packet.id, packet.reviewToken, repo.revision)).rejects.toThrow('required question'); expect(submit).not.toHaveBeenCalled();
  });
  it('invalidates an approval token when answers are saved', async () => {
    const packet = await prepare(); await service.save(packet.id, packet.form!.fields.map(f => ({ index: f.index, value: 'changed', attachment: '' })), repo.revision);
    await expect(service.approve(packet.id, packet.reviewToken, repo.revision)).rejects.toThrow('no longer current'); expect(submit).not.toHaveBeenCalled();
  });
  it.each(['draft', 'profile', 'posting'])('requires a new review after the %s changes', async change => {
    const packet = await answered();
    await repo.update(state => {
      if (change === 'draft') state.drafts.push({ ...state.drafts[0], id: crypto.randomUUID(), revision: 2 });
      if (change === 'profile') { state.profileVersion++; state.profileVersions.push({ ...state.profileVersions[0], version: state.profileVersion }); }
      if (change === 'posting') state.jobs[0].active = false;
    });
    await expect(service.approve(packet.id, packet.reviewToken, repo.revision)).rejects.toThrow(); expect(submit).not.toHaveBeenCalled();
  });
  it('does not mark applied or retry when confirmation is ambiguous', async () => {
    submit.mockResolvedValue({ confirmed: false, receipt: 'No confirmation' });
    const packet = await answered(); await service.approve(packet.id, packet.reviewToken, repo.revision); await service.drain();
    expect(repo.read().submissions[0].status).toBe('uncertain'); expect(repo.read().applications[0].status).toBe('drafting');
    await expect(service.prepare(jobId, repo.revision)).rejects.toThrow('outcome needs checking'); expect(submit).toHaveBeenCalledOnce();
  });
  it('preserves uncertainty after a connection failure during submission', async () => {
    submit.mockRejectedValue(new Error('connection lost'));
    const packet = await answered(); await service.approve(packet.id, packet.reviewToken, repo.revision); await service.drain();
    expect(repo.read().submissions[0].status).toBe('uncertain'); expect(submit).toHaveBeenCalledOnce();
  });
  it('reports a known pre-send blocker without marking applied', async () => {
    submit.mockRejectedValue(new AppError(409, 'Form changed. Review again.', 'BEFORE_SUBMIT'));
    const packet = await answered(); await service.approve(packet.id, packet.reviewToken, repo.revision); await service.drain();
    expect(repo.read().submissions[0].status).toBe('blocked'); expect(repo.read().applications[0].status).toBe('drafting');
  });
  it('marks an interrupted submission uncertain on restart and preserves completed outcomes', async () => {
    const packet = await answered();
    await repo.update(state => { state.submissions[0].status = 'submitting'; interruptSubmissions(state); });
    expect(repo.read().submissions[0].status).toBe('uncertain'); expect(submit).not.toHaveBeenCalled();
    await expect(service.approve(packet.id, packet.reviewToken, repo.revision)).rejects.toThrow();
  });
  it('detects changed questions, choices, or destination while allowing reviewed answers', () => {
    const answeredForm = structuredClone(form); answeredForm.fields[0].value = 'candidate@example.com';
    expect(formSignature(answeredForm)).toBe(formSignature(form));
    answeredForm.fields[0].label = 'New question'; expect(formSignature(answeredForm)).not.toBe(formSignature(form));
    answeredForm.fields[0].label = form.fields[0].label; answeredForm.action += '/other'; expect(formSignature(answeredForm)).not.toBe(formSignature(form));
  });
  it('requires explicit HTTP approval and a current review token after saving answers', async () => {
    const engine = new TaskEngine(repo), agent = supertest(createApp(repo, engine, 4310, service));
    const send = async (url: string, body: object, method: 'post' | 'put' = 'post') => {
      const bootstrap = await agent.get('/api/state').set('Host', '127.0.0.1:4310');
      return agent[method](url).set('Host', '127.0.0.1:4310').set('X-Scout-Token', bootstrap.body.token).set('X-Revision', String(bootstrap.body.state.revision)).send(body);
    };
    try {
      const prepared = await send(`/api/applications/${jobId}/prepare`, {}); expect(prepared.status).toBe(202); await service.drain();
      const packet = repo.read().submissions[0];
      expect((await send(`/api/submissions/${packet.id}/approve`, { reviewToken: packet.reviewToken })).status).toBe(400); expect(submit).not.toHaveBeenCalled();
      expect((await send(`/api/submissions/${packet.id}`, { fields: [{ index: 0, value: 'candidate@example.com', attachment: '' }, { index: 1, value: '', attachment: 'resume' }] }, 'put')).status).toBe(200);
      expect((await send(`/api/submissions/${packet.id}/approve`, { reviewToken: packet.reviewToken, approval: 'APPROVE_AND_SUBMIT' })).status).toBe(409);
      const current = repo.read().submissions[0];
      expect((await send(`/api/submissions/${packet.id}/approve`, { reviewToken: current.reviewToken, approval: 'APPROVE_AND_SUBMIT' })).status).toBe(202);
      await service.drain(); expect(submit).toHaveBeenCalledOnce();
    } finally { await engine.pause(); }
  });
  it('allows an explicit reconciliation of uncertain outcomes before retrying', async () => {
    submit.mockResolvedValue({ confirmed: false, receipt: 'No confirmation' });
    const packet = await answered(); await service.approve(packet.id, packet.reviewToken, repo.revision); await service.drain();
    await service.resolve(packet.id, 'not-submitted', repo.revision);
    expect(repo.read().submissions[0].status).toBe('blocked'); await prepare(); expect(submit).toHaveBeenCalledOnce();
  });
});
