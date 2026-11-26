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

test('where WebGL is drawn in software, with no graphics chip, the effect shows its still, and the page makes no WebGL context', async () => {
  const compiles = (context) => context.addInitScript(() => {
    window.compiled = 0;
    window.contexts = 0;
    const original = WebGLRenderingContext.prototype.compileShader;
    WebGLRenderingContext.prototype.compileShader = function (...args) {
      window.compiled++;
      return original.apply(this, args);
    };
    // Making one is itself the long task (dc-pipeline #61): a worker asks instead.
    const make = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (/webgl/.test(type)) window.contexts++;
      return make.call(this, type, ...rest);
    };
  });
  const { context, page } = await open('pass', {}, compiles, { software: false });
  await page.waitForFunction(() => window.dcMotion?.instances()[0]?.state === 'failed', null, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.dcMotion.instances()[0].reason), 'unsupported');
  assert.equal(await page.locator('.dc-motion-layer').count(), 0);
  assert.equal(await page.evaluate(() => window.compiled), 0);
  assert.equal(await page.evaluate(() => window.contexts), 0, 'no context on the page');
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
  // Both found and both running: before the runtime has found any, "every" is true of none.
  await page.waitForFunction(() => window.dcMotion?.instances().length === 2 && window.dcMotion.instances().every((i) => i.state === 'running'), null, { timeout: 10000 }).catch(() => {});
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

// The scroll story (story.js and story.css), from fixtures/motion/story.html: four steps, each a
// picture and a few lines, below 700px of page.

/** Each picture's opacity, and where the shown one is on the screen. */
const story = (page) => page.evaluate(() => {
  const pictures = [...document.querySelectorAll('.dc-story-picture')];
  const shown = pictures.findIndex((p) => getComputedStyle(p).opacity === '1');
  const box = pictures[Math.max(shown, 0)].getBoundingClientRect();
  return { opacities: pictures.map((p) => getComputedStyle(p).opacity), shown, top: Math.round(box.top), left: Math.round(box.left), position: getComputedStyle(pictures[0]).position };
});

/** Scrolls so that step `i`'s text has its top a little above the middle of the screen. */
const readStep = (page, i) => page.evaluate((i) => {
  const text = document.querySelectorAll('.dc-story-text')[i];
  const picture = document.querySelector('.dc-story-picture').getBoundingClientRect();
  const beside = picture.left >= text.getBoundingClientRect().right - 1;
  const line = beside ? innerHeight / 2 : (picture.height + innerHeight) / 2;
  scrollBy(0, text.getBoundingClientRect().top - line + 40);
}, i);

const settled = (page) => page.waitForTimeout(900); // a frame, and the cross-fade's 0.6s

test('on a laptop the scroll story pins its picture beside the steps, and shows each step\'s as it reaches the middle', async () => {
  const { context, page } = await open('story');
  await page.waitForFunction(() => window.dcMotion?.instances().length === 1);
  await readStep(page, 0);
  await page.waitForFunction(() => window.dcMotion.instances()[0].state === 'running');
  await settled(page);
  const first = await story(page);
  assert.equal(first.position, 'sticky');
  assert.equal(first.shown, 0);
  assert.ok(first.left > 500, `beside the steps (${first.left})`);
  // It rises with the first step until it is centred on the screen, then holds there.
  await readStep(page, 1);
  await settled(page);
  const second = await story(page);
  await readStep(page, 2);
  await settled(page);
  const third = await story(page);
  assert.equal(second.shown, 1);
  assert.equal(third.shown, 2);
  assert.deepEqual(third.opacities.filter((o) => o !== '0').length, 1);
  assert.ok(Math.abs(third.top - second.top) <= 1, `pinned (${second.top}, then ${third.top})`);
  assert.ok(Math.abs(third.top + (await page.evaluate(() => document.querySelector('.dc-story-picture').offsetHeight)) / 2 - 400) <= 2, 'in the middle of the screen');
  await context.close();
});

