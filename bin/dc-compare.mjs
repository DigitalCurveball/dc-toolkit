#!/usr/bin/env node
// The side-by-side pass of a port (/port-concept, step 7), measured: the built page against
// the approved concept, box by box, at each width.
//
//   pnpm build && pnpm exec dc-compare --concept public/concepts/<file>.html
//   --dir dist/client          the build (the default)
//   --path /                   the built page to compare (the default)
//   --widths 320,400,…         the default is 320, 400, 640, 768, 1024, 1280, 1440;
//                              add the concept's own breakpoints
//   --tolerance 1              pixels of difference ignored (the default: sub-pixel rounding)
//   --shots <dir>              also photograph both pages, band by band, compare the pictures
//                              pixel by pixel, and write a report to <dir>/index.html; without
//                              --concept, photograph a page no concept drew, alone
//
// Every class the two pages share is compared, element by element in document order. Nothing
// needs listing because a port keeps the concept's class names: its CSS is lifted as it stands.
// A box's x, width and height are compared as they are, and its y from the top of its section
// (the closest section, header, footer, aside or nav), so a change above it does not flag
// everything below; a section's own y is not compared. Classes found in only one page are
// listed once, which is how a missing part shows.
//
// It reports and never fails (exit 0): a change made to the concept on purpose shows here for
// good, so the report is read, not gated on.
//
// With --shots, each band of the page (the banner, header, each section, the footer) is also
// photographed in both and compared pixel by pixel (src/shots.mjs), which catches what moves no
// box: a colour, a border, a weight, a crop. The pictures go into <dir>/<page>/ and the report,
// <dir>/index.html, covers every page compared into that folder (src/report.mjs). Below 1024px
// they are taken at twice the pixels, so they are sharp on a phone's screen. A page the set never
// drew (one of several made from a designed pattern) has no concept: with --shots and no
// --concept, it is photographed alone, so it is in the report to be looked at all the same.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { chromium } from 'playwright';
import { writeReport } from '../src/report.mjs';
import { serve } from '../src/serve.mjs';
import { alignBands, compareBand, encode, findBands } from '../src/shots.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const conceptFile = arg('concept');
const dir = arg('dir', 'dist/client');
const path = arg('path', '/');
const widths = arg('widths', '320,400,640,768,1024,1280,1440').split(',').map(Number);
const tolerance = Number(arg('tolerance', '1'));
const shotsDir = arg('shots');
if (!conceptFile && !shotsDir) {
  console.error('Need --concept <file>, such as public/concepts/concept-a.html, or --shots <dir> to photograph a page no concept drew');
  process.exit(2);
}

/** Runs in the page: every classed element's box, grouped by class, in document order. */
function measure() {
  const SECTION = 'section, header, footer, aside, nav';
  const label = (e) => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + [...e.classList].map((c) => `.${c}`).join('');
  const boxes = {};
  let id = 0;
  for (const el of document.body.querySelectorAll('[class]')) {
    const r = el.getBoundingClientRect();
    const section = el.parentElement?.closest(SECTION);
    const top = section ? section.getBoundingClientRect().top : -window.scrollY;
    const box = {
      id: id++,
      label: label(el),
      // Hidden: not rendered, or clipped to a pixel as visually hidden text is.
      shown: el.checkVisibility({ visibilityProperty: true }) && r.width * r.height > 1,
      x: r.left,
      y: el.matches(SECTION) ? null : r.top - top,
      w: r.width,
      h: r.height,
      in: section ? label(section) : '',
    };
    for (const name of el.classList) (boxes[name] ??= []).push(box);
  }
  return { boxes, scrollWidth: document.documentElement.scrollWidth };
}

const conceptServer = conceptFile ? await serve(dirname(conceptFile)) : null;
const builtServer = await serve(dir);
const pages = {
  concept: conceptServer && `${conceptServer.origin}/${basename(conceptFile)}`,
  built: new URL(path, builtServer.origin).href,
};
const browser = await chromium.launch();

