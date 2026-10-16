import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { readPublic } from '../src/modules/sources/network.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe('safe public-site requests', () => {
  it('allows a larger bounded response only when requested and still stops oversized streams', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    vi.spyOn(https, 'request').mockImplementation(((_url: URL, _options: unknown, callback: (response: unknown) => void) => {
      const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
      request.destroy = error => { request.emit('error', error); request.emit('close'); };
      request.end = () => {
        const response = Object.assign(new EventEmitter(), { statusCode: 200 }); callback(response);
        response.emit('data', Buffer.alloc(5_000_001, 'a')); response.emit('end'); request.emit('close');
      };
      return request;
    }) as never);
    await expect(readPublic('https://careers.example.com/jobs')).rejects.toThrow('size limit');
    expect((await readPublic('https://careers.example.com/jobs', { maxBytes: 20_000_000 })).length).toBe(5_000_001);
    await expect(readPublic('https://careers.example.com/jobs', { maxBytes: 100 })).rejects.toThrow('size limit');
  });
  it('explains blocked outbound access without exposing socket details', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    vi.spyOn(https, 'request').mockImplementation((() => {
      throw Object.assign(new Error('connect EACCES private diagnostic'), { code: 'EACCES' });
    }) as never);
    await expect(readPublic('https://careers.example.com/jobs')).rejects.toMatchObject({ code: 'NETWORK_BLOCKED', message: expect.stringContaining('network access allowed') });
  });
  it('explains DNS failures before opening a socket', async () => {
    vi.mocked(lookup).mockRejectedValue(Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' }));
    const request = vi.spyOn(https, 'request');
    await expect(readPublic('https://careers.example.com/jobs')).rejects.toMatchObject({ code: 'SOURCE_DNS_FAILED' });
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects a hostname resolving to any private address before opening a socket', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }] as never);
    const request = vi.spyOn(https, 'request');
    await expect(readPublic('https://careers.example.com/jobs')).rejects.toThrow('non-public');
    expect(request).not.toHaveBeenCalled();
  });
  it('pins the validated DNS address to the socket and refuses redirects', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    vi.spyOn(https, 'request').mockImplementation(((_url: URL, options: { lookup: (...args: unknown[]) => void; servername: string }, callback: (response: unknown) => void) => {
      expect(options.servername).toBe('careers.example.com');
      const pinned = vi.fn(); options.lookup('careers.example.com', { all: true }, pinned);
      expect(pinned).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
      const request = new EventEmitter() as EventEmitter & { end: () => void };
      request.end = () => {
        const response = Object.assign(new EventEmitter(), { statusCode: 302, resume: () => undefined });
        callback(response); request.emit('close');
      };
      return request;
    }) as never);
    await expect(readPublic('https://careers.example.com/jobs')).rejects.toThrow('302');
  });
});