test('on a phone the scroll story pins its picture above the steps, which scroll beneath it', async () => {
  const { context, page } = await open('story', { viewport: { width: 390, height: 844 } });
  await page.waitForFunction(() => window.dcMotion?.instances().length === 1);
  await readStep(page, 1);
  await page.waitForFunction(() => window.dcMotion.instances()[0].state === 'running');
  await settled(page);
  const second = await story(page);
  assert.equal(second.shown, 1);
  assert.equal(second.top, 0);
  await readStep(page, 3);
  await settled(page);
  const fourth = await story(page);
  assert.equal(fourth.shown, 3);
  assert.equal(fourth.top, 0);
  // The step being read is below the picture, not under it.
  const covered = await page.evaluate(() => {
    const text = document.querySelectorAll('.dc-story-text')[3].querySelector('h2').getBoundingClientRect();
    return text.top < document.querySelector('.dc-story-picture').getBoundingClientRect().bottom;
  });
  assert.equal(covered, false);
  await context.close();
});

test('without scripts, or under reduced motion, the scroll story is its steps stacked, each with its picture', async () => {
  for (const options of [{ javaScriptEnabled: false }, { reducedMotion: 'reduce' }]) {
    const { context, page } = await open('story', options);
    await page.waitForTimeout(1200);
    const { opacities, position } = await story(page);
    assert.equal(position, 'static', JSON.stringify(options));
    assert.deepEqual(opacities, ['1', '1', '1', '1'], JSON.stringify(options));
    // Each picture sits above its own step's text, in order down the page.
    const order = await page.evaluate(() => [...document.querySelectorAll('.dc-story-step')].map((s) => {
      const p = s.querySelector('.dc-story-picture').getBoundingClientRect();
      const t = s.querySelector('.dc-story-text').getBoundingClientRect();
      return [Math.round(p.top), Math.round(t.top)];
    }));
    order.forEach(([picture, text], i) => {
      assert.ok(picture < text, `step ${i}: its picture above its text`);
      if (i) assert.ok(picture > order[i - 1][1], `step ${i}: below the step before`);
    });
    await context.close();
  }
});

test("tabbing into a step shows its picture", async () => {
  const { context, page } = await open('story');
  await page.waitForFunction(() => window.dcMotion?.instances().length === 1);
  await readStep(page, 0);
  await page.waitForFunction(() => window.dcMotion.instances()[0].state === 'running');
  await settled(page);
  await page.focus('.dc-story-step:last-child a');
  await settled(page);
  assert.equal((await story(page)).shown, 3);
  await context.close();
});

test('the pause control leaves the scroll story be: it moves only as the visitor scrolls', async () => {
  const { context, page } = await open('story');
  await page.waitForFunction(() => window.dcMotion?.instances().length === 1);
  await readStep(page, 0);
  await page.waitForFunction(() => window.dcMotion.instances()[0].state === 'running');
  await page.evaluate(() => window.dcMotion.pause());
  await readStep(page, 2);
  await settled(page);
  assert.equal((await story(page)).shown, 2);
  await context.close();
});

test('the scroll story shifts nothing when its script starts, even on the first screen', async () => {
  const { context, page } = await open('story', {}, (context) => context.addInitScript(() => {
    window.shifts = 0;
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.shifts += entry.value; }).observe({ type: 'layout-shift', buffered: true });
  }));
  await page.evaluate(() => scrollTo(0, 700)); // the story at the top of the screen, before the script starts
  await page.waitForFunction(() => window.dcMotion?.instances()[0]?.state === 'running', null, { timeout: 10000 });
  await settled(page);
  assert.equal(await page.evaluate(() => window.shifts), 0);
  await context.close();
});

test('dc-qa passes the scroll story, which needs no pause control', async () => {
  const result = await checkMotion(browser, fixture('story'));
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.effects.map((e) => e.loops), [false]);
});

// Kinetic type (scramble.js, band.js), from fixtures/motion/kinetic.html: a label (#label) a screen
// down, then a band (#band), with the page's pause control.

const toward = (page, id) => page.evaluate((id) => document.getElementById(id).scrollIntoView({ block: 'center' }), id);
const kinetic = (page) => page.waitForFunction(() => window.dcMotion?.instances().length === 2, null, { timeout: 10000 });
const bandX = (page) => page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('#band .dc-band-track')).transform).m41);

