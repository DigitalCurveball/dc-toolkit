import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../src/serve.mjs';
import { findFirstScreen } from '../src/first-screen.mjs';

// dc-qa's first-screen check, in a real browser over fixtures/first/: a page whose opening photo
// loads first, and pages that get it wrong in each way.

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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${server.origin}/test/fixtures/first/${name}.html`, { waitUntil: 'networkidle' });
  const found = await page.evaluate(findFirstScreen);
  await page.close();
  return found;
}

test('an opening photo with fetchpriority="high", and a lazy one far below it, pass', async () => {
  const { lcp, lazy } = await check('pass');
  assert.equal(lcp.image, 'ripple-photo.png');
  assert.equal(lcp.loading, 'eager');
  assert.equal(lcp.prioritised, true);
  assert.deepEqual(lazy, [], 'the lazy photo is below the first screen');
});

test('the largest paint loaded lazily is found', async () => {
  const { lcp } = await check('lazy-hero');
  assert.equal(lcp.loading, 'lazy');
  assert.equal(lcp.prioritised, false);
});

test('the largest paint loaded eagerly but without the priority is found', async () => {
  const { lcp } = await check('no-priority');
  assert.equal(lcp.loading, 'eager');
  assert.equal(lcp.prioritised, false);
});

test('in a row of equal images, the one with the priority counts for whichever paints first', async () => {
  const { lcp, lazy } = await check('row');
  assert.ok(lcp, 'an image is the largest paint');
  assert.equal(lcp.prioritised, true);
  assert.deepEqual(lazy, []);
});

test('a lazily loaded image on the first screen is listed', async () => {
  const { lcp, lazy } = await check('lazy-on-screen');
  assert.equal(lcp.prioritised, true);
  assert.deepEqual(lazy.map((img) => img.image), ['ripple-photo-2.svg']);
});
