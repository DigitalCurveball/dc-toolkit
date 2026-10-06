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

import { dirname, basename } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../src/serve.mjs';

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
if (!conceptFile) {
  console.error('Need --concept <file>, such as public/concepts/concept-a.html');
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

const conceptServer = await serve(dirname(conceptFile));
const builtServer = await serve(dir);
const pages = {
  concept: `${conceptServer.origin}/${basename(conceptFile)}`,
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

const round = (n) => Math.round(n);
const lines = [`## Port against concept\n\nConcept: ${conceptFile}\nBuild: ${dir} ${path}\n`];
let listedOnlyOnce = false;
let differences = 0;

for (const width of widths) {
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
}

await browser.close();
conceptServer.close();
builtServer.close();
lines.push('', differences ? `${differences} difference(s) to check against the concept, at the widths above.` : 'The build matches the concept at every width.');
console.log(lines.join('\n'));
