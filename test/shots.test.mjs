import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { alignBands, compareBand, findBands } from '../src/shots.mjs';

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(() => browser.close());

const band = (weak, label = '') => ({ strong: `${weak}|${label}`, weak, tag: weak.split('.')[0], label });
const names = (pairs) => pairs.map((p) => `${p.concept?.label ?? '-'}:${p.build?.label ?? '-'}`);

test('bands pair in page order, and an added or missing one stays at its place', () => {
  const concept = [band('aside', 'banner'), band('header.site'), band('section.sec', 'services'), band('section.sec', 'team'), band('footer')];
  assert.deepEqual(names(alignBands(concept, concept)), ['banner:banner', ':', 'services:services', 'team:team', ':']);

  const added = [...concept.slice(0, 3), band('section.sec', 'classes'), ...concept.slice(3)];
  assert.deepEqual(names(alignBands(concept, added)), ['banner:banner', ':', 'services:services', '-:classes', 'team:team', ':']);

  const missing = concept.filter((b) => b.label !== 'services');
  assert.deepEqual(names(alignBands(concept, missing)), ['banner:banner', ':', 'services:-', 'team:team', ':']);
});

test('a band whose classes changed still pairs with its counterpart, by tag', () => {
  const concept = [band('header.site'), band('section.sec', 'about'), band('footer')];
  const built = [band('header.site'), band('section.band.sec', 'about-us'), band('footer')];
  assert.deepEqual(names(alignBands(concept, built)), [':', 'about:about-us', ':']);
});

// A 200 by `height` PNG of white with a block in `colour` at (20, 20), 40 square.
const png = (height = 100, colour = '#1f3b4a') => sharp({ create: { width: 200, height, channels: 4, background: '#ffffff' } })
  .composite([{ input: { create: { width: 40, height: 40, channels: 4, background: colour } }, left: 20, top: 20 }])
  .png().toBuffer();

test('identical bands match; a changed colour is counted', async () => {
  assert.equal((await compareBand(await png(), await png())).different, 0);
  const changed = await compareBand(await png(), await png(100, '#e9c46a'));
  assert.equal(changed.different, 40 * 40);
  assert.equal(changed.compared, 200 * 100);
});

test('a change inside a photo is left out, at the scale the pictures were taken', async () => {
  const photo = { x: 10, y: 10, w: 30, h: 30 }; // CSS pixels; the pictures are at 2x
  const result = await compareBand(await png(), await png(100, '#e9c46a'), [photo], 2);
  assert.equal(result.different, 0);
  assert.equal(result.compared, 200 * 100 - 60 * 60);
});

test('a band taller in one page counts the rows the other lacks', async () => {
  const result = await compareBand(await png(100), await png(110));
  assert.equal(result.different, 200 * 10);
  assert.equal(result.diff.height, 110);
});

const PIXEL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E';

test('bands tile the page, are named, and carry their photos', async () => {
  const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
  // Headings without margins, which would collapse through the fixed-height blocks and move them.
  await page.setContent(`<!doctype html><style>h2 { margin: 0; }</style><body style="margin: 0;">
    <a href="#main" style="position: absolute; left: -999px;">Skip to content</a>
    <aside aria-label="About this demo" style="height: 40.5px;"></aside>
    <header style="height: 80px;"><a href="/">Name</a></header>
    <main id="main">
      <section aria-label="Services" style="height: 190.3px; padding-top: 10px; margin-bottom: 20px;">
        <img alt="" src="${PIXEL}" style="display: block; margin-left: 30px; width: 100px; height: 60px;"></section>
      <section class="band" style="height: 100px;"><h2>Our team</h2></section>
    </main>
    <footer style="height: 120px;"><h2>Hours</h2></footer>
    <div style="height: 300px;" hidden></div>
  </body>`);
  const { bands } = await page.evaluate(findBands);
  await page.close();
  assert.deepEqual(bands.map((b) => b.label), ['About this demo', 'Header', 'Services', 'Our team', 'Footer']);
  assert.equal(bands[0].top, 0);
  for (let i = 1; i < bands.length; i++) assert.ok(Math.abs(bands[i].top - (bands[i - 1].top + bands[i - 1].height)) < 0.01);
  // The space under the first section belongs to it; the last band ends with the footer.
  assert.ok(Math.abs(bands[2].height - 220.3) < 0.02);
  assert.ok(Math.abs(bands.at(-1).top + bands.at(-1).height - (40.5 + 80 + 220.3 + 100 + 120)) < 0.02);
  assert.deepEqual(bands[2].photos, [{ x: 30, y: 10, w: 100, h: 60 }]);
  assert.equal(bands[3].strong, 'section.band|');
});

