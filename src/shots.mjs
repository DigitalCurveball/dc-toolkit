// The pictures half of dc-compare (`--shots`): each band of the page photographed in the build
// and in its concept at each width, compared pixel by pixel, and written into a report that reads
// on a phone (src/report.mjs). dc-compare's boxes say where things sit; the pictures say how they
// look, which catches what moves no box: a colour, a border, a shadow, a weight, a crop.
//
// A band is a top-level block: a child of <body>, or of <main> (the banner, the header, each
// section, the footer). Bands tile the page, each running down to the next one's top, so the
// space between two sections belongs to the band above it and nothing goes uncompared. Comparing
// band by band, not the whole page, keeps a difference where it is: one line taller near the top
// would otherwise shift everything below it, and flag the lot.
//
// Photos are left out of the count. The concept loads a photo library's JPEGs and the build
// serves its own resized copies, so every photo differs a little everywhere. They stay in the
// pictures, for their crops to be looked at, and their boxes are in dc-compare's measurements.

import pixelmatch from 'pixelmatch';
import sharp from 'sharp';

/**
 * Runs in the page (`page.evaluate(findBands)`), so it is self-contained. The bands top to
 * bottom, each with the keys that pair it with the other page's, a label, and the photos in it.
 */
export function findBands() {
  const SKIP = 'script, style, noscript, template, link, meta';
  const blocks = [];
  const collect = (parent) => {
    for (const el of parent.children) {
      if (el.matches(SKIP)) continue;
      if (el.matches('main')) {
        collect(el);
        continue;
      }
      // Out of the flow, such as a skip link parked off-screen or a fixed bar: not a band.
      const { position } = getComputedStyle(el);
      if (position === 'absolute' || position === 'fixed') continue;
      if (!el.checkVisibility() || el.getBoundingClientRect().height < 1) continue;
      blocks.push(el);
    }
  };
  collect(document.body);

  const tag = (el) => el.tagName.toLowerCase();
  const classes = (el) => [...el.classList].sort().map((c) => `.${c}`).join('');
  const text = (el) => el?.textContent.trim().replace(/\s+/g, ' ').slice(0, 48) ?? '';
  const label = (el) => {
    // A header or footer is named for what it is: the footer's first heading is "Hours".
    if (tag(el) === 'header') return 'Header';
    if (tag(el) === 'footer') return 'Footer';
    const labelledBy = el.getAttribute('aria-labelledby');
    return el.getAttribute('aria-label') || (labelledBy && text(document.getElementById(labelledBy))) ||
      text(el.querySelector('h1, h2, h3')) || `${tag(el)}${classes(el)}`;
  };

  // Each band's top, never above the band before (a negative margin can pull a block up), so the
  // bands still tile the page; the first starts at the very top, and the last ends with its block.
  // Left unrounded: photographing a band moves the page to put its top on a whole pixel.
  const tops = [];
  for (const el of blocks) tops.push(Math.max(el.getBoundingClientRect().top + window.scrollY, tops.at(-1) ?? 0));
  if (tops.length) tops[0] = 0;
  const end = blocks.length ? blocks.at(-1).getBoundingClientRect().bottom + window.scrollY : 0;
  const bands = blocks.map((el, i) => {
    const top = tops[i];
    const bottom = tops[i + 1] ?? Math.max(end, top);
    return {
      strong: `${tag(el)}${classes(el)}|${el.getAttribute('aria-labelledby') || el.getAttribute('aria-label') || el.id}`,
      weak: `${tag(el)}${classes(el)}`,
      tag: tag(el),
      label: label(el),
      top,
      height: bottom - top,
      photos: [],
    };
  }).filter((band) => band.height >= 1);

  // Photos: images, video, frames and canvases, and anything with a photo as its CSS background.
  const photos = [...document.body.querySelectorAll('*')].filter((el) =>
    el.matches('img, video, iframe, canvas') || getComputedStyle(el).backgroundImage.includes('url('));
  for (const el of photos) {
    const r = el.getBoundingClientRect();
    if (!el.checkVisibility({ visibilityProperty: true }) || r.width < 1 || r.height < 1) continue;
    const top = r.top + window.scrollY;
    for (const band of bands) {
      const y0 = Math.max(top, band.top);
      const y1 = Math.min(top + r.height, band.top + band.height);
      if (y1 <= y0) continue;
      const x = Math.floor(r.left);
      const y = Math.floor(y0 - band.top);
      band.photos.push({ x, y, w: Math.ceil(r.right) - x, h: Math.ceil(y1 - band.top) - y });
    }
  }

  return {
    bands,
    title: document.title,
    siteName: document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ?? '',
  };
}