test('a label scrambles as it scrolls in and on hover, in its own width, while screen readers have the real text', async () => {
  const { context, page } = await open('kinetic');
  await kinetic(page);
  const width = () => page.evaluate(() => {
    const range = document.createRange();
    const shown = document.querySelector('#label [aria-hidden="true"]');
    range.selectNodeContents(shown ?? document.querySelector('#label'));
    return range.getBoundingClientRect().width;
  });
  const real = await width();
  const height = await page.evaluate(() => document.querySelector('#label').offsetHeight);
  await toward(page, 'label');
  await page.waitForFunction(() => document.querySelector('#label [aria-hidden="true"]'), null, { timeout: 5000 });
  let scrambled = false;
  for (let i = 0; i < 4; i++) {
    const now = await page.evaluate(() => ({
      shown: document.querySelector('#label [aria-hidden="true"]')?.textContent,
      read: [...document.querySelectorAll('#label *')].find((el) => !el.closest('[aria-hidden="true"]') && el.children.length === 0)?.textContent,
      height: document.querySelector('#label').offsetHeight,
    }));
    if (now.shown === undefined) break;
    if (now.shown !== 'Motion library') scrambled = true;
    assert.equal(now.read, 'Motion library');
    assert.equal(now.height, height);
    assert.ok(Math.abs((await width()) - real) <= 1, 'in its own width');
    await page.waitForTimeout(80);
  }
  assert.ok(scrambled, 'it scrambled');
  await page.waitForFunction(() => !document.querySelector('#label [aria-hidden="true"]'), null, { timeout: 3000 });
  assert.equal(await page.evaluate(() => document.querySelector('#label').innerHTML), 'Motion library');
  await page.hover('#label');
  await page.waitForFunction(() => document.querySelector('#label [aria-hidden="true"]'), null, { timeout: 3000 });
  await page.waitForFunction(() => !document.querySelector('#label [aria-hidden="true"]'), null, { timeout: 3000 });
  await context.close();
});

test('the band drifts, speeds up as the page scrolls, holds under the pause control, and is read once', async () => {
  const { context, page } = await open('kinetic');
  await kinetic(page);
  await toward(page, 'band');
  await page.waitForFunction(() => window.dcMotion.instances()[1].state === 'running');
  await page.waitForTimeout(300);
  const a = await bandX(page);
  await page.waitForTimeout(500);
  const drift = Math.abs((await bandX(page)) - a);
  assert.ok(drift > 10, `it drifts (${drift.toFixed(0)}px in half a second)`);
  const c = await bandX(page);
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, 20);
    await page.waitForTimeout(50);
  }
  const scrolled = Math.abs((await bandX(page)) - c);
  assert.ok(scrolled > drift * 1.3, `faster as the page scrolls (${scrolled.toFixed(0)}px, against ${drift.toFixed(0)})`);
  const readable = await page.evaluate(() => [...document.querySelectorAll('#band *')].filter((el) => el.children.length === 0 && el.textContent.includes('guesswork') && !el.closest('[aria-hidden="true"]')).length);
  assert.equal(readable, 1);
  const toggle = page.locator('.dc-motion-toggle');
  assert.equal(await toggle.isVisible(), true);
  await toggle.click();
  const e = await bandX(page);
  await page.waitForTimeout(400);
  assert.equal(await bandX(page), e);
  await context.close();
});

test('with motion paused, a label shows at once', async () => {
  const { context, page } = await open('kinetic');
  await kinetic(page);
  await page.evaluate(() => window.dcMotion.pause());
  await toward(page, 'label');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#label [aria-hidden="true"]').count(), 0);
  await context.close();
});

test('without scripts, or under reduced motion, the type is still, and the band is one row that wraps', async () => {
  for (const options of [{ javaScriptEnabled: false }, { reducedMotion: 'reduce' }]) {
    const { context, page } = await open('kinetic', options);
    await page.waitForTimeout(1200);
    await toward(page, 'label');
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#label [aria-hidden="true"]').count(), 0, JSON.stringify(options));
    assert.equal(await page.locator('#band [aria-hidden="true"]').count(), 0, JSON.stringify(options));
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#band')).whiteSpace), 'normal', JSON.stringify(options));
    await context.close();
  }
});

