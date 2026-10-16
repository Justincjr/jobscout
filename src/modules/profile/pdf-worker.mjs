import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

try {
  const task = getDocument({ data: new Uint8Array(workerData), useSystemFonts: true, stopAtErrors: true, disableFontFace: true });
  const pdf = await task.promise;
  if (pdf.numPages > 40) throw new Error('PDF exceeds 40 pages.');
  let text = '';
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    text += content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('') + '\n';
    if (text.length > 100000) throw new Error('PDF text exceeds the limit.');
  }
  await task.destroy();
  parentPort.postMessage({ text });
} catch { parentPort.postMessage({ error: 'This PDF could not be read. Use a text-based PDF under 40 pages, or paste resume text.' }); }
