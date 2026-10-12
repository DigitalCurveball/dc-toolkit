import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { drawLetter, icoFromSvg, outlineText, parseAxes, renderCard } from '../src/brand.mjs';

// Big Shoulders Display, a variable font (weight 100 to 900), as the WOFF2 a site self-hosts:
// the case fontkit cannot read without unpacking it first. SIL Open Font License, fixtures/OFL.txt.
const FONT = new URL('./fixtures/big-shoulders-display-latin.woff2', import.meta.url);

let browser;
let dir;
before(async () => {
  browser = await chromium.launch();
  dir = await mkdtemp(join(tmpdir(), 'dc-brand-'));
});
after(async () => {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
});

test('the ICO holds a PNG at each size, each where its entry says', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#1f3b4a"/></svg>';
  const ico = await icoFromSvg(browser, svg);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1, 'type 1 is an icon');
  assert.equal(ico.readUInt16LE(4), 3);
  for (const [i, size] of [16, 32, 48].entries()) {
    const entry = 6 + 16 * i;
    assert.equal(ico.readUInt8(entry), size);
    const length = ico.readUInt32LE(entry + 8);
    const png = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + length);
    const meta = await sharp(png).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['png', size, size]);
  }
});

test('the card is its page at 1200 x 630, with a photo the page names by relative path', async () => {
  const red = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#d00000' } }).png().toBuffer();
  await writeFile(join(dir, 'red.png'), red);
  await writeFile(join(dir, 'card.html'), '<!doctype html><body style="margin:0;background:#1f3b4a"><img src="red.png" style="display:block;width:600px;height:630px">');
  const jpeg = await renderCard(browser, pathToFileURL(join(dir, 'card.html')).href);
  const meta = await sharp(jpeg).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['jpeg', 1200, 630]);
  const { data } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => [...data.subarray((y * 1200 + x) * 3, (y * 1200 + x) * 3 + 3)];
  assert.ok(at(300, 300)[0] > 180, 'the photo loaded on the left');
  assert.ok(at(900, 300)[2] > 50 && at(900, 300)[0] < 60, 'the ground on the right');
});

test('a letter of a variable WOFF2 is drawn at the weight asked for, on its tile', async () => {
  const font = await readFile(FONT);
  const thin = await drawLetter(font, { char: 'C', axes: { wght: 100 }, fg: '#08223D', bg: '#FF5A1F', radius: 0 });
  const black = await drawLetter(font, { char: 'C', axes: { wght: 900 }, fg: '#08223D', bg: '#FF5A1F', radius: 0, note: 'A note' });
  const path = (svg) => svg.match(/<path fill="#08223D" d="(M[^"]+)"/)?.[1];
  assert.ok(path(thin) && path(black), 'each has a path');
  assert.notEqual(path(thin), path(black), 'the weight changes the outline');
  assert.match(black, /<rect width="128" height="128" fill="#FF5A1F"\/>/, 'square: no rx');
  assert.match(black, /<!-- A note -->/);
  const rounded = await drawLetter(font, { char: 'C', fg: '#000', bg: '#fff', radius: 0.2 });
  assert.match(rounded, /rx="25.6"/);
});

test('the letter sits in the middle of the tile, its ink the height asked for', async () => {
  const svg = await drawLetter(await readFile(FONT), { char: 'C', axes: { wght: 900 }, fg: '#000000', bg: '#ffffff', radius: 0, ink: 0.5 });
  // Measured from the picture, since a curve's control points lie outside its ink.
  const { data, info } = await sharp(Buffer.from(svg)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rows = [];
  const cols = [];
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[y * info.width + x] < 128) { rows.push(y); cols.push(x); }
  }
  const [top, bottom] = [Math.min(...rows), Math.max(...rows) + 1];
  const [left, right] = [Math.min(...cols), Math.max(...cols) + 1];
  assert.ok(Math.abs(top - 32) <= 1 && Math.abs(bottom - 96) <= 1, `ink from y ${top} to ${bottom}`);
  assert.ok(Math.abs(left - (128 - right)) <= 1, `margins ${left} and ${128 - right}`);
});

test('a missing letter and a malformed axis are refused', async () => {
  await assert.rejects(drawLetter(await readFile(FONT), { char: '☃', fg: '#000', bg: '#fff' }), /no outline/);
  assert.deepEqual(parseAxes('wght=600, opsz=24'), { wght: 600, opsz: 24 });
  assert.deepEqual(parseAxes(''), {});
  assert.throws(() => parseAxes('wght'), /tag=number/);
});

test('lettering becomes one path per run, in its fill, cropped to the ink', async () => {
  const font = await readFile(FONT);
  const { svg, label } = await outlineText(font, [{ text: 'BIG', fill: '#08223D' }, { text: 'SHOULDERS', fill: '#FF5A1F' }], { axes: { wght: 900 } });
  assert.equal(label, 'BIG SHOULDERS');
  assert.match(svg, /role="img" aria-label="BIG SHOULDERS"/);
  assert.match(svg, /<path class="run-1" fill="#08223D" d="M/);
  assert.match(svg, /<path class="run-2" fill="#FF5A1F" d="M/);
  // Rendered, the ink reaches every edge of the picture: the viewBox is cropped to it.
  const { data, info } = await sharp(Buffer.from(svg), { density: 300 }).resize({ width: 800 }).flatten({ background: '#ffffff' })
    .greyscale().raw().toBuffer({ resolveWithObject: true });
  const ink = (x, y) => data[y * info.width + x] < 200;
  // Within a pixel of each edge: the last column or row may be covered only in part.
  const column = (x) => [...Array(info.height).keys()].some((y) => ink(x, y));
  const row = (y) => [...Array(info.width).keys()].some((x) => ink(x, y));
  const [w, h] = [info.width, info.height];
  assert.ok((column(0) || column(1)) && (column(w - 1) || column(w - 2)), 'ink at the left and right');
  assert.ok((row(0) || row(1)) && (row(h - 1) || row(h - 2)), 'ink at the top and bottom');
});

test('the gap between runs is the font space unless given in em', async () => {
  const font = await readFile(FONT);
  const runs = [{ text: 'A', fill: '#000' }, { text: 'B', fill: '#000' }];
  const widthOf = async (gap) => (await outlineText(font, runs, { gap })).width;
  const [one, two] = [await widthOf(1), await widthOf(2)];
  assert.ok(Math.abs(two - one - 100) < 0.05, `an em more is 100 units wider: ${one} and ${two}`);
  assert.ok((await widthOf(undefined)) < one, 'the font space is narrower than an em');
});
