import { test, expect } from '@playwright/test';
import { BrowserApplicationDriver } from '../../src/modules/applications/browser.js';

test('application browser inspects without sending, then sends reviewed fields and a PDF after approval', async ({ browser }) => {
  let sends = 0, received = '';
  const driver = new BrowserApplicationDriver(async () => {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const request = route.request();
      if (request.url() === 'https://careers.example.com/send') {
        sends++; received = request.postData() ?? '';
        await route.fulfill({ contentType: 'text/html', body: '<main><h1>Thank you for applying</h1></main>' }); return;
      }
      if (request.url() !== 'https://careers.example.com/apply') return void await route.abort();
      await route.fulfill({ contentType: 'text/html', body: `<form action="/send" method="post" enctype="multipart/form-data"><label>Email<input type="email" name="email" required></label><label>Resume<input type="file" name="resume" required></label><button>Submit application</button></form>` });
    });
    const page = await context.newPage();
    return { browser: { close: () => context.close() } as typeof browser, context, page, allowSending: () => undefined };
  });
  const form = await driver.inspect('https://careers.example.com/apply');
  expect(sends).toBe(0); expect(form.fields).toHaveLength(2);
  form.fields[0].value = 'candidate@example.com'; form.fields[1].attachment = 'resume';
  const file = { name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-test reviewed content') };
  const result = await driver.submit(form, { resume: file, 'cover-letter': file });
  expect(sends).toBe(1); expect(received).toContain('candidate@example.com'); expect(received).toContain('resume.pdf'); expect(result.confirmed).toBe(true);
});

test('changed employer questions stop the browser before sending answers', async ({ browser }) => {
  let sends = 0, changed = false;
  const driver = new BrowserApplicationDriver(async () => {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      if (route.request().method() === 'POST') sends++;
      await route.fulfill({ contentType: 'text/html', body: `<form action="/send" method="post"><label>${changed ? 'Changed question' : 'Email'}<input name="email"></label><button>Submit application</button></form>` });
    });
    return { browser: { close: () => context.close() } as typeof browser, context, page: await context.newPage(), allowSending: () => undefined };
  });
  const form = await driver.inspect('https://careers.example.com/apply'); changed = true; form.fields[0].value = 'candidate@example.com';
  await expect(driver.submit(form, {} as never)).rejects.toThrow('changed the application form'); expect(sends).toBe(0);
});

test('Ashby layout preserves grouped choices and uses the approved yes/no answer', async ({ browser }) => {
  const html = `<div class="ashby-application-form-field-entry" data-field-path="email"><label for="email" class="ashby-application-form-question-title _required_x">Email</label><input id="email" type="email" required></div>
    <div class="ashby-application-form-field-entry" data-field-path="sponsorship"><label class="ashby-application-form-question-title _required_x">Need sponsorship?</label><div><button data-option="yes" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true');this.nextElementSibling.setAttribute('aria-pressed','false')">Yes</button><button data-option="no" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true');this.previousElementSibling.setAttribute('aria-pressed','false')">No</button><input type="checkbox" hidden></div></div>
    <fieldset><legend class="_required_x">Preferred office</legend><label><input type="checkbox" name="office" value="Singapore" hidden>Singapore</label><label><input type="checkbox" name="office" value="London" hidden>London</label></fieldset>
    <button onclick="if(document.querySelector('[data-option=no]').getAttribute('aria-pressed')==='true' && document.querySelector('[value=Singapore]').checked) document.body.innerHTML='<h1>Thank you for applying</h1>'">Submit Application</button>`;
  const driver = new BrowserApplicationDriver(async () => {
    const context = await browser.newContext();
    await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
    return { browser: { close: () => context.close() } as typeof browser, context, page: await context.newPage(), allowSending: () => undefined };
  });
  const form = await driver.inspect('https://jobs.ashbyhq.com/example/one/application');
  expect(form.root).toBe('body'); expect(form.fields).toHaveLength(4);
  form.fields[0].value = 'candidate@example.com'; form.fields[1].value = 'No'; form.fields[2].value = 'true';
  expect(form.fields[2].groupRequired).toBe(true); expect(form.fields[2].required).toBe(false);
  expect((await driver.submit(form, {} as never)).confirmed).toBe(true);
});
