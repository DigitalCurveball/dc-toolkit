import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../src/serve.mjs';
import { still } from '../src/motion/gradient.js';
import { checkMotion } from '../src/motion-checks.mjs';

// The runtime and the gradient run in a real browser, from the pages in fixtures/motion/, served
// from the package's root as a concept would serve them: no build. Headless Chromium draws WebGL in
// software, as CI's does, where the WebGL effects show their stills; so these tests, like dc-qa's
// checks, ask them to draw anyway (window.dcMotionSoftware), but for the test of exactly that.

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

async function open(name, options = {}, prepare, { software = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  if (software) await context.addInitScript(() => (window.dcMotionSoftware = true));
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

test('where WebGL is drawn in software, with no graphics chip, the effect shows its still and compiles nothing', async () => {
  const compiles = (context) => context.addInitScript(() => {
    window.compiled = 0;
    const original = WebGLRenderingContext.prototype.compileShader;
    WebGLRenderingContext.prototype.compileShader = function (...args) {
      window.compiled++;
      return original.apply(this, args);
    };
  });
  const { context, page } = await open('pass', {}, compiles, { software: false });
  await page.waitForFunction(() => window.dcMotion?.instances()[0]?.state === 'failed', null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.dcMotion.instances()[0].reason), 'unsupported');
  assert.equal(await page.locator('.dc-motion-layer').count(), 0);
  assert.equal(await page.evaluate(() => window.compiled), 0);
  assert.equal(await page.locator('.dc-motion-toggle').isVisible(), false);
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

test("an effect that plays once keeps its first moment until half of it is on the screen, then plays", async () => {
  const { context, page } = await open('play-once');
  // A quarter of it in view: near enough to start, not yet seen.
  await page.evaluate(() => window.scrollTo(0, 500));
  await running(page);
  await page.waitForFunction(() => window.times.length > 10);
  assert.ok(await page.evaluate(() => window.times.every((t) => t === 0)));
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForFunction(() => window.times.at(-1) > 0.2);
  await context.close();
});

// The particle logo (particle-logo.js), from fixtures/motion/particle-logo.html: a 300px logo, a
// red square over a grey circle, centred in a 600 by 500 figure.

const drawn = (page) => page.waitForFunction(() => document.querySelector('#logo > canvas.is-shown'), null, { timeout: 10000 });

/** Of the dots drawn, how many, and the share inside the logo's box. */
const dots = (page) => page.evaluate(() => {
  const figure = document.querySelector('#logo');
  const canvas = figure.querySelector(':scope > canvas');
  const scale = canvas.width / figure.clientWidth;
  const f = figure.getBoundingClientRect();
  const l = figure.querySelector('svg, img').getBoundingClientRect();
  const [x0, y0, x1, y1] = [l.left - f.left, l.top - f.top, l.right - f.left, l.bottom - f.top].map((n) => n * scale);
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  let total = 0;
  let inside = 0;
  for (let p = 0; p < data.length / 4; p++) {
    if (data[p * 4 + 3] < 128) continue;
    total++;
    const x = p % canvas.width;
    const y = Math.floor(p / canvas.width);
    if (x >= x0 && x < x1 && y >= y0 && y < y1) inside++;
  }
  return { total, inside: inside / total };
});

/** What is drawn in a 12px square around a point on the logo, in CSS pixels from its top left: the share painted, and its mean colour. */
const patch = (page, x, y) => page.evaluate(([x, y]) => {
  const figure = document.querySelector('#logo');
  const canvas = figure.querySelector(':scope > canvas');
  const scale = canvas.width / figure.clientWidth;
  const f = figure.getBoundingClientRect();
  const l = figure.querySelector('svg, img').getBoundingClientRect();
  const size = Math.round(12 * scale);
  const left = Math.round((l.left - f.left + x - 6) * scale);
  const top = Math.round((l.top - f.top + y - 6) * scale);
  const { data } = canvas.getContext('2d').getImageData(left, top, size, size);
  let painted = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    painted++;
    for (let c = 0; c < 3; c++) sum[c] += data[i + c];
  }
  return { painted: painted / (size * size), colour: sum.map((s) => Math.round(s / Math.max(painted, 1))) };
}, [x, y]);

test('the particle logo draws the logo in dots of its own colours, and hides the logo under them', async () => {
  const { context, page } = await open('particle-logo');
  await drawn(page);
  await page.evaluate(() => window.dcMotion.pause());
  await page.evaluate(() => window.dcMotion.seek(10));
  const square = await patch(page, 67, 67);
  assert.ok(square.painted > 0.3, `the square is drawn (${square.painted})`);
  assert.ok(square.colour.every((c, i) => Math.abs(c - [216, 30, 30][i]) < 12), `in the page's red (${square.colour})`);
  const circle = await patch(page, 216, 216);
  assert.ok(circle.colour.every((c) => Math.abs(c - 85) < 12), `the circle in its grey (${circle.colour})`);
  assert.equal((await patch(page, 230, 40)).painted, 0); // where the logo has nothing
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#logo svg')).opacity === '0');
  await context.close();
});

test('the particle logo starts as scattered dots, gathers within three seconds, and needs no pause control', async () => {
  const { context, page } = await open('particle-logo');
  await drawn(page);
  await page.evaluate(() => window.dcMotion.pause());
  await page.evaluate(() => window.dcMotion.seek(0));
  const scattered = await dots(page);
  await page.evaluate(() => window.dcMotion.seek(3));
  const gathered = await dots(page);
  assert.ok(scattered.inside < 0.7, `scattered at first (${scattered.inside} inside the logo)`);
  assert.ok(gathered.inside > 0.99, `gathered by three seconds (${gathered.inside})`);
  assert.equal(await page.evaluate(() => window.dcMotion.instances()[0].loops), false);
  assert.equal(await page.locator('.dc-motion-toggle').count(), 0);
  await context.close();
});

test("the particle logo's dots move aside from a mouse, and spring back when it leaves", async () => {
  const { context, page } = await open('particle-logo');
  await drawn(page);
  await page.waitForTimeout(3000); // gathered
  const box = await page.locator('#logo svg').boundingBox();
  await page.mouse.move(box.x + 67, box.y + 67, { steps: 4 });
  await page.waitForTimeout(500);
  assert.ok((await patch(page, 67, 67)).painted < 0.05, 'pushed aside');
  await page.mouse.move(box.x + 450, box.y + 450, { steps: 4 });
  await page.waitForTimeout(1500);
  assert.ok((await patch(page, 67, 67)).painted > 0.3, 'back in place');
  await context.close();
});

test("the particle logo's dots drift apart as it scrolls off the top, and gather when it returns", async () => {
  const { context, page } = await open('particle-logo');
  await drawn(page);
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.scrollTo(0, 250));
  await page.waitForTimeout(300);
  const apart = await dots(page);
  assert.ok(apart.inside < 0.8, `apart (${apart.inside} inside the logo)`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  assert.ok((await dots(page)).inside > 0.99, 'together again');
  await context.close();
});

test('the particle logo works from an <img> of the logo too', async () => {
  const { context, page } = await open('particle-logo-img');
  await drawn(page);
  await page.evaluate(() => window.dcMotion.pause());
  await page.evaluate(() => window.dcMotion.seek(10));
  const { total, inside } = await dots(page);
  assert.ok(total > 1000 && inside > 0.99, `${total} dot pixels, ${inside} inside`);
  assert.ok((await patch(page, 67, 67)).colour[0] > 200);
  await context.close();
});

test('under reduced motion the particle logo is the logo itself', async () => {
  const { context, page } = await open('particle-logo', { reducedMotion: 'reduce' });
  await page.waitForTimeout(1500);
  assert.deepEqual(await states(page), ['still']);
  assert.equal(await page.locator('#logo > canvas').count(), 0);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#logo svg')).opacity), '1');
  await context.close();
});

test('dc-qa passes the particle logo, which plays once and needs no pause control', async () => {
  const result = await checkMotion(browser, fixture('particle-logo'));
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.effects.map((e) => [e.name, e.loops]), [['the "particle-logo" effect (#logo)', false]]);
});

test('two effects registered by their own scripts, as two components write them, both start', async () => {
  const { context, page } = await open('two-effects');
  await page.waitForFunction(() => window.dcMotion?.instances().every((i) => i.state === 'running'), null, { timeout: 10000 }).catch(() => {});
  assert.deepEqual(await states(page), ['running', 'running']);
  await context.close();
});

// The rippling photos (ripple.js), from fixtures/motion/ripple.html: #top on the screen when the
// page opens, #below further down, a raster chosen through srcset and cropped to another shape with
// object-fit: cover; and fixtures/motion/ripple-two.html, two different photos side by side.

/** Counts the WebGL contexts the page asks for. */
const countWebGL = (context) => context.addInitScript(() => {
  window.webgl = 0;
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (type.startsWith('webgl')) window.webgl++;
    return original.call(this, type, ...rest);
  };
});

