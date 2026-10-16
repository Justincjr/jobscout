import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError, assert } from '../../shared/errors.js';

export const USER_AGENT = 'JobScoutLocal/0.2';
export function privateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip.includes(':')) return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('ff') || /^fe[89ab]/.test(ip) || ip.startsWith('::ffff:') || ip.startsWith('2001:db8:');
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b));
}
export function publicUrl(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new AppError(400, 'Enter a complete HTTPS career-page URL.'); }
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.port && !isIP(url.hostname.replace(/^\[|\]$/g, '')) && url.hostname.includes('.') && !/\.(localhost|local|internal|test|invalid)$/i.test(url.hostname), 'Use a public HTTPS career-page hostname without credentials or a custom port.');
  return url;
}

export type PublicRead = (url: string, options?: { method?: 'GET' | 'POST'; body?: unknown; maxBytes?: number }) => Promise<string>;
export const readPublic: PublicRead = async (input, options = {}) => {
  try { return await requestPublic(input, options); }
  catch (error) {
    if (error instanceof AppError) throw error;
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'EACCES' || code === 'EPERM') throw new AppError(502, 'The app is blocked from connecting to the career site. Restart it with network access allowed, then retry. Existing jobs were preserved.', 'NETWORK_BLOCKED');
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new AppError(502, 'The career-site address could not be resolved. Check your connection and retry. Existing jobs were preserved.', 'SOURCE_DNS_FAILED');
    throw new AppError(502, 'Could not connect securely to the career site. Check your connection and retry. Existing jobs were preserved.', 'SOURCE_CONNECTION_FAILED');
  }
};
const requestPublic: PublicRead = async (input, options = {}) => {
  const url = publicUrl(input);
  const addresses = await lookup(url.hostname, { all: true });
  assert(addresses.length && addresses.every(a => !privateAddress(a.address)), 'The career site resolved to a non-public address.', 502);
  const address = addresses[0];
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  // Pin the validated address to the actual socket; redirects are never followed.
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: options.method ?? 'GET', servername: url.hostname,
      lookup: ((_host: string, opts: { all?: boolean }, callback: (...args: unknown[]) => void) => opts.all ? callback(null, [address]) : callback(null, address.address, address.family)) as never,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json,text/html,text/plain', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, response => {
      const status = response.statusCode ?? 500;
      if (status < 200 || status >= 300) {
        response.resume(); reject(new AppError(502, `Career-site request failed (${status}). No redirects or login pages are followed. Existing jobs were preserved.`, status === 429 ? 'RATE_LIMIT' : status === 404 ? 'NOT_FOUND' : 'SOURCE_FAILED')); return;
      }
      let size = 0; const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (options.maxBytes ?? 5_000_000)) { request.destroy(new AppError(502, 'Career-site response exceeded the size limit.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    const timer = setTimeout(() => request.destroy(new AppError(504, 'Career-site request timed out. Existing jobs were preserved.')), 30000);
    request.on('close', () => clearTimeout(timer)); request.on('error', reject);
    request.end(body);
  });
};

export type JsonRead = (url: string, options?: { method?: 'GET' | 'POST'; body?: unknown; maxBytes?: number }) => Promise<unknown>;
export const readJson: JsonRead = async (url, options) => {
  try { return JSON.parse(await readPublic(url, options)); }
  catch (error) { if (error instanceof SyntaxError) throw new AppError(502, 'The career site returned an unexpected response. Existing jobs were preserved.'); throw error; }
};
