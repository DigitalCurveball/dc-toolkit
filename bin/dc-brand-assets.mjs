#!/usr/bin/env node
// Renders a site's raster brand files from their sources, with the Playwright browser the gate
// already uses. Run it from the site's root after changing either source:
//
//   pnpm exec dc-brand-assets
//
//   public/favicon.ico          16, 32 and 48px, from public/favicon.svg
//   src/assets/social-card.jpg  1200 x 630, the link-preview card, from scripts/social-card.html,
//                               if the site has one (a card made otherwise is left as it is)
//
// Both sources are the site's, edited by hand: the favicon from its brand (dc-favicon draws a
// letter of its font, for a brand with no mark), the card from the approved concept's first
// screen. The card's page is opened from disk, so it uses the site's own font files and photos
// by relative path, such as url(../src/assets/fonts/<file>.woff2).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { icoFromSvg, renderCard } from '../src/brand.mjs';

const root = process.cwd();
const svg = resolve(root, 'public/favicon.svg');
const cardPage = resolve(root, 'scripts/social-card.html');
if (!existsSync(svg)) {
  console.error('No public/favicon.svg here: run dc-brand-assets from the site\'s root.');
  process.exit(1);
}

const browser = await chromium.launch();
try {
  writeFileSync(resolve(root, 'public/favicon.ico'), await icoFromSvg(browser, readFileSync(svg)));
  if (existsSync(cardPage)) {
    writeFileSync(resolve(root, 'src/assets/social-card.jpg'), await renderCard(browser, pathToFileURL(cardPage).href));
  }
} finally {
  await browser.close();
}
console.log(`Wrote public/favicon.ico${existsSync(cardPage) ? ' and src/assets/social-card.jpg' : '; no scripts/social-card.html, so the card is left as it is'}`);
