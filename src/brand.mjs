// The brand files a site makes from its own sources, once per brand and again after a change
// (bin/dc-brand-assets.mjs, bin/dc-favicon.mjs, bin/dc-outline-text.mjs): favicon.ico from
// favicon.svg, the link-preview card from a page of its own, a favicon's letter drawn as paths
// from the site's font, and a wordmark set in a font that may not be served, as paths.
import * as fontkit from 'fontkit';
import wawoff2 from 'wawoff2';

/**
 * An ICO holding a transparent PNG of the SVG at each size. An ICO can hold PNGs directly, so
 * each is a screenshot of the SVG at that size, rendered in `browser`.
 */
export async function icoFromSvg(browser, svg, sizes = [16, 32, 48]) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const pngs = [];
  for (const size of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<body style="margin:0"><img src="${src}" width="${size}" height="${size}" style="display:block">`);
    pngs.push(await page.screenshot({ omitBackground: true }));
    await page.close();
  }
  // The header, then one 16-byte entry per size: width, height, planes, bits, length, offset.
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i;
    head.writeUInt8(size, entry);
    head.writeUInt8(size, entry + 1);
    head.writeUInt16LE(1, entry + 4);
    head.writeUInt16LE(32, entry + 6);
    head.writeUInt32LE(pngs[i].length, entry + 8);
    head.writeUInt32LE(offset, entry + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([head, ...pngs]);
}

/**
 * The card's page (a file: URL, so it can use the site's fonts and photos by relative path),
 * photographed at 1200 x 630 as JPEG. goto waits for its images to load, and the fonts are
 * awaited before the picture.
 */
export async function renderCard(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const jpeg = await page.screenshot({ type: 'jpeg', quality: 88 });
  await page.close();
  return jpeg;
}

/**
 * favicon.svg's text: one letter of a font, as paths, on a 128-unit tile. `font` is the font
 * file's bytes, TTF, OTF or WOFF2; `axes` sets a variable font's instance, such as
 * { wght: 600, opsz: 24 }; `radius` is the tile's corner as a share of its side (0 is square);
 * `ink` is the letter's height as a share of the tile, in its middle both ways; `note` becomes the
 * SVG's comment.
 */
export async function drawLetter(font, { char, axes = {}, fg, bg, radius = 0.2, ink = 0.57, note = '' }) {
  const face = await openFace(font, axes);
  const glyph = face.glyphForCodePoint(char.codePointAt(0));
  // A letter the font lacks comes back as glyph 0, .notdef, which may well be drawn as a box.
  if (!glyph?.id || !glyph.path?.commands.length) throw new Error(`The font has no outline for "${char}"`);
  const box = glyph.path.bbox; // font units, y up
  const tile = 128;
  const inkHeight = tile * ink;
  const scale = inkHeight / (box.maxY - box.minY);
  const tx = (tile - (box.maxX - box.minX) * scale) / 2 - box.minX * scale;
  const ty = (tile + inkHeight) / 2 + box.minY * scale;
  const d = pathData(glyph.path.scale(scale, -scale).translate(tx, ty));
  const rx = tile * radius;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tile} ${tile}">
${note ? `  <!-- ${note} -->\n` : ''}  <rect width="${tile}" height="${tile}"${rx ? ` rx="${rx}"` : ''} fill="${bg}"/>
  <path fill="${fg}" d="${d}"/>
</svg>
`;
}

/**
 * A font's bytes, TTF, OTF or WOFF2, as a fontkit face at `axes`. fontkit cannot make an instance
 * of a variable font from its WOFF2 (the instance has no character map and its glyphs no path),
 * so a WOFF2 is unpacked to TTF first.
 */
async function openFace(font, axes = {}) {
  let bytes = Buffer.from(font);
  if (bytes.subarray(0, 4).toString() === 'wOF2') bytes = Buffer.from(await wawoff2.decompress(bytes));
  const base = fontkit.create(bytes);
  return Object.keys(axes).length ? base.getVariation(axes) : base;
}

/** A fontkit path as SVG path data, to two decimal places. */
const pathData = (path) => path.toSVG().replace(/-?\d+\.\d+/g, (n) => Math.round(Number(n) * 100) / 100);

/**
 * Lettering as an SVG of paths, so a wordmark can appear on a site without its font being
 * served. `runs` are [{ text, fill }]: each run sits on one baseline after the last, kerned,
 * separated by the font's space or by `gap` ems, and becomes one path with the class run-1, run-2
 * and so on, so a page can recolour it. `size` is the font size in SVG units; the viewBox is
 * cropped to the ink. `axes` sets a variable font's instance, as for drawLetter.
 */
export async function outlineText(font, runs, { size = 100, gap, axes = {} } = {}) {
  const face = await openFace(font, axes);
  const scale = size / face.unitsPerEm;
  const space = gap === undefined ? face.glyphForCodePoint(32).advanceWidth * scale : gap * size;
  let x = 0;
  const paths = runs.map((run, i) => {
    const layout = face.layout(run.text);
    const parts = [];
    let pen = x;
    layout.glyphs.forEach((glyph, g) => {
      const at = layout.positions[g];
      if (glyph.path.commands.length) {
        parts.push(glyph.path.scale(scale, -scale).translate(pen + at.xOffset * scale, -at.yOffset * scale));
      }
      pen += at.xAdvance * scale;
    });
    x = pen + space;
    const boxes = parts.map((part) => part.bbox);
    return { ...run, d: parts.map(pathData).join(''), boxes, cls: `run-${i + 1}` };
  });
  const all = paths.flatMap((p) => p.boxes);
  if (!all.length) throw new Error('The font has no outline for any of the text');
  const round = (n) => Math.round(n * 100) / 100;
  const [x1, y1] = [Math.min(...all.map((b) => b.minX)), Math.min(...all.map((b) => b.minY))];
  const [x2, y2] = [Math.max(...all.map((b) => b.maxX)), Math.max(...all.map((b) => b.maxY))];
  const label = runs.map((r) => r.text).join(' ');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(x1)} ${round(y1)} ${round(x2 - x1)} ${round(y2 - y1)}" role="img" aria-label="${label}">`,
    ...paths.map((p) => `  <path class="${p.cls}" fill="${p.fill}" d="${p.d}"/>`),
    '</svg>',
    '',
  ].join('\n');
  return { svg, label, width: round(x2 - x1), height: round(y2 - y1) };
}

/** "wght=600,opsz=24" as { wght: 600, opsz: 24 }. */
export function parseAxes(text = '') {
  return Object.fromEntries(text.split(',').filter(Boolean).map((pair) => {
    const [tag, value] = pair.split('=');
    if (!tag || !Number.isFinite(Number(value))) throw new Error(`An axis is tag=number, such as wght=600: "${pair}"`);
    return [tag.trim(), Number(value)];
  }));
}
