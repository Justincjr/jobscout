import { zipSync, unzipSync } from 'fflate';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Repository, parseState } from './repository.js';
import { assert } from '../shared/errors.js';
import { State } from '../shared/schema.js';

export async function createBackup(repo: Repository): Promise<Uint8Array> {
  const state = repo.read();
  const entries: Record<string, Uint8Array> = { 'job-scout.json': Buffer.from(JSON.stringify(state, null, 2)) };
  for (const doc of state.documents) entries[doc.path] = await fs.readFile(path.join(repo.directory, doc.path));
  return zipSync(entries, { level: 6 });
}

export function readBackup(bytes: Uint8Array): { state: State; documents: Record<string, Uint8Array> } {
  assert(bytes.length <= 40_000_000, 'Backup exceeds the 40 MB compressed limit.');
  let total = 0;
  const entries = unzipSync(bytes, { filter: entry => {
    assert(entry.name === 'job-scout.json' || /^uploads\/[a-f0-9-]+\.(pdf|txt)$/.test(entry.name), 'Backup contains an unsafe or unexpected path.');
    total += entry.originalSize;
    assert(entry.originalSize <= 80_000_000 && total <= 150_000_000, 'Backup exceeds the unpacked size limit.');
    return true;
  } });
  assert(entries['job-scout.json'], 'Backup is missing job-scout.json.');
  const state = parseState(Buffer.from(entries['job-scout.json']).toString('utf8'));
  assert(Object.keys(entries).length === state.documents.length + 1, 'Backup contains missing or extra documents.');
  for (const doc of state.documents) {
    const data = entries[doc.path];
    assert(data && data.length <= 5_000_000, 'A referenced document is missing or oversized.');
    if (doc.mime === 'application/pdf') assert(Buffer.from(data.subarray(0, 5)).toString() === '%PDF-', 'A referenced PDF has an invalid signature.');
  }
  return { state, documents: entries };
}

export async function restoreBackup(repo: Repository, restored: ReturnType<typeof readBackup>, revision: number): Promise<void> {
  // Keep a complete safety archive before replacing state or referenced documents.
  const safety = await createBackup(repo);
  await fs.writeFile(path.join(repo.directory, 'backups', `before-restore-${Date.now()}.zip`), safety, { mode: 0o600 });
  const oldDocs = new Map(repo.read().documents.map(d => [d.id, d.path]));
  const staged: string[] = [];
  for (const doc of restored.state.documents) {
    const existing = oldDocs.get(doc.id);
    if (existing) {
      const old = await fs.readFile(path.join(repo.directory, existing));
      assert(old.equals(Buffer.from(restored.documents[doc.path])), 'A document ID conflicts with different local contents. Restore into a new empty data folder.');
    } else {
      await fs.writeFile(path.join(repo.directory, doc.path), restored.documents[doc.path], { flag: 'wx', mode: 0o600 });
      staged.push(doc.path);
    }
  }
  try {
    await repo.update(state => {
      Object.assign(state, restored.state);
      for (const task of state.tasks) if (task.status === 'running' || task.status === 'queued') {
        task.status = 'interrupted'; task.error = 'Backup restored. Retry explicitly.'; task.finishedAt = new Date().toISOString();
      }
    }, revision);
  } catch (error) { await Promise.all(staged.map(p => fs.unlink(path.join(repo.directory, p)).catch(() => undefined))); throw error; }
  const safetyArchives = (await fs.readdir(path.join(repo.directory, 'backups'))).filter(name => /^before-restore-\d+\.zip$/.test(name)).sort().reverse();
  await Promise.all(safetyArchives.slice(3).map(name => fs.unlink(path.join(repo.directory, 'backups', name)).catch(() => undefined)));
}