test('dc-qa passes kinetic type, with the band\'s pause control', async () => {
  const result = await checkMotion(browser, fixture('kinetic'));
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.effects.map((e) => e.loops), [false, true]);
});

// Photos that open as they arrive (reveal.js), from fixtures/motion/reveal.html: a photo on the
// first screen (#first), then three more, each over a screen below the last: #centre, with a corner
// radius, opening from its centre; #left, loading lazily, wiping from its left; and #dither,
// formed from its own pixels on a pink paper. The photo #dither shows has a red circle (#d8452b)
// centred at 70% across and 35% down, and blue stripes (#1f5c8a).

const photo = (page, id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  return { clip: getComputedStyle(el).clipPath, scale: new DOMMatrix(getComputedStyle(el.querySelector('img')).transform).a, inline: el.getAttribute('style') ?? '' };
}, id);
/** Scrolls so that the photo's top is `share` of the way down the screen. */
const photoAt = (page, id, share) => page.evaluate(([id, share]) => scrollBy(0, document.getElementById(id).getBoundingClientRect().top - innerHeight * share), [id, share]);
const started = (page, id) => page.waitForFunction((id) => window.dcMotion?.instances().find((i) => i.element.id === id)?.state === 'running', id, { timeout: 10000 });
const caughtUp = (page) => page.waitForTimeout(1000); // the opening's trailing, several times over
const insets = (clip) => (clip.match(/inset\(([^)]*?)(?: round|\))/)?.[1] ?? '').split(/\s+/).map(parseFloat);

test('a photo below the screen opens as the page scrolls it up, trailing the scroll, then is as it was, and never closes again', async () => {
  const { context, page } = await open('reveal');
  await page.waitForFunction(() => window.dcMotion?.instances().length === 4);
  await photoAt(page, 'centre', 1.1);
  await started(page, 'centre');
  const closed = await photo(page, 'centre');
  assert.equal(closed.clip, 'inset(50% round 34px)', 'closed, its own 10px corner and the window\'s 24');
  assert.ok(Math.abs(closed.scale - 1.15) < 0.001, `enlarged (${closed.scale})`);
  await photoAt(page, 'centre', 0.75);
  await caughtUp(page);
  const partway = await photo(page, 'centre');
  const [inset] = insets(partway.clip);
  assert.ok(inset > 5 && inset < 45, `partway open (${partway.clip})`);
  assert.ok(partway.scale > 1 && partway.scale < 1.15, `settling (${partway.scale})`);
  await photoAt(page, 'centre', 0.1);
  await caughtUp(page);
  const shown = await photo(page, 'centre');
  assert.equal(shown.clip, 'none');
  assert.equal(shown.scale, 1);
  assert.doesNotMatch(shown.inline, /clip-path|will-change/);
  await photoAt(page, 'centre', 1.2);
  await caughtUp(page);
  assert.equal((await photo(page, 'centre')).clip, 'none');
  await context.close();
});

test('a photo on the screen when the page opens stays as it is', async () => {
  const { context, page } = await open('reveal');
  await started(page, 'first');
  await page.evaluate(() => scrollBy(0, 300));
  await caughtUp(page);
  const first = await photo(page, 'first');
  assert.equal(first.clip, 'none');
  assert.equal(first.scale, 1);
  await context.close();
});

test('a photo still loading is asked to load, and waits, closed, until it has', async () => {
  let asked = 0;
  const { context, page } = await open('reveal', {}, (context) => context.route('**/ripple-photo.png', async (route) => {
    asked++;
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  }));
  await page.waitForFunction(() => window.dcMotion?.instances().length === 4);
  await photoAt(page, 'left', 1.1);
  await started(page, 'left');
  await photoAt(page, 'left', 0.1);
  await page.waitForTimeout(800);
  assert.ok(asked > 0, 'asked for');
  const waiting = await photo(page, 'left');
  assert.deepEqual(insets(waiting.clip), [0, 100, 0, 0], `closed, a wipe from the left (${waiting.clip})`);
  await page.waitForFunction(() => document.querySelector('#left img').complete, null, { timeout: 5000 });
  await caughtUp(page);
  assert.equal((await photo(page, 'left')).clip, 'none');
  await context.close();
});

