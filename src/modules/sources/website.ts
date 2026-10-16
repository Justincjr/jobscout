import { createHash } from 'node:crypto';
import { decode } from 'he';
import { Source, State } from '../../shared/schema.js';
import { AppError, assert } from '../../shared/errors.js';
import { BoardJobs, common, IncomingJob, plainText } from './index.js';
import { PublicRead, publicUrl, readPublic } from './network.js';

export function robotsPolicy(text: string, pathname: string): { allowed: boolean; delay: number } {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[]; delay: number }[] = [];
  let group = { agents: [] as string[], rules: [] as { allow: boolean; path: string }[], delay: 250 }, directives = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim(), colon = line.indexOf(':'); if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (directives) { groups.push(group); group = { agents: [], rules: [], delay: 250 }; directives = false; }
      group.agents.push(value.toLowerCase());
    } else if (group.agents.length) {
      directives = true;
      if ((key === 'allow' || key === 'disallow') && value) group.rules.push({ allow: key === 'allow', path: value });
      if (key === 'crawl-delay' && Number.isFinite(Number(value))) group.delay = Math.max(250, Number(value) * 1000);
    }
  }
  groups.push(group);
  const specific = groups.filter(g => g.agents.some(a => a !== '*' && 'jobscoutlocal'.includes(a)));
  const relevant = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  const rules = relevant.flatMap(g => g.rules).filter(rule => {
    const pattern = rule.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + pattern).test(pathname);
  }).sort((a, b) => b.path.replace(/\*/g, '').length - a.path.replace(/\*/g, '').length || Number(b.allow) - Number(a.allow));
  return { allowed: rules[0]?.allow ?? true, delay: Math.max(250, ...relevant.map(g => g.delay)) };
}

export function structuredJobs(html: string, pageUrl: string, source: Source): IncomingJob[] {
  const objects: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 15 || objects.length >= 2000 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 1000)) visit(item, depth + 1); return; }
    const object = value as Record<string, unknown>; objects.push(object);
    for (const key of ['@graph', 'itemListElement', 'item', 'mainEntity']) visit(object[key], depth + 1);
  };
  for (const match of html.matchAll(/<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try { visit(JSON.parse(match[1])); } catch { /* A malformed script cannot create or close a job. */ }
  }
  return objects.flatMap(object => {
    if (!([object['@type']].flat().includes('JobPosting')) || typeof object.title !== 'string' || typeof object.description !== 'string') return [];
    let url: URL;
    try { url = publicUrl(new URL(typeof object.url === 'string' ? object.url : pageUrl, pageUrl).href); } catch { return []; }
    const locations = [object.jobLocation].flat().filter(Boolean) as { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } }[];
    const location = locations.map(l => [l.address?.addressLocality, l.address?.addressRegion, l.address?.addressCountry].filter(v => typeof v === 'string').join(', ')).filter(Boolean).join('; ') || null;
    const description = plainText(object.description).slice(0, 150000); if (description.length < 30) return [];
    return [{ ...common(object.title.slice(0, 500), source.name, description, location?.slice(0, 500) ?? null), externalId: createHash('sha256').update(url.href).digest('hex'), url: url.href, applyUrl: url.href,
      workMode: object.jobLocationType === 'TELECOMMUTE' ? 'remote' as const : null }];
  });
}

export function candidateLinks(html: string, pageUrl: string): string[] {
  const origin = new URL(pageUrl).origin, links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    try {
      const url = publicUrl(new URL(decode(match[1]), pageUrl).href); url.hash = '';
      if (url.origin === origin && url.href !== pageUrl && /\/(?:jobs?|careers?|positions?|openings?|vacanc(?:y|ies))\/[a-z0-9_-]/i.test(url.pathname) && !/\/(?:apply|login|sign[-_]?in)(?:\/|$)/i.test(url.pathname)) links.add(url.href);
    } catch { /* Ignore non-public and non-HTTPS links. */ }
  }
  return [...links].slice(0, 200);
}

export function htmlJob(html: string, url: string, source: Source): IncomingJob[] {
  const title = plainText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const body = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (!title || title.length > 500 || /^(?:careers?|jobs?|open positions|join us)$/i.test(title) || !body || !/responsibilit|qualification|job description|requirements/i.test(body)) return [];
  const description = plainText(body).slice(0, 150000); if (description.length < 100) return [];
  return [{ ...common(title, source.name, description, null), externalId: createHash('sha256').update(url).digest('hex'), url, applyUrl: url }];
}

export async function fetchWebsite(source: Source, read: PublicRead = readPublic, state?: State): Promise<BoardJobs> {
  const listing = publicUrl(source.url); let robots = '';
  try { robots = await read(`${listing.origin}/robots.txt`, { maxBytes: 500000 }); }
  catch (error) { if (!(error instanceof AppError && error.code === 'NOT_FOUND')) throw error; }
  const check = (url: string) => {
    const parsed = publicUrl(url), policy = robotsPolicy(robots, parsed.pathname + parsed.search);
    assert(parsed.origin === listing.origin && policy.allowed, 'This career page is disallowed by its robots policy. Paste a job description instead.', 400);
    assert(policy.delay <= 10000, 'This site requests a long crawl delay. Use a pasted description or a dedicated integration.', 400);
    return policy.delay;
  };
  check(listing.href);
  const html = await read(listing.href), result: BoardJobs = structuredJobs(html, listing.href, source);
  const snapshots = new Map(state?.snapshots.map(s => [s.id, s]));
  const known = new Map(state?.jobs.filter(j => j.sourceId === source.id).map(j => [snapshots.get(j.snapshotId)!.url, j]));
  let fetched = 0;
  for (const link of candidateLinks(html, listing.href)) {
    if (result.some(j => j.url === link)) continue;
    const delay = check(link), existing = known.get(link);
    if (existing) {
      const { id: _id, hash: _hash, requirements: _requirements, analysis: _analysis, createdAt: _created, ...cached } = snapshots.get(existing.snapshotId)!;
      result.push({ ...cached, externalId: existing.externalId }); continue;
    }
    if (fetched++ >= 25) break;
    await new Promise(resolve => setTimeout(resolve, delay));
    const detail = await read(link), structured = structuredJobs(detail, link, source);
    result.push(...(structured.length ? structured : htmlJob(detail, link, source)));
  }
  if (!result.length) result.push(...htmlJob(html, listing.href, source));
  assert(result.length, 'No readable public job postings were found. This site may need a dedicated integration or JavaScript; paste a description instead. It has not been marked connected.', 422);
  result.complete = false;
  result.warning = 'Public website import: visible structured postings and up to 25 new linked job pages per refresh. Coverage is not guaranteed, so missing jobs are never automatically closed.';
  return result;
}
