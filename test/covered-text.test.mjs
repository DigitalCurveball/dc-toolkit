import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { findCoveredText } from '../src/covered-text.mjs';

// Each page is a tiny layout of the kind a concept uses, with and without the defect. The
// check runs in a real browser because it is hit testing that decides what is on top.

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(() => browser.close());

const PIXEL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';
const BASE = '<style>body { margin: 0; font: 20px/1.5 sans-serif; } .grid { display: grid; grid-template-columns: repeat(12, 1fr); width: 1200px; }</style>';

async function covered(body, { width = 1280, height = 900 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<!doctype html>${BASE}<body>${body}</body>`);
  const result = await page.evaluate(findCoveredText);
  await page.close();
  return result;
}

// The defect it was written for: copy in grid columns 1 to 5, a photo box from column 5, and
// the box positioned (for its absolutely placed image), so it paints over the copy.
const hero = (copyColumns) => `<section class="grid">
  <div class="photo" style="grid-column: 5 / -1; grid-row: 1; position: relative; min-height: 300px;">
    <img src="${PIXEL}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; background: #223;">
  </div>
  <p class="sub" style="grid-column: ${copyColumns}; grid-row: 1; align-self: center;">A sentence long enough to run on under the photo beside it, at this width and in this column.</p>
</section>`;

test('text under a positioned photo is covered, and named with what covers it', async () => {
  const found = await covered(hero('1 / 6'));
  assert.equal(found.length, 1);
  assert.equal(found[0].element, 'p.sub');
  assert.match(found[0].by, /^img in div\.photo/);
  assert.match(found[0].text, /^A sentence long enough/);
});

test('the same copy kept clear of the photo passes', async () => {
  assert.deepEqual(await covered(hero('1 / 5')), []);
});

test('a positioned slab with a background over text is covered; a transparent one is not', async () => {
  const page = (background) => `<section class="grid">
    <p style="grid-column: 1 / 8; grid-row: 1;">A line of text that the slab beside it may or may not cover.</p>
    <div style="grid-column: 4 / -1; grid-row: 1; position: relative; background: ${background}; height: 60px;"></div>
  </section>`;
  assert.equal((await covered(page('#c60'))).length, 1);
  assert.deepEqual(await covered(page('transparent')), []);
});

test('a later block pulled up over text by a negative margin paints beneath it', async () => {
  // Not positioned, so its background is painted before any text: the words stay on top.
  assert.deepEqual(
    await covered('<p style="margin: 0;">Text above a block pulled up beneath it.</p><div style="background: #223; height: 80px; margin-top: -20px;"></div>'),
    []
  );
});

test('a stretched link over a card is not covering it', async () => {
  assert.deepEqual(
    await covered(`<style>.card { position: relative; width: 400px; } .card a::after { content: ''; position: absolute; inset: 0; }</style>
      <div class="card"><h3><a href="/x/">A card</a></h3><p>Its description, under the link that covers it.</p></div>`),
    []
  );
});

test('visually hidden text, clipped wordmarks and off-screen links are left alone', async () => {
  assert.deepEqual(
    await covered(`<h1><span style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;">Hidden name: </span>A headline.</h1>
      <div style="width: 200px; overflow: hidden; white-space: nowrap; font-size: 80px;">WORDMARKWORDMARK</div>
      <a href="#main" style="position: absolute; left: -999px;">Skip to the page</a>`),
    []
  );
});

test('the answer inside a closed <details> is not on screen, so not checked', async () => {
  assert.deepEqual(
    await covered(`<details style="width: 400px;"><summary>A question</summary><p>Its answer, out of sight until opened.</p></details>
      <div style="position: relative; background: #223; height: 200px;"></div>`),
    []
  );
});

test('text further down the page is checked too, and a sticky header does not count', async () => {
  const body = `<header style="position: sticky; top: 0; height: 80px; background: #eee; z-index: 2;">Menu</header>
    <div style="height: 2000px;"></div>
    ${hero('1 / 6')}
    <div style="height: 2000px;"></div>
    <p>The last words on the page.</p>`;
  const found = await covered(body);
  assert.deepEqual(found.map((f) => f.element), ['p.sub']);
});