const shown = (page, id) => page.evaluate((id) => document.querySelector(`#${id} > canvas`)?.classList.contains('is-shown') ?? false, id);

/**
 * Draws every effect at `time` and reads one photo's ripple in the same task, while its drawing
 * buffer holds the frame: how far it is from the photo as the page shows it, the mean difference
 * of each colour, from 0 to 255.
 */
const difference = (page, id, time) => page.evaluate(([id, time]) => {
  window.dcMotion.seek(time);
  const layer = document.querySelector(`#${id} > canvas`);
  const img = document.querySelector(`#${id} img`);
  const { width, height } = layer;
  const read = (paint) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    paint(context);
    return context.getImageData(0, 0, width, height).data;
  };
  const drawn = read((context) => context.drawImage(layer, 0, 0));
  // The photo as the page fits it, cover and centred or filling its box: the whole photo placed
  // and clipped, since naturalWidth, for a photo chosen through srcset, isn't in its pixels.
  const photo = read((context) => {
    const cover = getComputedStyle(img).objectFit === 'cover';
    const zoom = cover ? Math.max(width / img.naturalWidth, height / img.naturalHeight) : 0;
    const [dw, dh] = cover ? [img.naturalWidth * zoom, img.naturalHeight * zoom] : [width, height];
    context.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);
  });
  let sum = 0;
  for (let i = 0; i < drawn.length; i += 4) sum += Math.abs(drawn[i] - photo[i]) + Math.abs(drawn[i + 1] - photo[i + 1]) + Math.abs(drawn[i + 2] - photo[i + 2]);
  return sum / (drawn.length / 4) / 3;
}, [id, time]);

