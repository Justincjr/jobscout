import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parseState, Repository } from '../src/storage/repository.js';

const directory = path.resolve('data');
const backupDirectory = path.join(directory, 'backups');
const files = (await fs.readdir(backupDirectory).catch(() => [] as string[])).filter(f => /^[a-zA-Z0-9-]+\.json$/.test(f)).sort().reverse();
const valid: string[] = [];
for (const name of files) {
  try { parseState(await fs.readFile(path.join(backupDirectory, name), 'utf8')); valid.push(name); } catch { /* Skip invalid backups without exposing content. */ }
}
const filename = process.argv[2];
if (!filename || filename === '--list') {
  console.log(valid.length ? `Validated backups:\n${valid.join('\n')}\nStop the app, then run npm run recover -- <filename> --confirm.` : 'No valid JSON backup was found. Preserve data/ and restore a downloaded ZIP into a fresh workspace.');
} else {
  if (!valid.includes(filename) || process.argv[3] !== '--confirm') throw new Error('Select a listed backup filename and append --confirm.');
  try { await fs.access(path.join(directory, '.lock')); throw new Error('A lock exists. Stop Job Scout before recovery. If it crashed, start it once to reclaim a stale lock, then retry.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const text = await fs.readFile(path.join(backupDirectory, filename), 'utf8');
  const state = parseState(text);
  for (const document of state.documents) await fs.access(path.join(directory, document.path));
  const original = path.join(directory, 'job-scout.json');
  const saved = path.join(directory, `damaged-${Date.now()}.json`);
  await fs.copyFile(original, saved);
  const temp = path.join(directory, 'recovery.tmp');
  const handle = await fs.open(temp, 'wx', 0o600);
  try { await handle.writeFile(text); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temp, original);
  const repo = new Repository(directory); await repo.open(); await repo.close();
  console.log(`Recovered ${filename}. Original preserved as ${path.basename(saved)}. Start Job Scout normally.`);
}
