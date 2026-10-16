import { performance } from 'node:perf_hooks';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { Repository } from '../src/storage/repository.js';
import { TaskEngine } from '../src/tasks/engine.js';
import { createApp } from '../src/server/app.js';
import { addJob, confirmedState, removeTestDirectory, testDirectory } from '../tests/helpers.js';
import { recompute } from '../src/modules/matching/index.js';

const directory = await testDirectory(), repo = new Repository(directory);
await repo.open();
const engine = new TaskEngine(repo), port = 4318;
const server = http.createServer(createApp(repo, engine, port));
try {
  const start = performance.now();
  await repo.update(state => {
    Object.assign(state, confirmedState());
    for (let i = 0; i < 10000; i++) addJob(state, { title: `Software Engineer ${i}`, externalId: String(i), description: 'Requirements\nExperience with React\nTypeScript\nResponsibilities\nBuild modern accessible dashboards.\nPreferred\nPython\n' + 'Detailed posting information. '.repeat(100) });
    recompute(state);
  });
  const saveMs = performance.now() - start;
  await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve));
  const times: number[] = [];
  for (let i = 0; i < 25; i++) {
    const begin = performance.now();
    const response = await fetch(`http://127.0.0.1:${port}/api/jobs?search=Engineer&page=${i % 5 + 1}`);
    if (!response.ok) throw new Error('Feed benchmark request failed.');
    await response.json(); times.push(performance.now() - begin);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * .95) - 1];
  const size = (await fs.stat(repo.file)).size;
  const beginLoad = performance.now(); await repo.close(); await repo.open();
  console.log(JSON.stringify({ jobs: 10000, stateMB: +(size / 1e6).toFixed(2), initialMatchAndSaveMs: Math.round(saveMs), reloadMs: Math.round(performance.now() - beginLoad), cachedFeedP95Ms: Math.round(p95), passesTwoSecondFeedTarget: p95 < 2000 }, null, 2));
  if (p95 >= 2000) process.exitCode = 1;
} finally { await engine.pause(); await new Promise<void>(resolve => server.close(() => resolve())); await repo.close(); await removeTestDirectory(directory); }
