import { chromium, Browser, BrowserContext, Frame, Page } from 'playwright';
import { lookup } from 'node:dns/promises';
import { ApplicationForm, ApplicationField } from '../../shared/schema.js';
import { AppError, assert } from '../../shared/errors.js';
import { privateAddress, publicUrl } from '../sources/network.js';
import { ApplicationDriver, Attachment, formSignature } from './service.js';
import { publicBrowserProxy } from './proxy.js';

const controls = 'input,textarea,select';
function beforeSubmit(message: string): AppError { return new AppError(409, message, 'BEFORE_SUBMIT'); }

export async function browserSession(): Promise<{ browser: Browser; context: BrowserContext; page: Page; allowSending: () => void }> {
  let browser: Browser;
  const proxy = await publicBrowserProxy();
  try { browser = await chromium.launch({ channel: 'msedge', headless: true, proxy: { server: proxy.server }, args: ['--proxy-bypass-list=<-loopback>'] }); }
  catch { await proxy.close(); throw beforeSubmit('The application assistant needs Microsoft Edge installed and permission to launch its browser. Install Edge or allow browser access, then prepare again.'); }
  const close = browser.close.bind(browser);
  browser.close = async () => { try { await close(); } finally { await proxy.close(); } };
  browser.on('disconnected', () => { void proxy.close(); });
  const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
  let sending = false;
  const addresses = new Map<string, boolean>();
  await context.route('**/*', async route => {
    try {
      const request = route.request(), url = publicUrl(request.url());
      if (!addresses.has(url.hostname)) {
        const resolved = await lookup(url.hostname, { all: true });
        addresses.set(url.hostname, resolved.length > 0 && resolved.every(a => !privateAddress(a.address)));
      }
      if (!addresses.get(url.hostname)) return void await route.abort();
      if (!sending && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        let query = '';
        try { query = request.postDataJSON()?.query ?? ''; } catch { /* Non-JSON writes are blocked during inspection. */ }
        if (typeof query !== 'string' || !/^\s*query\b/.test(query) || /\bmutation\b/.test(query)) return void await route.abort();
      }
      await route.continue();
    } catch { await route.abort().catch(() => undefined); }
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  return { browser, context, page, allowSending: () => { sending = true; } };
}

async function readForm(frame: Frame, formIndex: number, url: string, root: 'form' | 'body' = 'form'): Promise<ApplicationForm | null> {
  return frame.locator(root).nth(formIndex).evaluate((form, args) => {
    const button = [...form.querySelectorAll('button,input[type=submit]')].find(b => /^(submit(?: application)?|send application|apply(?: now)?)$/i.test((b.textContent || b.getAttribute('value') || '').trim()));
    if (!button) return null;
    const fields: ApplicationField[] = [];
    for (const [index, element] of [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')].entries()) {
      const group = element.closest('.ashby-application-form-field-entry,fieldset,[data-field-path]');
      if (args.root === 'body' && !group && element.type === 'file') continue;
      const choice = element.parentElement?.querySelector('button[data-option]');
      const type = choice ? 'choice' : element.getAttribute('role') === 'combobox' ? 'combobox' : element instanceof HTMLSelectElement ? 'select' : element instanceof HTMLTextAreaElement ? 'textarea' : element.type;
      if (['hidden', 'submit', 'button', 'reset'].includes(type) || element.disabled || (!element.getClientRects().length && !['file', 'choice', 'checkbox', 'radio'].includes(type))) continue;
      if (element.getAttribute('aria-hidden') === 'true' || (!['file', 'checkbox', 'radio', 'choice'].includes(type) && getComputedStyle(element).opacity === '0')) continue;
      const linked = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => document.getElementById(id)?.textContent).filter(Boolean).join(' ');
      const question = group?.querySelector('.ashby-application-form-question-title,legend');
      let nearby = '';
      for (let parent = element.parentElement; parent && parent !== group; parent = parent.parentElement) {
        nearby = parent.querySelector(':scope > label')?.textContent?.trim() ?? ''; if (nearby) break;
      }
      const ownLabel = [...element.labels ?? []].map(l => l.textContent?.trim()).filter(Boolean).join(' ') || element.getAttribute('aria-label') || linked || nearby;
      const fieldTitle = document.getElementById(`${element.id || element.name.replace(/\[\]$/, '')}-label`)?.textContent?.trim();
      const label = [question?.textContent?.trim() || fieldTitle || (type === 'file' ? element.id.replace(/_/g, ' ') : ''), ownLabel].filter((v, i, all) => v && all.indexOf(v) === i).join(' — ') || element.name || element.id;
      const name = group?.getAttribute('data-field-path') || question?.textContent?.trim() || element.name;
      const required = element.required || element.getAttribute('aria-required') === 'true' || Boolean(question?.className.includes('_required_')) || (type === 'file' && Boolean(fieldTitle?.endsWith('*')));
      const isGroup = ['checkbox', 'radio'].includes(type) && (Boolean(group) || Boolean(name && [...form.querySelectorAll('input')].filter(e => e.name === name).length > 1));
      fields.push({ index, name, label: label.slice(0, 4000), type, required: required && !isGroup,
        group: isGroup ? question?.textContent?.trim() || name : undefined, groupRequired: isGroup && required,
        options: choice ? [...element.parentElement!.querySelectorAll('button[data-option]')].map(b => ({ value: b.textContent!.trim(), label: b.textContent!.trim() })) : element instanceof HTMLSelectElement ? [...element.options].map(o => ({ value: o.value, label: o.label })) : [],
        value: choice ? element.parentElement!.querySelector('[aria-pressed=true]')?.textContent?.trim() ?? '' : type === 'checkbox' || type === 'radio' ? String((element as HTMLInputElement).checked) : type === 'file' ? '' : type === 'combobox' ? element.closest('.select__control')?.querySelector('.select__single-value')?.textContent ?? element.value : element.value,
        attachment: '' });
    }
    if (!fields.length) return null;
    return { root: args.root, url: args.url, frameUrl: args.frameUrl, formIndex: args.formIndex, action: (form as HTMLFormElement).action || args.frameUrl, method: (form as HTMLFormElement).method || 'post', button: (button.textContent || button.getAttribute('value') || '').trim(), fields };
  }, { url, frameUrl: frame.url(), formIndex, root });
}

async function discover(page: Page, url: string): Promise<ApplicationForm> {
  const entry = publicUrl(url);
  // Stripe's Greenhouse feed links to a search redirect; use its verified embedded application.
  const stripeId = entry.hostname === 'stripe.com' ? entry.searchParams.get('gh_jid') ?? entry.pathname.match(/\/(\d+)\/?$/)?.[1] : null;
  const destination = stripeId && /^\d+$/.test(stripeId) ? `https://job-boards.greenhouse.io/embed/job_app?for=stripe&token=${stripeId}` : url;
  await page.goto(destination, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const apply = page.getByRole('link', { name: /^(apply now|apply for this role|apply for this job)$/i }).first();
  if (await apply.count()) {
    const href = await apply.getAttribute('href');
    if (href && !href.startsWith('#')) {
      const next = publicUrl(new URL(href, page.url()).href);
      if (next.origin === new URL(page.url()).origin) await page.goto(next.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    }
  }
  // Wait for a rendered form; do not click navigation, consent, or submit buttons.
  if (new URL(page.url()).hostname === 'jobs.ashbyhq.com') await page.getByRole('button', { name: /^submit application$/i }).waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);
  else await page.locator('form').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => undefined);
  const forms: ApplicationForm[] = [];
  for (const frame of page.frames()) {
    for (let i = 0; i < await frame.locator('form').count(); i++) {
      const form = await readForm(frame, i, url); if (form) forms.push(form);
    }
  }
  if (!forms.length && new URL(page.url()).hostname === 'jobs.ashbyhq.com') {
    const form = await readForm(page.mainFrame(), 0, url, 'body'); if (form) forms.push(form);
  }
  if (forms.length !== 1) throw beforeSubmit('A single public application form could not be read. This site may require login, a multi-step flow, or a dedicated integration. Nothing was submitted.');
  const form = forms[0];
  if (form.fields.some(f => f.type === 'password')) throw beforeSubmit('This application requires account access. Nothing was submitted.');
  publicUrl(form.frameUrl); publicUrl(form.action);
  assert(form.fields.length <= 150, 'The application form has too many fields. Nothing was submitted.');
  return form;
}

async function fillFields(frame: Frame, form: ApplicationForm, files: Record<'resume' | 'cover-letter', Attachment>): Promise<void> {
  const elements = frame.locator(form.root ?? 'form').nth(form.formIndex).locator(controls);
  for (const field of [...form.fields.filter(f => f.type !== 'file'), ...form.fields.filter(f => f.type === 'file')]) {
    const element = elements.nth(field.index);
    if (field.type === 'file') { if (field.attachment) await element.setInputFiles(files[field.attachment]); }
    else if (field.type === 'checkbox' || field.type === 'radio') {
      if (field.type === 'radio' && field.value !== 'true') continue;
      await element.evaluate((el, checked) => { const input = el as HTMLInputElement; if (input.checked !== checked) { if (input.labels?.[0]) input.labels[0].click(); else input.click(); } }, field.value === 'true');
    }
    else if (field.type === 'choice') { if (field.value) await element.locator('..').getByRole('button', { name: field.value, exact: true }).click(); }
    else if (field.type === 'combobox') {
      if (!field.value) continue;
      await element.fill(field.value);
      await frame.getByRole('option', { name: field.value, exact: true }).click();
    }
    else if (field.type === 'select') await element.selectOption(field.value);
    else await element.fill(field.value);
  }
}

export class BrowserApplicationDriver implements ApplicationDriver {
  constructor(private session = browserSession) {}
  async inspect(url: string): Promise<ApplicationForm> {
    const session = await this.session();
    try { return await discover(session.page, url); }
    finally { await session.browser.close(); }
  }
  async submit(form: ApplicationForm, files: Record<'resume' | 'cover-letter', Attachment>): Promise<{ confirmed: boolean; receipt: string }> {
    const session = await this.session();
    try {
      const current = await discover(session.page, form.url);
      if (formSignature(current) !== formSignature(form)) throw beforeSubmit('The employer changed the application form. Prepare and review it again. Nothing was submitted.');
      const frame = session.page.frames().find(f => f.url() === form.frameUrl)!;
      session.allowSending();
      await fillFields(frame, form, files);
      const target = frame.locator(form.root ?? 'form').nth(form.formIndex);
      // Required fields revealed by earlier answers must be reviewed before sending.
      const after = await readForm(frame, form.formIndex, form.url, form.root);
      if (!after || formSignature(after) !== formSignature(form)) throw new AppError(409, 'The answers revealed new questions. Submission stopped. Check the employer site before preparing again.');
      if (!await target.evaluate(el => el instanceof HTMLFormElement ? el.checkValidity() : [...el.querySelectorAll('input,textarea,select')].every(e => (e as HTMLInputElement).checkValidity()))) throw new AppError(409, 'The employer rejected one or more answer formats. Submission stopped.');
      const success = /(?:your application (?:has been|was) (?:successfully )?(?:submitted|received)|thank you for applying|application submitted successfully|we have received your application)/i;
      const previous = await frame.locator('body').innerText();
      if (success.test(previous)) throw beforeSubmit('A confirmation was already visible before submission. Check the application status.');
      await target.getByRole('button', { name: form.button, exact: true }).click({ timeout: 15000, noWaitAfter: true });
      await frame.getByText(success).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
      const text = await frame.locator('body').innerText().catch(() => '');
      const confirmation = text.match(success)?.[0];
      return { confirmed: Boolean(confirmation), receipt: confirmation ? `${confirmation} (${frame.url()})` : `No clear confirmation at ${session.page.url()}` };
    } finally { await session.browser.close(); }
  }
}