test('a photo on the screen when the page opens stays as it is, with no WebGL, until the pointer moves over it', async () => {
  const { context, page } = await open('ripple', {}, countWebGL);
  await running(page);
  await page.waitForTimeout(1500);
  assert.equal(await shown(page, 'top'), false);
  assert.equal(await page.evaluate(() => window.webgl), 0);
  await context.close();
});

test('the pointer drops ripples that bend the photo; once they fade, the photo itself is back and the WebGL is let go', async () => {
  const { context, page } = await open('ripple');
  await running(page);
  const figure = page.locator('#top');
  const before = await figure.screenshot();
  const box = await page.locator('#top img').boundingBox();
  await page.mouse.move(box.x + 60, box.y + 160);
  await page.mouse.move(box.x + 420, box.y + 160, { steps: 12 });
  await page.waitForTimeout(250);
  assert.equal(await shown(page, 'top'), true);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#top img')).opacity), '0');
  assert.equal((await figure.screenshot()).equals(before), false, 'the photo bends');
  await page.mouse.move(box.x + 700, box.y + 500);
  await page.waitForFunction(() => !document.querySelector('#top > canvas'), null, { timeout: 4000 });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#top img')).opacity), '1');
  assert.equal((await figure.screenshot()).equals(before), true, 'the photo itself is back');
  await context.close();
});

test('a photo scrolling into view ripples once and settles, its frames the photo as the page crops it', async () => {
  const { context, page } = await open('ripple');
  await running(page);
  await page.evaluate(() => document.querySelector('#below').scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => document.querySelector('#below > canvas')?.classList.contains('is-shown'), null, { timeout: 5000 });
  await page.evaluate(() => window.dcMotion.pause());
  const rippling = await difference(page, 'below', 0.5);
  const settling = await difference(page, 'below', 1.9); // its last frames, before it gives way to the photo
  assert.ok(rippling > 2, `it ripples (${rippling.toFixed(1)})`);
  assert.ok(settling < 1, `and settles on the photo, cropped and the right way up (${settling.toFixed(1)})`);
  await page.evaluate(() => window.dcMotion.resume());
  await page.waitForFunction(() => !document.querySelector('#below > canvas'), null, { timeout: 5000 });
  await context.close();
});