test('without scripts, under reduced motion, or with motion paused, every photo is as it is', async () => {
  for (const options of [{ javaScriptEnabled: false }, { reducedMotion: 'reduce' }]) {
    const { context, page } = await open('reveal', options);
    await page.waitForTimeout(1200);
    for (const id of ['centre', 'left', 'dither']) {
      await photoAt(page, id, 1.05);
      await page.waitForTimeout(400);
      assert.equal((await photo(page, id)).clip, 'none', `${id}, ${JSON.stringify(options)}`);
    }
    assert.equal(await dithering(page), false, `dither, ${JSON.stringify(options)}`);
    await context.close();
  }
  const { context, page } = await open('reveal');
  await page.waitForFunction(() => window.dcMotion?.instances().length === 4);
  await photoAt(page, 'centre', 1.1);
  await started(page, 'centre');
  await photoAt(page, 'centre', 0.75);
  await page.waitForTimeout(300);
  assert.notEqual((await photo(page, 'centre')).clip, 'none', 'opening');
  await page.evaluate(() => window.dcMotion.pause());
  await page.waitForTimeout(200);
  assert.equal((await photo(page, 'centre')).clip, 'none', 'opened at once by the pause control');
  await photoAt(page, 'left', 1.1);
  await started(page, 'left');
  assert.equal((await photo(page, 'left')).clip, 'none', 'never closed while paused');
  await photoAt(page, 'dither', 1.1);
  await started(page, 'dither');
  assert.equal(await dithering(page), false, 'never blank while paused');
  await context.close();
});

test('dc-qa passes the opening photos, which need no pause control', async () => {
  const result = await checkMotion(browser, fixture('reveal'));
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.effects.map((e) => e.loops), [false, false, false, false]);
});


const PINK = [0xff, 0xe8, 0xf0];
const BLUE = [0x1f, 0x5c, 0x8a];
const CIRCLE = [0xd8, 0x45, 0x2b];
const near = (a, b, by = 40) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= by;
/** Whether #dither's layer shows, forming or dissolved. */
const dithering = (page) => page.evaluate(() => getComputedStyle(document.querySelector('#dither .dc-reveal-dither')).display !== 'none');

/**
 * The share of pixels near each colour given, in a box of the element where it is on the screen,
 * without scrolling, which would move what scrolling moves: the box's left, top, width and height
 * as shares of the element's (the whole of it by default), down to `rows` CSS pixels from its top.
 */