async function measureAt(url, width) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(measure);
  await page.close();
  return result;
}

/**
 * The page at `width`, photographed band by band once every photo has loaded, lazy ones too, so
 * none is blank in its picture.
 */
async function photographAt(url, width) {
  const scale = width < 1024 ? 2 : 1;
  const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    for (const img of document.images) img.loading = 'eager';
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    await document.fonts.ready;
  });
  const found = await page.evaluate(findBands);
  const margin = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).marginTop) || 0);
  for (const band of found.bands) {
    // Chrome puts each line of text on a whole pixel, counted from wherever it falls, so a band
    // that starts a fraction of a pixel lower in one page than the other paints identical lines a
    // pixel apart, one line in two. Moving the whole page down by less than a pixel, until the
    // band's top is on a whole CSS pixel, makes the same content paint the same in both pages. A
    // whole device pixel is not enough at 2x: the glyphs' edges still differed.
    const top = Math.ceil(band.top - 0.001);
    await page.evaluate((px) => { document.documentElement.style.marginTop = `${px}px`; }, margin + top - band.top);
    band.height = Math.round(band.height * scale) / scale;
    // fullPage, so the clip is in page coordinates and nothing scrolls under a sticky header.
    band.png = await page.screenshot({
      fullPage: true, clip: { x: 0, y: top, width, height: band.height }, animations: 'disabled', caret: 'hide',
    });
  }
  await context.close();
  return { ...found, scale };
}

const slug = path === '/' ? 'home' : path.replace(/^\/+|\/+$/g, '').replaceAll('/', '-');
const shotsFor = {};
let meta = {};

async function pictures(width) {
  const concept = pages.concept && await photographAt(pages.concept, width);
  const built = await photographAt(pages.built, width);
  meta = { title: built.title, siteName: built.siteName };
  const pairs = concept ? alignBands(concept.bands, built.bands) : built.bands.map((build) => ({ build }));
  const seen = {};
  const out = [];
  for (const [i, pair] of pairs.entries()) {
    const keyed = `${pair.concept?.weak ?? ''}|${pair.build?.weak ?? ''}`;
    seen[keyed] = (seen[keyed] ?? 0) + 1;
    const band = { key: `${keyed}#${seen[keyed]}`, label: (pair.build ?? pair.concept).label };
    const save = async (name, image, h) => {
      const { data, ext } = await encode(image);
      const file = `${slug}/${width}-${String(i + 1).padStart(2, '0')}-${name}.${ext}`;
      await writeFile(join(shotsDir, file), data);
      return { file, w: width, h: Math.round(h) };
    };
    if (pair.concept && pair.build) {
      const photos = [...pair.concept.photos, ...pair.build.photos];
      const result = await compareBand(pair.concept.png, pair.build.png, photos, built.scale);
      Object.assign(band, { different: result.different, compared: result.compared });
      band.status = result.different ? 'differs' : 'match';
      band.build = await save('build', pair.build.png, pair.build.height);
      if (result.different) {
        band.concept = await save('concept', pair.concept.png, pair.concept.height);
        band.diff = await save('diff', result.diff, Math.max(pair.concept.height, pair.build.height));
      }
    } else if (pair.build) {
      band.status = concept ? 'new' : 'alone';
      band.build = await save('build', pair.build.png, pair.build.height);
    } else {
      band.status = 'gone';
      band.concept = await save('concept', pair.concept.png, pair.concept.height);
    }
    out.push(band);
  }
  shotsFor[width] = out;
  if (!concept) return `${width}px: ${out.length} bands photographed`;
  const differ = out.filter((band) => band.status !== 'match');
  return differ.length
    ? `  Pictures: ${differ.length} of ${out.length} bands differ: ${differ.map((band) => `${band.label} (${band.status === 'differs' ? `${((band.different / band.compared) * 100).toFixed(2)}%` : band.status})`).join(', ')}`
    : `  Pictures: all ${out.length} bands match`;
}

