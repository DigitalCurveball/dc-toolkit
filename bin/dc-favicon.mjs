#!/usr/bin/env node
// Draws public/favicon.svg for a brand with no mark: one letter of the site's own font, as paths
// (a favicon cannot load a font), on a tile. dc-brand-assets then makes favicon.ico from it.
//
//   pnpm exec dc-favicon --font src/assets/fonts/<file>.woff2 --char G --fg '#F8F5EE' --bg '#1F3B4A'
//   --axes wght=600,opsz=24   a variable font's instance; leave it out for a static font
//   --radius 0.2              the tile's corner, as a share of its side; 0 is square
//   --ink 0.57                the letter's height, as a share of the tile, in its middle both ways
//   --note "<text>"           the SVG's comment, such as what the letter is and why
//   --out public/favicon.svg  where it goes (the default)
//
// Record the command in the site's CLAUDE.md, Brand, so the favicon can be drawn again.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { drawLetter, parseAxes } from '../src/brand.mjs';

const { values: v } = parseArgs({
  options: {
    font: { type: 'string' },
    char: { type: 'string' },
    axes: { type: 'string', default: '' },
    fg: { type: 'string' },
    bg: { type: 'string' },
    radius: { type: 'string', default: '0.2' },
    ink: { type: 'string', default: '0.57' },
    note: { type: 'string', default: '' },
    out: { type: 'string', default: 'public/favicon.svg' },
  },
});
if (!v.font || !v.char || !v.fg || !v.bg) {
  console.error('Usage: dc-favicon --font <file> --char <letter> --fg <#hex> --bg <#hex> [--axes wght=600,opsz=24] [--radius 0.2] [--ink 0.57] [--note <text>] [--out public/favicon.svg]');
  process.exit(1);
}

const svg = await drawLetter(readFileSync(resolve(v.font)), {
  char: v.char,
  axes: parseAxes(v.axes),
  fg: v.fg,
  bg: v.bg,
  radius: Number(v.radius),
  ink: Number(v.ink),
  note: v.note,
});
writeFileSync(resolve(v.out), svg);
console.log(`Wrote ${v.out}; dc-brand-assets makes favicon.ico from it`);