// Firefox for Android (Pixel 8a, 2026-11-25) swapped two photos rippling at once when both drew in
// one shared WebGL canvas and copied it to their own: it read that canvas out of step. Chromium here
// draws in software and never showed it, so the test holds what fixed it: a canvas of its own each.
test('two photos rippling at once each draw in a WebGL canvas of their own, never a copy of another', async () => {
  const copies = (context) => context.addInitScript(() => {
    window.copies = 0;
    const original = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (source, ...rest) {
      if (source instanceof HTMLCanvasElement || source instanceof OffscreenCanvas) window.copies++;
      return original.call(this, source, ...rest);
    };
  });
  const { context, page } = await open('ripple-two', {}, copies);
  await page.waitForFunction(() => window.dcMotion?.instances().length === 2);
  await page.evaluate(() => document.querySelector('.row').scrollIntoView({ block: 'center' }));
  await page.waitForFunction(() => document.querySelectorAll('figure > canvas.is-shown').length === 2, null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.copies), 0);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('figure > canvas')].map((c) => Boolean(c.getContext('webgl')))), [true, true]);
  await page.evaluate(() => window.dcMotion.pause());
  for (const id of ['first', 'second']) {
    const away = await difference(page, id, 1.9);
    assert.ok(away < 1, `#${id} shows its own photo (${away.toFixed(1)})`);
  }
  await context.close();
});

test('on a touch screen, a tap ripples a photo where the finger lands', async () => {
  const { context, page } = await open('ripple', { hasTouch: true });
  await running(page);
  const box = await page.locator('#top img').boundingBox();
  await page.touchscreen.tap(box.x + 120, box.y + 100);
  await page.waitForFunction(() => document.querySelector('#top > canvas')?.classList.contains('is-shown'), null, { timeout: 3000 });
  await page.waitForFunction(() => !document.querySelector('#top > canvas'), null, { timeout: 5000 });
  await context.close();
});

test('a touch that moves, or becomes a scroll, does not ripple a photo', async () => {
  const { context, page } = await open('ripple', { hasTouch: true });
  await running(page);
  // As a phone sends them: a finger down that drags away, and one the browser takes for a scroll.
  await page.evaluate(() => {
    const img = document.querySelector('#top img');
    const box = img.getBoundingClientRect();
    const at = (type, x, id) => img.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: id, isPrimary: true, bubbles: true, clientX: box.left + x, clientY: box.top + 100 }));
    at('pointerdown', 100, 1);
    at('pointermove', 140, 1);
    at('pointerup', 140, 1);
    at('pointerdown', 200, 2);
    at('pointercancel', 200, 2);
  });
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#top > canvas').count(), 0);
  await context.close();
});

test('a tap on a photo inside a link does not ripple it: the link opens', async () => {
  const { context, page } = await open('ripple-link', { hasTouch: true });
  await running(page);
  const box = await page.locator('#card img').boundingBox();
  await page.touchscreen.tap(box.x + 120, box.y + 100);
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#card > canvas').count(), 0);
  await context.close();
});

test('without WebGL a photo stays as it is under the pointer', async () => {
  const noWebGL = (context) => context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...rest);
    };
  });
  const { context, page } = await open('ripple', {}, noWebGL);
  await running(page);
  const box = await page.locator('#top img').boundingBox();
  await page.mouse.move(box.x + 60, box.y + 160);
  await page.mouse.move(box.x + 420, box.y + 160, { steps: 12 });
  await page.waitForFunction(() => window.dcMotion.instances()[0].state === 'failed', null, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.dcMotion.instances()[0].reason), 'unsupported');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#top img')).opacity), '1');
  await context.close();
});

test('under reduced motion the photos are the photos, and no WebGL is asked for', async () => {
  const { context, page } = await open('ripple', { reducedMotion: 'reduce' }, countWebGL);
  await page.waitForTimeout(1500);
  assert.deepEqual(await states(page), ['still', 'still']);
  assert.equal(await page.locator('.dc-motion-layer').count(), 0);
  assert.equal(await page.evaluate(() => window.webgl), 0);
  await context.close();
});

test('dc-qa passes the rippling photos, which need no pause control', async () => {
  const result = await checkMotion(browser, fixture('ripple'));
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.effects.map((e) => e.loops), [false, false]);
});