// A page compared again keeps its place in the report, which is the order pages were first run.
let firstRan = new Date().toISOString();
if (shotsDir) {
  try {
    firstRan = JSON.parse(await readFile(join(shotsDir, slug, 'data.json'), 'utf8')).ran;
  } catch {
    // Not compared into this folder before.
  }
  await rm(join(shotsDir, slug), { recursive: true, force: true });
  await mkdir(join(shotsDir, slug), { recursive: true });
}

const round = (n) => Math.round(n);
const lines = [`## Port against concept\n\nConcept: ${conceptFile ?? 'none, so the build is photographed alone'}\nBuild: ${dir} ${path}\n`];
const boxesFor = {};
let listedOnlyOnce = false;
let differences = 0;

for (const width of widths) {
  if (!conceptFile) {
    lines.push(await pictures(width));
    continue;
  }
  const [concept, built] = [await measureAt(pages.concept, width), await measureAt(pages.built, width)];
  const shared = Object.keys(concept.boxes).filter((name) => built.boxes[name]);

  if (!listedOnlyOnce) {
    listedOnlyOnce = true;
    const only = (a, b) => Object.keys(a.boxes).filter((name) => !b.boxes[name]).map((n) => `.${n}`);
    const conceptOnly = only(concept, built);
    const builtOnly = only(built, concept);
    if (conceptOnly.length) lines.push(`Only in the concept: ${conceptOnly.join(', ')}`);
    if (builtOnly.length) lines.push(`Only in the build: ${builtOnly.join(', ')}`);
    const counts = shared
      .filter((name) => concept.boxes[name].length !== built.boxes[name].length)
      .map((name) => `.${name} ${concept.boxes[name].length} → ${built.boxes[name].length}`);
    if (counts.length) lines.push(`Different counts: ${counts.join(', ')}`);
    lines.push('');
  }

  // An element with several classes is paired under each of them; it is compared once.
  const found = [];
  const paired = new Set();
  for (const name of shared) {
    const [a, b] = [concept.boxes[name], built.boxes[name]];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const pair = `${a[i].id}:${b[i].id}`;
      if (paired.has(pair)) continue;
      paired.add(pair);
      let changes;
      if (a[i].shown !== b[i].shown) {
        changes = [a[i].shown ? 'shown → hidden' : 'hidden → shown'];
      } else if (!a[i].shown) {
        changes = [];
      } else {
        changes = ['x', 'y', 'w', 'h']
          .filter((k) => a[i][k] !== null && b[i][k] !== null && Math.abs(a[i][k] - b[i][k]) > tolerance)
          .map((k) => `${k} ${round(a[i][k])} → ${round(b[i][k])}`);
      }
      if (changes.length) {
        const which = a.length > 1 ? ` (.${name} ${i + 1} of ${a.length})` : '';
        found.push(`  ${b[i].label}${which}${b[i].in ? ` in ${b[i].in}` : ''}: ${changes.join(', ')}`);
      }
    }
  }
  const compared = paired.size;
  differences += found.length;
  const scroll = concept.scrollWidth === built.scrollWidth ? '' : `, page width ${concept.scrollWidth} → ${built.scrollWidth}`;
  lines.push(found.length
    ? `**${width}px**: ${found.length} of ${compared} boxes differ${scroll}\n${found.join('\n')}`
    : `${width}px: all ${compared} boxes match${scroll}`);
  boxesFor[width] = found.map((line) => line.trim());
  if (shotsDir) lines.push(await pictures(width));
}

await browser.close();
conceptServer?.close();
builtServer.close();
if (conceptFile) lines.push('', differences ? `${differences} difference(s) to check against the concept, at the widths above.` : 'The build matches the concept at every width.');
if (shotsDir) {
  const data = { slug, path, concept: conceptFile, ...meta, ran: firstRan, widths, shots: shotsFor, boxes: boxesFor };
  await writeFile(join(shotsDir, slug, 'data.json'), `${JSON.stringify(data, null, 2)}\n`);
  lines.push(`Pictures and the report: ${await writeReport(shotsDir)}`);
}
console.log(lines.join('\n'));