async function shares(page, id, colours, { box: [l, t, w, h] = [0, 0, 1, 1], rows = Infinity } = {}) {
  const { default: sharp } = await import('sharp');
  const el = await page.locator(`#${id}`).boundingBox();
  const view = page.viewportSize();
  const top = Math.max(el.y + t * el.height, 0);
  const bottom = Math.min(el.y + Math.min((t + h) * el.height, rows), view.height);
  const clip = { x: el.x + l * el.width, y: top, width: w * el.width, height: bottom - top };
  const { data, info } = await sharp(await page.screenshot({ clip })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = colours.map(() => 0);
  for (let i = 0; i < data.length; i += 3) colours.forEach((c, k) => { if (near([data[i], data[i + 1], data[i + 2]], c)) counts[k]++; });
  return counts.map((n) => n / (info.width * info.height));
}

test('a photo dithering in forms from its own pixels in full colour, darks first, and is then the photo itself', async () => {
  const { context, page } = await open('reveal');
  await page.waitForFunction(() => window.dcMotion?.instances().length === 4);
  await photoAt(page, 'dither', 1.1);
  await started(page, 'dither');
  assert.equal(await dithering(page), true);
  await photoAt(page, 'dither', 0.98);
  await page.waitForTimeout(100);
  const [blank] = await shares(page, 'dither', [PINK]);
  assert.ok(blank > 0.95, `blank paper as it comes on (${blank.toFixed(3)})`);
  await photoAt(page, 'dither', 0.78);
  await caughtUp(page);
  const [paper, blue] = await shares(page, 'dither', [PINK, BLUE], { rows: 150 });
  assert.ok(paper > 0.1 && paper < 0.9, `partway formed: ${paper.toFixed(3)} still paper`);
  assert.ok(blue > 0.05, `in the photo's own colours: ${blue.toFixed(3)} its blue`);
  await photoAt(page, 'dither', 0.1);
  await caughtUp(page);
  assert.equal(await dithering(page), false, 'the photo itself');
  assert.doesNotMatch(await page.evaluate(() => document.getElementById('dither').getAttribute('style')), /--dc-reveal-(white|black|x|y)/);
  const [circle] = await shares(page, 'dither', [CIRCLE], { box: [0.68, 0.33, 0.04, 0.04] });
  assert.ok(circle > 0.95, 'its red circle as it is');
  await photoAt(page, 'dither', 1.05);
  await caughtUp(page);
  assert.equal(await dithering(page), false, 'never back to paper');
  await context.close();
});

test('a tap dissolves a circle of a dithered photo into its pixels for a moment, and it forms again', async () => {
  const { context, page } = await open('reveal', { hasTouch: true });
  await page.waitForFunction(() => window.dcMotion?.instances().length === 4);
  await page.locator('#dither').scrollIntoViewIfNeeded();
  await started(page, 'dither');
  const el = await page.locator('#dither').boundingBox();
  await page.touchscreen.tap(el.x + el.width * 0.7, el.y + el.height * 0.35);
  await page.waitForTimeout(300);
  const [under] = await shares(page, 'dither', [PINK], { box: [0.66, 0.31, 0.08, 0.08] });
  const [away] = await shares(page, 'dither', [PINK], { box: [0.05, 0.8, 0.1, 0.1] });
  assert.ok(under > 0.2, `dissolved under the finger: ${under.toFixed(3)} paper`);
  assert.ok(away < 0.02, `the rest as it is: ${away.toFixed(3)} paper`);
  await page.waitForTimeout(2000);
  assert.equal(await dithering(page), false, 'formed again');
  await context.close();
});

test('on a laptop the cursor stirs a dithered photo\'s pixels where it moves, and they form again once it rests', async () => {
  const { context, page } = await open('reveal');
  await page.waitForFunction(() => window.dcMotion?.instances().length === 4);
  await page.locator('#dither').scrollIntoViewIfNeeded();
  await started(page, 'dither');
  const el = await page.locator('#dither').boundingBox();
  await page.mouse.move(el.x + el.width * 0.3, el.y + el.height * 0.35);
  await page.mouse.move(el.x + el.width * 0.7, el.y + el.height * 0.35, { steps: 12 });
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.getElementById('dither').classList.contains('is-lens')), true, 'stirred');
  await page.waitForTimeout(2000);
  assert.equal(await dithering(page), false, 'formed again at rest, the cursor still over it');
  await context.close();
});

// Sections that stack (stack.js and stack.css), from fixtures/motion/stack.html: four cards, below
// 700px of page, the second (#tall) taller than the screen, the first and the last with a link.

const cards = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.dc-stack-card')].map((card) => {
  const box = card.getBoundingClientRect();
  const style = getComputedStyle(card);
  return [card.id, { top: Math.round(box.top), bottom: Math.round(box.bottom), scale: Number(new DOMMatrix(style.transform).a.toFixed(3)), position: style.position }];
})));
/** Scrolls so that card `i`, wherever it pins, would have its top at `y` on the screen with nothing pinned. */
const cardFlowAt = (page, i, y) => page.evaluate(([i, y]) => {
  const stack = document.getElementById('stack');
  const gap = parseFloat(getComputedStyle(stack).rowGap) || 0;
  const all = [...stack.children];
  let top = stack.getBoundingClientRect().top + scrollY;
  for (const card of all.slice(0, i)) top += card.offsetHeight + gap;
  scrollTo(0, top - y);
}, [i, y]);
const stacked = (page) => page.waitForTimeout(300);

test('on a laptop the cards pin one after another, a peek lower each, and the ones beneath shrink', async () => {
  const { context, page } = await open('stack');
  await cardFlowAt(page, 0, 300);
  await started(page, 'stack');
  await cardFlowAt(page, 2, 20); // the third card just pinned, a peek or two below its top
  await stacked(page);
  const { one, tall, three, four } = await cards(page);
  assert.equal(one.position, 'sticky');
  assert.equal(one.top, 0);
  assert.equal(three.top, 24, 'two peeks lower');
  assert.ok(four.top > three.top + 300, 'the last still to come');
  assert.equal(one.scale, 0.9, 'two cards over it');
  assert.equal(tall.scale, 0.95, 'one card over it');
  assert.equal(three.scale, 1);
  await context.close();
});

