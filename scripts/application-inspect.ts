import { BrowserApplicationDriver } from '../src/modules/applications/browser.js';

// Read-only probe: no applicant data, uploads, or submission calls.
for (const url of process.argv.slice(2)) {
  try {
    const form = await new BrowserApplicationDriver().inspect(url);
    console.log(JSON.stringify({ url, frame: form.frameUrl, fields: form.fields.map(f => ({ label: f.label, type: f.type, required: f.required, options: f.options.length })) }));
  } catch (error) { console.log(JSON.stringify({ url, error: (error as Error).message })); process.exitCode = 1; }
}
