import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { Duplex } from 'node:stream';
import { lookup } from 'node:dns/promises';
import { publicBrowserProxy } from '../src/modules/applications/proxy.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
function connect(proxy: string, authority: string): Promise<boolean> {
  return new Promise(resolve => {
    const url = new URL(proxy);
    const request = http.request({ host: url.hostname, port: url.port, method: 'CONNECT', path: authority });
    request.once('connect', (_res, socket) => { socket.destroy(); resolve(true); });
    request.once('error', () => resolve(false)); request.setTimeout(2000, () => { request.destroy(); resolve(false); }); request.end();
  });
}
describe('application browser network boundary', () => {
  it('rejects private and mixed DNS answers before opening an upstream socket', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }] as never);
    const upstream = vi.spyOn(net, 'connect'), proxy = await publicBrowserProxy();
    try { expect(await connect(proxy.server, 'careers.example.com:443')).toBe(false); expect(upstream).not.toHaveBeenCalled(); }
    finally { await proxy.close(); }
  });
  it('rejects literal addresses and non-HTTPS ports', async () => {
    const upstream = vi.spyOn(net, 'connect'), proxy = await publicBrowserProxy();
    try {
      expect(await connect(proxy.server, '127.0.0.1:443')).toBe(false);
      expect(await connect(proxy.server, 'careers.example.com:80')).toBe(false); expect(upstream).not.toHaveBeenCalled();
    } finally { await proxy.close(); }
  });
  it('pins a validated address to the upstream connection instead of resolving the host again', async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    const upstream = vi.spyOn(net, 'connect').mockImplementation((() => {
      const socket = Object.assign(new Duplex({ read() {}, write(_chunk, _encoding, done) { done(); } }), { setTimeout: () => undefined });
      queueMicrotask(() => socket.emit('connect')); return socket;
    }) as never);
    const proxy = await publicBrowserProxy();
    try {
      expect(await connect(proxy.server, 'careers.example.com:443')).toBe(true);
      expect(upstream).toHaveBeenCalledWith({ host: '93.184.216.34', family: 4, port: 443 });
    } finally { await proxy.close(); }
  });
});