test('dc-compare --shots: a band below a taller one still matches, a recoloured one is found, a page no concept drew is photographed whole, and the review pictures only those', async () => {
  // The concept's first section is 100.4px tall and the build's 112.7px, so everything below sits
  // a different fraction of a pixel down. Without putting each band on a whole pixel first, the
  // lines of the identical section below would differ one in two.
  const dir = await mkdtemp(join(tmpdir(), 'dc-shots-'));
  const page = (first, colour) => `<!doctype html><html><head><meta property="og:site_name" content="Test site"><title>Test</title></head>
    <body style="margin: 0; font: 17px/1.45 sans-serif;">
    <main>
      <section aria-label="First" style="height: ${first}px; background: #eef;"></section>
      <section aria-labelledby="h-b" style="padding: 10.3px 20px;"><h2 id="h-b">Second</h2>
        <p style="margin: 0 0 5.6px;">A line of text.</p><p style="margin: 0 0 5.6px;">Another line.</p><p>And a third.</p></section>
      <section aria-labelledby="h-c" style="padding: 20px; background: ${colour};"><h2 id="h-c">Third</h2></section>
    </main></body></html>`;
  await mkdir(join(dir, 'concept'));
  await mkdir(join(dir, 'build'));
  await writeFile(join(dir, 'concept', 'index.html'), page(100.4, '#1f3b4a'));
  await writeFile(join(dir, 'build', 'index.html'), page(112.7, '#3e6276'));
  await promisify(execFile)(process.execPath, [
    'bin/dc-compare.mjs', '--concept', join(dir, 'concept', 'index.html'), '--dir', join(dir, 'build'),
    '--widths', '400,1280', '--shots', join(dir, 'shots'),
  ]);
  const data = JSON.parse(await readFile(join(dir, 'shots', 'home', 'data.json'), 'utf8'));
  for (const width of [400, 1280]) {
    assert.deepEqual(data.shots[width].map((b) => `${b.label} ${b.status}`), ['First differs', 'Second match', 'Third differs']);
  }

  // A page no concept drew, into the same folder: photographed alone, and in the same report.
  await mkdir(join(dir, 'build', 'other'));
  await writeFile(join(dir, 'build', 'other', 'index.html'), page(80, '#e9c46a'));
  await promisify(execFile)(process.execPath, [
    'bin/dc-compare.mjs', '--dir', join(dir, 'build'), '--path', '/other/', '--widths', '400', '--shots', join(dir, 'shots'),
  ]);
  const other = JSON.parse(await readFile(join(dir, 'shots', 'other', 'data.json'), 'utf8'));
  assert.equal(other.concept, undefined);
  assert.deepEqual(other.shots[400].map((b) => `${b.label} ${b.status}`), ['The whole page alone']);
  assert.equal(other.shots[400][0].build.file, 'other/400-page.webp');

  // A page that does not exist is refused, not photographed as "not found".
  await assert.rejects(promisify(execFile)(process.execPath, [
    'bin/dc-compare.mjs', '--dir', join(dir, 'build'), '--path', '/missing/', '--widths', '400', '--shots', join(dir, 'shots'),
  ]), /answers 404: check the path/);

  const report = await readFile(join(dir, 'shots', 'index.html'), 'utf8');
  assert.match(report, /<title>Test site port check<\/title>/);
  assert.match(report, /id="home-400-1"/);
  assert.match(report, /id="other-400-0"/);
  assert.match(report, /No concept drew this page/);
  assert.ok(report.indexOf('id="home"') < report.indexOf('id="other"'));

  // The review pictures what differs and the page no concept drew, and leaves out what matches.
  const review = await readFile(join(dir, 'shots', 'review.html'), 'utf8');
  assert.match(review, /id="home-400-0"/);
  assert.match(review, /id="home-1280-2"/);
  assert.doesNotMatch(review, /id="home-400-1"/);
  assert.doesNotMatch(review, /home\/400-02-build/);
  assert.match(review, /<td class="match">✓<\/td>/);
  assert.match(review, /src="other\/400-page\.webp"/);
  await rm(dir, { recursive: true });
});