test('a card taller than the screen pins by its foot, so its last line is on the screen before the next covers it', async () => {
  const { context, page } = await open('stack');
  await cardFlowAt(page, 0, 300);
  await started(page, 'stack');
  await cardFlowAt(page, 2, 790); // the third card just coming onto the screen
  await stacked(page);
  const { tall, three } = await cards(page);
  assert.ok(tall.top < 0, 'pinned above the screen');
  assert.equal(tall.bottom, 788, 'by its foot, a peek above the screen\'s');
  const line = await page.evaluate(() => document.getElementById('tall-last').getBoundingClientRect());
  assert.ok(line.top >= 0 && line.bottom <= three.top, 'its last line on the screen, uncovered');
  await context.close();
});

test('tabbing back into a covered card scrolls to where it is uncovered', async () => {
  const { context, page } = await open('stack');
  await cardFlowAt(page, 0, 300);
  await started(page, 'stack');
  await page.focus('#link-four');
  await cardFlowAt(page, 3, -50); // every card stacked, the last pinned
  await stacked(page);
  await page.keyboard.press('Shift+Tab');
  await stacked(page);
  const seen = await page.evaluate(() => {
    const link = document.getElementById('link-one');
    const box = link.getBoundingClientRect();
    return document.activeElement === link && box.top >= 0 && box.bottom <= innerHeight && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === link;
  });
  assert.ok(seen, 'the focused link is on the screen and on top');
  await context.close();
});

test('without scripts, or under reduced motion, the cards are one after another, none covering another', async () => {
  for (const options of [{ javaScriptEnabled: false }, { reducedMotion: 'reduce' }]) {
    const { context, page } = await open('stack', options);
    await page.waitForTimeout(1200);
    for (const i of [1, 2, 3]) {
      await cardFlowAt(page, i, 100);
      await page.waitForTimeout(200);
      const all = Object.values(await cards(page));
      assert.ok(all.every((card) => card.position === 'static' && card.scale === 1), JSON.stringify(options));
      all.slice(1).forEach((card, k) => assert.ok(card.top >= all[k].bottom, `card ${k + 2} below card ${k + 1}, ${JSON.stringify(options)}`));
    }
    await context.close();
  }
});

test('the pause control leaves the stack be: it moves only as the visitor scrolls', async () => {
  const { context, page } = await open('stack');
  await cardFlowAt(page, 0, 300);
  await started(page, 'stack');
  await page.evaluate(() => window.dcMotion.pause());
  await cardFlowAt(page, 2, 20);
  await stacked(page);
  assert.equal((await cards(page)).one.scale, 0.9);
  await context.close();
});

test('the stack shifts nothing when its script starts, even on the first screen', async () => {
  const { context, page } = await open('stack', {}, (context) => context.addInitScript(() => {
    window.shifts = 0;
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.shifts += entry.value; }).observe({ type: 'layout-shift', buffered: true });
  }));
  await page.evaluate(() => scrollTo(0, 900)); // into the stack, before the script starts
  await started(page, 'stack');
  await stacked(page);
  assert.equal(await page.evaluate(() => window.shifts), 0);
  await context.close();
});

test('dc-qa passes the stack, measuring each card\'s text where it is seen', async () => {
  const result = await checkMotion(browser, fixture('stack'));
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.effects.map((e) => e.loops), [false]);
  assert.ok(result.contrast.some((c) => c.text.startsWith('Fanlight')), 'the last card measured');
});


// Count-ups and a spotlight (count.js, spotlight.js), from fixtures/motion/numbers.html: a figure
// on the first screen (#opening), then a screen down a dark section (#spot) lit by the spotlight,
// with two cards (#card first) whose prices count up (#price first), and a button (#button).

const numbers = (page) => page.waitForFunction(() => window.dcMotion?.instances().length === 4, null, { timeout: 10000 });
const lit = (page) => page.evaluate(() => document.getElementById('spot').style.getPropertyValue('--dc-spotlight-on'));

