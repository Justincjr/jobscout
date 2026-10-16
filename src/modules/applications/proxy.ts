import http from 'node:http';
import net, { Socket } from 'node:net';
import { lookup } from 'node:dns/promises';
import { privateAddress, publicUrl } from '../sources/network.js';

// CONNECT pins the validated public address to the actual browser socket, preventing DNS rebinding.
export async function publicBrowserProxy(): Promise<{ server: string; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const proxy = http.createServer((_req, res) => { res.writeHead(403); res.end(); });
  proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  proxy.on('connect', async (req, client, head) => {
    try {
      if (!/^[a-zA-Z0-9.-]+:443$/.test(req.url ?? '')) throw new Error('Unsupported destination');
      const url = publicUrl(`https://${req.url!.slice(0, -4)}`);
      const addresses = await lookup(url.hostname, { all: true });
      if (!addresses.length || addresses.some(a => privateAddress(a.address))) throw new Error('Private destination');
      const upstream = net.connect({ host: addresses[0].address, family: addresses[0].family, port: 443 });
      sockets.add(upstream); upstream.on('close', () => sockets.delete(upstream));
      upstream.setTimeout(60000, () => upstream.destroy());
      upstream.once('connect', () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) upstream.write(head); client.pipe(upstream); upstream.pipe(client); });
      upstream.on('error', () => client.destroy()); client.on('error', () => upstream.destroy()); client.on('close', () => upstream.destroy());
    } catch { client.destroy(); }
  });
  await new Promise<void>((resolve, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', resolve); });
  const address = proxy.address() as net.AddressInfo;
  let closed = false;
  return { server: `http://127.0.0.1:${address.port}`, close: async () => {
    if (closed) return; closed = true;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => proxy.close(() => resolve()));
  } };
}
