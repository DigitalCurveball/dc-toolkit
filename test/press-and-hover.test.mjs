import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../src/serve.mjs';
import { findPressAndHover } from '../src/press-and-hover.mjs';

// dc-qa's press and hover check, run in a real browser over fixtures/press/: pass.html keeps both
// rules in the ways a site does, fail.html breaks each.

let server;
let browser;
before(async () => {
  server = await serve(fileURLToPath(new URL('..', import.meta.url)));
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  server.close();
});

async function check(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${server.origin}/test/fixtures/press/${name}.html`);
  const found = await page.evaluate(findPressAndHover);
  await page.close();
  return found;
}

test('hover inside the mouse query, and a press state on each button, a nested rule\'s too, pass', async () => {
  const { hover, press } = await check('pass');
  assert.deepEqual(hover, []);
  assert.deepEqual(press, [], 'a text link, a disabled or hidden button, a photo link and a skip link are left out');
});

test('hover outside the mouse query fails, inside a media rule that asks for anything less too', async () => {
  const { hover } = await check('fail');
  assert.deepEqual(hover.map((h) => h.selector), ['.btn:hover', '.card:hover', '.cta:hover']);
  assert.ok(hover.every((h) => h.sheet === 'a <style> in the page'));
});

test('a button, a link drawn as one and a role=button with no :active fail, and :not(:active) is no press state', async () => {
  const { press } = await check('fail');
  assert.deepEqual(press.map((p) => `${p.element} ${p.text}`), ['a.btn Book a call', 'a.cta Email us', 'button.plain Send', 'div.toggle Show more']);
});