/**
 * Pairs the concept's bands with the build's, in page order: first by tag, classes and label,
 * then, in the stretches left between those pairs, by tag and classes, then by tag alone. What is
 * left is only in one page, and comes back as { concept } or { build } at its place.
 */
export function alignBands(a, b, keys = ['strong', 'weak', 'tag']) {
  if (!keys.length) return [...a.map((concept) => ({ concept })), ...b.map((build) => ({ build }))];
  const [key, ...weaker] = keys;
  // The longest run of pairs that keeps both pages' order, table first.
  const run = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      run[i][j] = a[i][key] === b[j][key] ? run[i + 1][j + 1] + 1 : Math.max(run[i + 1][j], run[i][j + 1]);
    }
  }
  const out = [];
  let gapA = [];
  let gapB = [];
  const flush = () => {
    out.push(...alignBands(gapA, gapB, weaker));
    gapA = [];
    gapB = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i][key] === b[j][key]) {
      flush();
      out.push({ concept: a[i++], build: b[j++] });
    } else if (run[i + 1][j] >= run[i][j + 1]) {
      gapA.push(a[i++]);
    } else {
      gapB.push(b[j++]);
    }
  }
  gapA.push(...a.slice(i));
  gapB.push(...b.slice(j));
  flush();
  return out;
}

const PADDING = [255, 0, 255, 255]; // where one band is shorter than the other: always different
const PHOTO_HIDDEN = [128, 128, 128, 255]; // a photo, the same in both before they are compared
const PHOTO_SHOWN = [190, 214, 235, 255]; // a photo, in the difference picture: pale blue

async function decode(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function padTo(image, width, height) {
  if (image.width === width && image.height === height) return image;
  const data = Buffer.alloc(width * height * 4);
  for (let p = 0; p < data.length; p += 4) data.set(PADDING, p);
  for (let y = 0; y < image.height; y++) {
    image.data.copy(data, y * width * 4, y * image.width * 4, (y + 1) * image.width * 4);
  }
  return { data, width, height };
}

/**
 * Compares two PNGs of a band, leaving out the photos (rects in CSS pixels, from both pages, at
 * `scale` device pixels each). Resolves to the different pixels, the pixels compared, and the
 * difference as raw RGBA: the build faded, differences red, photos pale blue.
 */
export async function compareBand(conceptPng, buildPng, photos = [], scale = 1) {
  const [a0, b0] = await Promise.all([decode(conceptPng), decode(buildPng)]);
  const width = Math.max(a0.width, b0.width);
  const height = Math.max(a0.height, b0.height);
  const [a, b] = [padTo(a0, width, height), padTo(b0, width, height)];

  const masked = new Uint8Array(width * height);
  for (const r of photos) {
    const x1 = Math.min(Math.round((r.x + r.w) * scale), width);
    const y1 = Math.min(Math.round((r.y + r.h) * scale), height);
    for (let y = Math.max(Math.round(r.y * scale), 0); y < y1; y++) {
      masked.fill(1, y * width + Math.max(Math.round(r.x * scale), 0), y * width + x1);
    }
  }
  let photoPixels = 0;
  for (let p = 0; p < masked.length; p++) {
    if (!masked[p]) continue;
    photoPixels++;
    a.data.set(PHOTO_HIDDEN, p * 4);
    b.data.set(PHOTO_HIDDEN, p * 4);
  }

  const diff = Buffer.alloc(width * height * 4);
  // Anti-aliased edges that moved by a fraction of a pixel are not counted, and drawn in grey.
  const different = pixelmatch(b.data, a.data, diff, width, height, {
    threshold: 0.1, alpha: 0.2, diffColor: [220, 30, 30], aaColor: [200, 200, 200],
  });
  for (let p = 0; p < masked.length; p++) if (masked[p]) diff.set(PHOTO_SHOWN, p * 4);
  return { different, compared: width * height - photoPixels, diff: { data: diff, width, height } };
}

/**
 * A picture for the report: WebP, or JPEG for one taller than WebP allows (16,383 pixels). Takes a
 * PNG, or raw RGBA as { data, width, height }.
 */
export async function encode(image) {
  const raw = !Buffer.isBuffer(image);
  const input = raw ? sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } }) : sharp(image);
  const height = raw ? image.height : (await input.metadata()).height;
  return height > 16383
    ? { data: await input.jpeg({ quality: 82, mozjpeg: true }).toBuffer(), ext: 'jpg' }
    : { data: await input.webp({ quality: 82 }).toBuffer(), ext: 'webp' };
}
