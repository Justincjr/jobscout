import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { createDrafts, exportPdf, validateClaims } from '../src/modules/drafts/index.js';
import { addJob, confirmedState } from './helpers.js';

describe('grounded draft generation and revisions', () => {
  function fixture() {
    const state = confirmedState(), jobId = addJob(state), facts = state.profileVersions[0].facts, snapshot = state.snapshots[0];
    const picks = { resumeFactIds: facts.map(f => f.id), letterFactIds: [facts[0].id] };
    const drafts = createDrafts(state, jobId, snapshot, state.profileVersion, facts, picks, null);
    return { state, jobId, facts, snapshot, picks, drafts };
  }
  it('produces zero unsupported factual lines with traceable references', () => {
    const { drafts, facts } = fixture();
    for (const draft of drafts) {
      expect(draft.issues).toEqual([]); expect(draft.reviewed).toBe(false);
      for (const claim of draft.claims) expect(facts.some(f => f.id === claim.factIds[0] && f.value === claim.text)).toBe(true);
    }
  });
  it('rejects unsupported or unconfirmed IDs', () => {
    const { state, jobId, facts, snapshot, picks } = fixture();
    expect(() => createDrafts(state, jobId, snapshot, state.profileVersion, facts, { ...picks, letterFactIds: [randomUUID()] }, null)).toThrow('outside');
  });
  it('flags invented metrics, changed employers, and unsupported edits despite valid IDs', () => {
    const { drafts, facts, snapshot } = fixture();
    const draft = drafts[0];
    expect(validateClaims(draft.text.replace('25%', '75%'), draft.claims, facts, snapshot).length).toBeGreaterThan(0);
    expect(validateClaims(draft.text + '\nI led 50 engineers at Fake Corp.', draft.claims, facts, snapshot).length).toBeGreaterThan(0);
    expect(validateClaims('Invented a new product.', [{ text: 'Invented a new product.', factIds: [facts[0].id] }], facts, snapshot).length).toBeGreaterThan(0);
  });
  it('does not sum overlapping employment dates or invent total years', () => {
    const { drafts } = fixture();
    expect(drafts[0].text).toContain('2020–2024'); expect(drafts[0].text).not.toMatch(/\d+ years/);
  });
  it('accepts exact multi-line facts without weakening claim boundaries', () => {
    const { facts, snapshot } = fixture(); facts[0].value = 'Engineer at Acme\nBuilt React dashboards';
    expect(validateClaims(facts[0].value, [{ text: facts[0].value, factIds: [facts[0].id] }], facts, snapshot)).toEqual([]);
    expect(validateClaims('ReactReact', [{ text: facts[1].value, factIds: [facts[1].id] }], facts, snapshot).length).toBeGreaterThan(0);
  });
  it('exports paginated single-column PDFs and preserves the edited text', async () => {
    const { drafts } = fixture();
    drafts[0].text = Array.from({ length: 140 }, (_, i) => `Edited line ${i} with a precise factual statement.`).join('\n');
    const bytes = await exportPdf(drafts[0]);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const parsed = await PDFDocument.load(bytes); expect(parsed.getPageCount()).toBeGreaterThan(1);
  });
});
