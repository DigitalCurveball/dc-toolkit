import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../src/serve.mjs';
import { still } from '../src/motion/gradient.js';
import { checkMotion } from '../src/motion-checks.mjs';

// The runtime and the gradient run in a real browser, from the pages in fixtures/motion/, served
// from the package's root as a concept would serve them: no build. Headless Chromium draws WebGL in
// software, as CI's does.

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

const fixture = (name) => `${server.origin}/test/fixtures/motion/${name}.html`;
const states = (page) => page.evaluate(() => window.dcMotion.instances().map((i) => i.state));

async function open(name, options = {}, prepare) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  if (prepare) await prepare(context);
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto(fixture(name));
  return { context, page, requests };
}

const running = (page) => page.waitForFunction(() => window.dcMotion?.instances().some((i) => i.state === 'running'), null, { timeout: 10000 });

test("the gradient's still: the fields as CSS gradients over the ground, the first field painted last", () => {
  const css = still(['#111111', '#ff3333', '#666']);
  const layers = css.split(/,\s*(?=radial-gradient|rgb\(\d+ \d+ \d+\)$)/);
  assert.equal(layers.length, 3);
  assert.match(layers[0], /^radial-gradient\(56% 66% at 86% 16%, rgb\(102 102 102 \/ 1\) 0%/);
  assert.match(layers[1], /^radial-gradient\(62% 70% at 16% 20%, rgb\(255 51 51 \/ 1\) 0%/);
  assert.equal(layers[2], 'rgb(17 17 17)');
  assert.equal(still(['not a colour']), 'none');
});

test('an effect starts once the page has loaded, draws over its still, and shows the pause control', async () => {
  const { context, page } = await open('pass');
  await running(page);
  const layer = await page.evaluate(() => {
    const canvas = document.querySelector('#hero > canvas.dc-motion-layer');
    return canvas && { shown: canvas.classList.contains('is-shown'), hidden: canvas.getAttribute('aria-hidden'), width: canvas.width };
  });
  assert.deepEqual({ ...layer, width: layer.width > 0 }, { shown: true, hidden: 'true', width: true });
  assert.equal(await page.locator('.dc-motion-toggle').isVisible(), true);
  await context.close();
});

test('the pause control pauses every effect, says so, and is remembered on the next page', async () => {
  const { context, page } = await open('pass');
  await running(page);
  const toggle = page.locator('.dc-motion-toggle');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await states(page), ['paused']);
  assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-motion-paused')), true);
  await page.reload();
  await page.waitForFunction(() => window.dcMotion?.instances()[0]?.state === 'paused', null, { timeout: 10000 });
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  // Paused before it ever ran, it still shows its first moment rather than nothing.
  assert.equal(await page.locator('#hero > canvas.is-shown').count(), 1);
  await toggle.click();
  await running(page);
  await context.close();
});

test('under reduced motion the still stays, no effect is fetched, and there is nothing to pause', async () => {
  const { context, page, requests } = await open('pass', { reducedMotion: 'reduce' });
  await page.waitForTimeout(1500);
  assert.deepEqual(await states(page), ['still']);
  assert.equal(await page.locator('.dc-motion-layer').count(), 0);
  assert.equal(await page.locator('.dc-motion-toggle').isVisible(), false);
  assert.equal(requests.some((url) => url.endsWith('/gradient.js')), false);
  await context.close();
});

test('without WebGL the effect gives up and the still stays', async () => {
  const noWebGL = (context) => context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...rest);
    };
  });
  const { context, page } = await open('pass', {}, noWebGL);
  await page.waitForFunction(() => window.dcMotion?.instances()[0]?.state === 'failed', null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.dcMotion.instances()[0].reason), 'unsupported');
  assert.equal(await page.locator('.dc-motion-layer').count(), 0);
  await context.close();
});

test('a lost WebGL context shows the still, and the effect starts again when it returns', async () => {
  const { context, page } = await open('pass');
  await running(page);
  await page.evaluate(() => {
    window.loseIt = document.querySelector('#hero > canvas').getContext('webgl').getExtension('WEBGL_lose_context');
    window.loseIt.loseContext();
  });
  await page.waitForFunction(() => window.dcMotion.instances()[0].state === 'idle');
  assert.equal(await page.locator('#hero > canvas.is-shown').count(), 0);
  await page.evaluate(() => window.loseIt.restoreContext());
  await running(page);
  await page.waitForFunction(() => document.querySelector('#hero > canvas')?.classList.contains('is-shown'));
  await context.close();
});

test('an effect scrolled off the screen stops drawing, and starts again when it returns', async () => {
  const { context, page } = await open('pass');
  await running(page);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => window.dcMotion.instances()[0].state === 'idle');
  await page.evaluate(() => window.scrollTo(0, 0));
  await running(page);
  await context.close();
});

test('dc-qa passes motion that keeps every rule', async () => {
  const result = await checkMotion(browser, fixture('pass'));
  assert.deepEqual(result.problems, []);
  assert.equal(result.effects.length, 1);
  assert.equal(result.contrast.length, 3); // the heading, the line and the pause control's label
  assert.ok(result.contrast.every((c) => c.ratio >= c.needs));
});

test('dc-qa fails a looping effect with no pause control', async () => {
  const { problems } = await checkMotion(browser, fixture('no-toggle'));
  assert.deepEqual(problems, ['a looping effect runs with no visible pause control (.dc-motion-toggle; WCAG 2.2.2)']);
});

test('dc-qa fails an effect with no still, and the text over the blank page it leaves', async () => {
  const { problems } = await checkMotion(browser, fixture('no-still'));
  assert.equal(problems[0], 'the "gradient" effect (#hero) has no still without scripts');
  assert.ok(problems.some((p) => p.startsWith('text over motion: "A heading over motion" (h1) is 1.00:1 at its worst (the still)')));
});

test('dc-qa fails white text over light colours, at the moment it is worst', async () => {
  const { problems, contrast } = await checkMotion(browser, fixture('low-contrast'));
  assert.equal(problems.length, 2);
  assert.ok(problems.every((p) => p.startsWith('text over motion: "A ')));
  assert.equal(contrast.find((c) => c.element === 'p').needs, 4.5);
  assert.equal(contrast.find((c) => c.element === 'h1').needs, 3);
});
