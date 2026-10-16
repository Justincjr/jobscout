import { randomUUID } from 'node:crypto';
import { Fact, State } from '../../shared/schema.js';

export function bumpProfile(state: State): void {
  state.profileVersion += 1;
  state.profileVersions.push({ version: state.profileVersion, facts: structuredClone(state.facts.filter(f => f.verified)), createdAt: new Date().toISOString() });
}
export function newFact(kind: Fact['kind'], value: string, source = 'Manual entry', excerpt = value, documentId: string | null = null): Fact {
  return { id: randomUUID(), kind, value, source, excerpt, documentId, verified: false, confirmedAt: null };
}

export function redactContacts(text: string): string {
  const ranges: string[] = [];
  const protectedDates = text.replace(/\b(?:19|20)\d{2}\s*[-–]\s*(?:(?:19|20)\d{2}|present)\b/gi, match => {
    ranges.push(match); return `DATE_RANGE_${String.fromCharCode(65 + ranges.length - 1)}_END`;
  });
  return protectedDates.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email omitted]')
    .replace(/(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|github\.com)\/\S+/gi, '[profile link omitted]')
    .replace(/\+?\d[\d ()-]{7,}\d/g, '[phone omitted]')
    .replace(/DATE_RANGE_(.)_END/g, (_match, letter: string) => ranges[letter.charCodeAt(0) - 65]);
}
