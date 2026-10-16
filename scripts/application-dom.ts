import { browserSession } from '../src/modules/applications/browser.js';
for (const url of process.argv.slice(2)) {
  const session = await browserSession();
  try {
    await session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await session.page.locator('input:not([type=hidden])').first().waitFor({ timeout: 20000 }).catch(() => undefined);
    console.log(JSON.stringify({ url: session.page.url(), title: await session.page.title(), frames: await Promise.all(session.page.frames().map(async frame => ({
      url: frame.url(), forms: await frame.locator('form').count(), inputs: await frame.locator('input,textarea,select').evaluateAll(nodes => nodes.map(n => ({ tag: n.tagName, type: n.getAttribute('type'), name: n.getAttribute('name'), role: n.getAttribute('role'), label: n.getAttribute('aria-label') }))), samples: await frame.locator('[role=combobox],button').evaluateAll(nodes => nodes.filter(n => n.getAttribute('role') === 'combobox' || n.textContent === 'Yes').map(n => n.parentElement?.parentElement?.outerHTML.slice(0, 7000))), buttons: await frame.locator('button').allTextContents(), links: await frame.getByRole('link', { name: /apply/i }).evaluateAll(nodes => nodes.map(n => ({ text: n.textContent, href: n.getAttribute('href') })))
    }))) }));
  } finally { await session.browser.close(); }
}
