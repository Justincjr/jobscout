import { randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Claim, Draft, Fact, Selection, Snapshot, State } from '../../shared/schema.js';
import { assert } from '../../shared/errors.js';
import { PROMPT_VERSION } from '../../providers/index.js';

const headings = new Set(['EXPERIENCE', 'SKILLS', 'EDUCATION', 'ACHIEVEMENTS', 'Dear hiring team,', 'Sincerely,', 'Thank you for your consideration.']);
export function validateClaims(text: string, claims: Claim[], facts: Fact[], snapshot: Snapshot): string[] {
  const issues: string[] = [];
  const allowed = facts.filter(f => f.verified);
  const validClaims = claims.filter(claim => claim.text.trim() && claim.factIds.length && claim.factIds.every(id => allowed.some(f => f.id === id)) && claim.factIds.some(id => allowed.some(f => f.id === id && f.value === claim.text)));
  if (validClaims.length !== claims.length) issues.push('Some claims do not reproduce a confirmed fact. Review their evidence.');
  const safeLines = new Set([...headings, `Application: ${snapshot.title} — ${snapshot.company}`, `I am applying for the ${snapshot.title} position at ${snapshot.company}.`, 'My relevant experience includes:']);
  const lines = text.split('\n').map(l => l.replace(/^[-•]\s*/, '').trim());
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i] || safeLines.has(lines[i])) continue;
    const exact = validClaims.map(c => c.text.split('\n').map(l => l.trim()))
      .find(block => block.every((part, offset) => lines[i + offset] === part));
    if (exact) i += exact.length - 1;
    else issues.push(`Review unsupported text: ${lines[i].slice(0, 140)}`);
  }
  if (!text.trim()) issues.push('Draft is empty.');
  if (!validClaims.length) issues.push('Include at least one confirmed fact.');
  return [...new Set(issues)];
}

export function createDrafts(state: State, jobId: string, snapshot: Snapshot, profileVersion: number, facts: Fact[], picked: { resumeFactIds: string[]; letterFactIds: string[] }, selection: Selection | null): Draft[] {
  const select = (ids: string[]) => {
    assert(ids.length > 0 && ids.length <= facts.length, 'AI did not select usable confirmed facts. Try again or create a manual draft.', 422);
    assert(ids.every(id => facts.some(f => f.id === id && f.verified)), 'AI cited a fact outside the confirmed profile. No draft was created.', 422);
    return [...new Set(ids)].map(id => facts.find(f => f.id === id)!);
  };
  const resumeFacts = select(picked.resumeFactIds), letterFacts = select(picked.letterFactIds);
  let app = state.applications.find(a => a.jobId === jobId);
  if (!app) { app = { id: randomUUID(), jobId, status: 'drafting', appliedDate: null, updatedAt: new Date().toISOString() }; state.applications.push(app); }
  else if (app.status !== 'applied') { app.status = 'drafting'; app.updatedAt = new Date().toISOString(); }
  const resumeLines = [`Application: ${snapshot.title} — ${snapshot.company}`, ''];
  for (const [kind, title] of [['experience', 'EXPERIENCE'], ['skill', 'SKILLS'], ['education', 'EDUCATION'], ['achievement', 'ACHIEVEMENTS']] as const) {
    const rows = resumeFacts.filter(f => f.kind === kind);
    if (rows.length) resumeLines.push(title, ...rows.map(f => f.value), '');
  }
  const letter = [`Dear hiring team,`, '', `I am applying for the ${snapshot.title} position at ${snapshot.company}.`, '', 'My relevant experience includes:', ...letterFacts.map(f => f.value), '', 'Thank you for your consideration.'];
  return (['resume', 'cover-letter'] as const).map(type => {
    const selectedFacts = type === 'resume' ? resumeFacts : letterFacts;
    const text = (type === 'resume' ? resumeLines : letter).join('\n');
    const claims = selectedFacts.map(f => ({ text: f.value, factIds: [f.id] }));
    const previous = state.drafts.filter(d => d.jobId === jobId && d.type === type);
    return { id: randomUUID(), applicationId: app!.id, jobId, snapshotId: snapshot.id, profileVersion, type, text, claims,
      issues: validateClaims(text, claims, facts, snapshot), reviewed: false, revision: previous.length + 1,
      createdAt: new Date().toISOString(), selection, promptVersion: PROMPT_VERSION };
  });
}

export async function exportPdf(draft: Draft): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595.28, 841.89]), y = 784;
  // Standard fonts cannot encode all scripts: fail visibly instead of corrupting content.
  for (const paragraph of draft.text.split('\n')) {
    const isHeading = ['EXPERIENCE', 'SKILLS', 'EDUCATION', 'ACHIEVEMENTS'].includes(paragraph);
    const activeFont = isHeading ? bold : font;
    const words = paragraph.split(/\s+/);
    let line = '';
    const write = () => {
      if (y < 58) { page = doc.addPage([595.28, 841.89]); y = 784; }
      page.drawText(line, { x: 52, y, size: 10.5, font: activeFont, color: rgb(0.10, 0.15, 0.14) });
      y -= 16; line = '';
    };
    for (const word of words) {
      if (activeFont.widthOfTextAtSize(`${line} ${word}`, 10.5) > 490 && line) write();
      for (const character of word) {
        if (activeFont.widthOfTextAtSize(`${line}${character}`, 10.5) > 490) write();
        line += character;
      }
      line += ' ';
    }
    write();
  }
  return doc.save();
}
