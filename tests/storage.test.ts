import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Repository, parseState } from '../src/storage/repository.js';
import { createBackup, readBackup, restoreBackup } from '../src/storage/backup.js';
import { testDirectory, removeTestDirectory } from './helpers.js';
import { saveDocument } from '../src/modules/profile/documents.js';
import { zipSync } from 'fflate';

const opened: Repository[] = [], directories: string[] = [];
async function setup(hooks = {}) {
  const dir = await testDirectory(); directories.push(dir);
  const repo = new Repository(dir, hooks); opened.push(repo); await repo.open(); return repo;
}
afterEach(async () => { for (const repo of opened.splice(0)) await repo.close(); for (const dir of directories.splice(0)) await removeTestDirectory(dir); });

describe('durable local repository', () => {
  it('survives restart and serializes concurrent writes', async () => {
    const repo = await setup();
    await Promise.all(Array.from({ length: 12 }, () => repo.update(s => { s.settings.dailyRequestLimit++; })));
    expect(repo.read().settings.dailyRequestLimit).toBe(42);
    expect(repo.read().revision).toBe(12);
    await repo.close();
    const second = new Repository(repo.directory); opened.push(second); await second.open();
    expect(second.read().settings.dailyRequestLimit).toBe(42);
  });
  it('rejects stale browser edits without changing data', async () => {
    const repo = await setup(); await repo.update(s => { s.settings.dailyRefresh = true; }, 0);
    await expect(repo.update(s => { s.settings.dailyRefresh = false; }, 0)).rejects.toMatchObject({ status: 409 });
    expect(repo.read().settings.dailyRefresh).toBe(true);
  });
  it.each(['ENOSPC', 'EPERM', 'EACCES'])('preserves live and previous data when atomic replacement fails with %s', async code => {
    let fail = false;
    const repo = await setup({ beforeRename: async () => { if (fail) throw Object.assign(new Error('injected filesystem failure'), { code }); } });
    await repo.update(s => { s.settings.dailyRequestLimit = 9; });
    const previous = await fs.readFile(repo.file, 'utf8'); fail = true;
    await expect(repo.update(s => { s.settings.dailyRequestLimit = 1; })).rejects.toThrow('injected');
    expect(await fs.readFile(repo.file, 'utf8')).toBe(previous);
    expect(repo.read().settings.dailyRequestLimit).toBe(9);
    expect((await fs.readdir(repo.directory)).some(p => p.endsWith('.tmp'))).toBe(false);
    fail = false; await repo.update(s => { s.settings.dailyRequestLimit = 8; });
    expect(repo.read().settings.dailyRequestLimit).toBe(8);
  });
  it('rejects a second instance', async () => {
    const repo = await setup(), second = new Repository(repo.directory);
    await expect(second.open()).rejects.toThrow('already running');
  });
  it('recovers a stale process lock and removes interrupted temporary saves', async () => {
    const dir = await testDirectory(); directories.push(dir);
    await fs.writeFile(path.join(dir, '.lock'), JSON.stringify({ pid: 2147483647, token: 'stale' }));
    await fs.writeFile(path.join(dir, '11111111-1111-1111-1111-111111111111.tmp'), 'interrupted');
    const repo = new Repository(dir); opened.push(repo); await repo.open();
    expect((await fs.readdir(dir)).some(f => f.endsWith('.tmp'))).toBe(false);
  });
  it('preserves damaged JSON and offers explicit recovery instead of resetting', async () => {
    const repo = await setup(); await repo.close(); await fs.writeFile(repo.file, '{ damaged');
    const second = new Repository(repo.directory);
    await expect(second.open()).rejects.toThrow('Original file preserved');
    expect(await fs.readFile(repo.file, 'utf8')).toBe('{ damaged');
  });
  it('rejects unsupported schema versions and secret fields', async () => {
    const repo = await setup();
    expect(() => parseState(JSON.stringify({ ...repo.read(), schemaVersion: 99 }))).toThrow();
    expect(() => parseState(JSON.stringify({ ...repo.read(), secret: 'never stored' }))).toThrow();
  });
  it('keeps backups bounded and valid', async () => {
    const repo = await setup();
    for (let i = 0; i < 12; i++) await repo.update(s => { s.settings.dailyRequestLimit = i; });
    const names = await fs.readdir(path.join(repo.directory, 'backups'));
    expect(names.length).toBe(8);
    for (const name of names) expect(parseState(await fs.readFile(path.join(repo.directory, 'backups', name), 'utf8')).schemaVersion).toBe(1);
  });
  it('backs up and restores JSON with its documents', async () => {
    const repo = await setup();
    await saveDocument(repo, { text: 'Engineer at Acme. Built React applications from 2020 to 2024.' }, repo.read().revision);
    const bytes = await createBackup(repo), backup = readBackup(bytes);
    expect(backup.state.documents).toHaveLength(1);
    await repo.update(s => { s.settings.dailyRequestLimit = 2; });
    await restoreBackup(repo, backup, repo.read().revision);
    expect(repo.read().settings.dailyRequestLimit).toBe(30);
    expect((await fs.readdir(path.join(repo.directory, 'backups'))).some(f => f.startsWith('before-restore-'))).toBe(true);
  });
  it('rejects archive traversal and missing referenced documents', async () => {
    const repo = await setup();
    expect(() => readBackup(zipSync({ '../escape.txt': Buffer.from('no') }))).toThrow('unsafe');
    await saveDocument(repo, { text: 'Engineer at Acme. Built React applications from 2020 to 2024.' }, 0);
    expect(() => readBackup(zipSync({ 'job-scout.json': Buffer.from(JSON.stringify(repo.read())) }))).toThrow('missing');
  });
});
