import { Worker } from 'node:worker_threads';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Repository } from '../../storage/repository.js';
import { AppError, assert } from '../../shared/errors.js';

async function pdfText(bytes: Buffer): Promise<string> {
  assert(bytes.subarray(0, 5).toString() === '%PDF-', 'The file is not a valid PDF. Paste resume text instead.');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.mjs', import.meta.url), { workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 256 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new AppError(400, 'PDF parsing timed out. Paste resume text instead.')); }, 15000);
    const finish = () => { clearTimeout(timer); void worker.terminate(); };
    worker.once('message', (message: { text?: string; error?: string }) => {
      finish();
      if (message.error) reject(new AppError(400, message.error));
      else if (!message.text || message.text.trim().length < 30) reject(new AppError(400, 'This PDF has no readable text and may be scanned. Paste resume text; OCR is not supported.'));
      else resolve(message.text);
    });
    worker.once('error', () => { finish(); reject(new AppError(400, 'PDF could not be processed. Paste resume text instead.')); });
    worker.once('exit', code => { if (code !== 0) { clearTimeout(timer); reject(new AppError(400, 'PDF worker stopped. Paste resume text instead.')); } });
  });
}

export async function saveDocument(repo: Repository, input: { text?: string; pdf?: string }, revision: number): Promise<string> {
  const isPdf = input.pdf !== undefined;
  const bytes = isPdf ? Buffer.from(input.pdf!, 'base64') : Buffer.from(input.text ?? '', 'utf8');
  assert(bytes.length > 0 && bytes.length <= 5_000_000, 'Use a PDF under 5 MB or paste up to 100,000 characters.');
  const text = isPdf ? await pdfText(bytes) : input.text!.trim();
  assert(text.length >= 30 && text.length <= 100000, 'Resume text must contain 30–100,000 characters.');
  const id = randomUUID(), relative = `uploads/${id}.${isPdf ? 'pdf' : 'txt'}`;
  const file = path.join(repo.directory, relative);
  await fs.writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  try {
    await repo.update(s => { s.documents.push({ id, path: relative, mime: isPdf ? 'application/pdf' : 'text/plain', text, createdAt: new Date().toISOString() }); }, revision);
  } catch (error) { await fs.unlink(file).catch(() => undefined); throw error; }
  return id;
}
