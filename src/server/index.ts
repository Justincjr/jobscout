import 'dotenv/config';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Repository } from '../storage/repository.js';
import { TaskEngine } from '../tasks/engine.js';
import { createApp } from './app.js';

config({ path: '.env.local', quiet: true });
const port = Number(process.env.PORT ?? 4310);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer from 1024 through 65535.');
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const projectRoot = root;
const repo = new Repository(path.join(projectRoot, process.env.SCOUT_DATA_DIR ?? 'data'));
try { await repo.open(); }
catch (error) { console.error((error as Error).message); process.exit(1); }
const engine = new TaskEngine(repo);
const app = createApp(repo, engine, port);
if (import.meta.url.endsWith('.ts')) {
  const { createServer } = await import('vite');
  const vite = await createServer({ configFile: path.join(projectRoot, 'vite.config.ts'), server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use((_req, res, next) => { res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"); next(); });
  app.use(express.static(path.join(projectRoot, 'dist/client'), { index: false }));
  app.get('/{*path}', (_req, res) => { res.sendFile(path.join(projectRoot, 'dist/client/index.html')); });
}
const server = app.listen(port, '127.0.0.1', () => { console.log(`Job Scout is ready at http://127.0.0.1:${port}`); void engine.start().catch(() => console.error('Startup refresh could not be scheduled. Try a manual refresh.')); });
server.on('error', async () => { console.error('Could not open the local port. Stop the existing app or choose another PORT.'); await engine.pause(); await repo.close(); process.exit(1); });
let closing = false;
const shutdown = async () => { if (closing) return; closing = true; server.close(); await engine.pause(); await repo.close(); process.exit(0); };
process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