test('a number counts up from zero when half of it is on the screen, in its own width, then is as written', async () => {
  const { context, page } = await open('numbers');
  await numbers(page);
  const width = await page.evaluate(() => document.getElementById('price').offsetWidth);
  await toward(page, 'price');
  await page.waitForFunction(() => document.querySelector('#price [aria-hidden="true"]'), null, { timeout: 5000 });
  const seen = [];
  for (let i = 0; i < 6; i++) {
    const now = await page.evaluate(() => ({
      shown: document.querySelector('#price [aria-hidden="true"]')?.textContent,
      read: [...document.querySelectorAll('#price span')].find((el) => !el.closest('[aria-hidden="true"]'))?.textContent,
      width: document.getElementById('price').offsetWidth,
    }));
    if (now.shown === undefined) break;
    seen.push(Number(now.shown.replace(/[$,]/g, '')));
    assert.equal(now.read, '$1,500', 'screen readers have the number throughout');
    assert.equal(now.width, width, 'in its own width');
    await page.waitForTimeout(150);
  }
  assert.ok(seen[0] < 1500 && seen.every((n, i) => i === 0 || n >= seen[i - 1]), `it counts up: ${seen}`);
  await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(() => document.getElementById('price').innerHTML), '$1,500');
  await context.close();
});

test('a number on the screen when the page opens, or any while motion is paused, is as written', async () => {
  const { context, page } = await open('numbers');
  await numbers(page);
  await page.evaluate(() => window.dcMotion.pause());
  await toward(page, 'price');
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.getElementById('opening').innerHTML), '98%');
  assert.equal(await page.locator('#price [aria-hidden="true"]').count(), 0);
  await context.close();
});

test('on a phone a tap beside the section\'s button lights the spotlight for a moment', async () => {
  const { context, page } = await open('numbers', { hasTouch: true });
  await numbers(page);
  await toward(page, 'button');
  await started(page, 'spot');
  const box = await page.locator('#card').boundingBox();
  await page.touchscreen.tap(box.x + 40, box.y + 40);
  await page.waitForTimeout(250);
  assert.ok(Number(await lit(page)) > 0.5, 'lit where the finger landed');
  await page.waitForTimeout(2500);
  assert.equal(await lit(page), '', 'out again');
  await context.close();
});

test('the spotlight follows a mouse across the section and goes out when it leaves, or while motion is paused', async () => {
  const { context, page } = await open('numbers');
  await numbers(page);
  await toward(page, 'spot');
  await started(page, 'spot');
  const box = await page.locator('#card').boundingBox();
  await page.mouse.move(box.x + 60, box.y + 50, { steps: 4 });
  await page.waitForTimeout(600);
  assert.ok(Number(await lit(page)) > 0.95, 'lit');
  const at = await page.evaluate(() => {
    const spot = document.getElementById('spot');
    const area = spot.getBoundingClientRect();
    const card = document.getElementById('card').getBoundingClientRect();
    return { x: parseFloat(spot.style.getPropertyValue('--dc-spotlight-x')) - (card.left - area.left), left: document.getElementById('card').style.getPropertyValue('--dc-spotlight-left') };
  });
  assert.ok(Math.abs(at.x - 60) < 2 && at.left, `on the card where the cursor is (${at.x.toFixed(1)}px in)`);
  await page.evaluate(() => window.dcMotion.pause());
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 2 });
  await page.waitForTimeout(1500);
  assert.equal(await lit(page), '', 'out while paused');
  await context.close();
});

test('under reduced motion nothing counts or lights', async () => {
  const { context, page } = await open('numbers', { reducedMotion: 'reduce' });
  await page.waitForTimeout(1200);
  await toward(page, 'card');
  const box = await page.locator('#card').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40, { steps: 4 });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#price [aria-hidden="true"]').count(), 0);
  assert.equal(await lit(page), '');
  await context.close();
});

test('dc-qa passes the count-ups and the spotlight, measuring the text with the light behind it', async () => {
  const result = await checkMotion(browser, fixture('numbers'));
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.effects.map((e) => e.loops), [false, false, false, false]);
  assert.ok(result.contrast.some((c) => c.text === 'Presence'), 'a card measured');
});
