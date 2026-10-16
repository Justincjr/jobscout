import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { State, initialState, validateReferences } from '../shared/schema.js';
import { AppError } from '../shared/errors.js';

export type WriteHooks = { beforeRename?: () => Promise<void> };
export class Repository {
  private state!: State;
  private queue: Promise<unknown> = Promise.resolve();
  private lockToken = randomUUID();
  private locked = false;
  readonly file: string;
  constructor(readonly directory: string, private hooks: WriteHooks = {}) { this.file = path.join(directory, 'job-scout.json'); }

  async open(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    await this.acquireLock();
    try {
      await fs.mkdir(path.join(this.directory, 'uploads'), { recursive: true });
      await fs.mkdir(path.join(this.directory, 'exports'), { recursive: true });
      await fs.mkdir(path.join(this.directory, 'backups'), { recursive: true });
      try { this.state = parseState(await fs.readFile(this.file, 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new Error('Local data could not be validated. Original file preserved. Run npm run recover -- --list, then restore a listed backup.');
        }
        this.state = initialState();
        await this.persist(this.state, false);
      }
      await this.cleanupTemporaryFiles();
    } catch (error) { await this.close(); throw error; }
  }

  private async acquireLock(): Promise<void> {
    const lockPath = path.join(this.directory, '.lock');
    try {
      const handle = await fs.open(lockPath, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ pid: process.pid, token: this.lockToken })); }
      finally { await handle.close(); }
      this.locked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { pid: number };
      try { process.kill(lock.pid, 0); }
      catch (check) {
        if ((check as NodeJS.ErrnoException).code === 'ESRCH') {
          await fs.unlink(lockPath);
          return this.acquireLock();
        }
      }
      throw new Error('Job Scout is already running for this data folder. Stop that instance first.');
    }
  }

  read(): State { return structuredClone(this.state); }
  get revision(): number { return this.state.revision; }

  update(change: (state: State) => void, expectedRevision?: number): Promise<State> {
    const operation = this.queue.then(async () => {
      if (!this.locked) throw new Error('Repository is closed.');
      if (expectedRevision !== undefined && this.state.revision !== expectedRevision) {
        throw new AppError(409, 'Your view changed. The latest data has been loaded; review your edit and try again.', 'STALE_REVISION');
      }
      const next = structuredClone(this.state);
      change(next);
      next.revision = this.state.revision + 1;
      next.updatedAt = new Date().toISOString();
      parseState(JSON.stringify(next));
      await this.persist(next, true);
      this.state = next;
      return this.read();
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  private async persist(state: State, backup: boolean): Promise<void> {
    const temp = path.join(this.directory, `${randomUUID()}.tmp`);
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(state)); await handle.sync(); }
    finally { await handle.close(); }
    try {
      if (backup) {
        const backupPath = path.join(this.directory, 'backups', `${String(this.state.revision).padStart(10, '0')}-${randomUUID()}.json`);
        await fs.copyFile(this.file, backupPath);
      }
      await this.hooks.beforeRename?.();
      await fs.rename(temp, this.file);
    } catch (error) { await fs.unlink(temp).catch(() => undefined); throw error; }
    const backups = (await fs.readdir(path.join(this.directory, 'backups'))).filter(f => f.endsWith('.json')).sort().reverse();
    await Promise.all(backups.slice(8).map(name => fs.unlink(path.join(this.directory, 'backups', name)).catch(() => undefined)));
  }

  private async cleanupTemporaryFiles(): Promise<void> {
    const files = await fs.readdir(this.directory);
    await Promise.all(files.filter(f => /^[a-f0-9-]+\.tmp$/.test(f)).map(f => fs.unlink(path.join(this.directory, f))));
    const uploads = await fs.readdir(path.join(this.directory, 'uploads'));
    const referenced = new Set(this.state.documents.map(d => path.basename(d.path)));
    await Promise.all(uploads.filter(f => /^[a-f0-9-]+\.(pdf|txt)$/.test(f) && !referenced.has(f)).map(f => fs.unlink(path.join(this.directory, 'uploads', f))));
  }

  async close(): Promise<void> {
    await this.queue;
    if (!this.locked) return;
    const lockPath = path.join(this.directory, '.lock');
    const lock = JSON.parse(await fs.readFile(lockPath, 'utf8')) as { token: string };
    if (lock.token === this.lockToken) await fs.unlink(lockPath);
    this.locked = false;
  }
}

export function parseState(text: string): State {
  const state = State.parse(JSON.parse(text));
  validateReferences(state);
  return state;
}
