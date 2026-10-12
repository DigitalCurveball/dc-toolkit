#!/usr/bin/env node
// Sets text in a font and writes it out as SVG paths, so a wordmark can appear on a site without
// the font itself being served. Desktop font licences usually forbid web embedding (a webfont)
// but allow artwork made from typesetting: check the licence first, and never copy the font file
// into public/.
//
//   pnpm exec dc-outline-text --font brand.ttf --out wordmark.svg "Digital=#666666" "Curveball=#ff3333"
//   --gap 0.132               the space between runs, in em (the default: the font's space)
//   --size 100                the font size, in SVG units
//   --axes wght=600           a variable font's instance; leave it out for a static font
//
// Each argument is one run of text with its fill. Runs sit on one baseline, kerned. The SVG's
// viewBox is cropped to the ink, and each run is a path with the class run-1, run-2 and so on, so
// a page can recolour it with CSS. Combining the text with a brand mark is a job for the brand.
// Record the command where the SVG says how it was made, so it can be made again.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { outlineText, parseAxes } from '../src/brand.mjs';

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    font: { type: 'string' },
    out: { type: 'string' },
    size: { type: 'string', default: '100' },
    gap: { type: 'string' },
    axes: { type: 'string', default: '' },
  },
});
if (!v.font || !v.out || positionals.length === 0) {
  console.error('Usage: dc-outline-text --font <file> --out <file.svg> [--size 100] [--gap <em>] [--axes wght=600] "Text=#rrggbb" ...');
  process.exit(1);
}

const runs = positionals.map((arg) => {
  const at = arg.lastIndexOf('=');
  if (at < 1) throw new Error(`Expected "Text=#rrggbb", got "${arg}"`);
  return { text: arg.slice(0, at), fill: arg.slice(at + 1) };
});
const { svg, label, width, height } = await outlineText(readFileSync(v.font), runs, {
  size: Number(v.size),
  gap: v.gap === undefined ? undefined : Number(v.gap),
  axes: parseAxes(v.axes),
});
writeFileSync(v.out, svg);
console.log(`Wrote ${v.out}: "${label}", ${runs.length} run(s), ${width} × ${height}`);
