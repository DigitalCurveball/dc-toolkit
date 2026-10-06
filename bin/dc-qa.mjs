#!/usr/bin/env node
// Accessibility and layout checks.
//
//   pnpm qa                                    the built site, every page listed in
//                                              package.json (CI, and before launch)
//   dc-qa --url https://… --path /,/about/
//                                              a live site (scheduled, after launch)
//   dc-qa --dir public/concepts --path /index.html
//                                              a concept, for a baseline before porting
//   --json <file>                              also write the results as JSON, for the
//                                              launch and monthly reports (dc-pipeline)
//
// Checks, all of them things a client cannot trip by editing content:
//
//   axe-core   WCAG 2 A and AA, run against the rendered page, so contrast is
//              measured as it actually paints. That matters: every contrast
//              failure found by hand on this project was translucent text over a
//              background, which arithmetic on the palette alone does not catch.
//              Note it does not evaluate ::placeholder text, so it is a floor,
//              not a ceiling. See the README, "What axe does not catch".
//   overflow   no horizontal scrolling at 320, 400, 768 and 1280.
//   covered    no text that another element paints over, at the same widths: a
//              positioned photo or slab overlapping copy, which neither the
//              overflow check nor axe sees (src/covered-text.mjs).
//   links      in-page anchors point at something that exists, internal links
//              resolve. Bare "#" placeholders are counted, not failed: they are
//              expected until launch, and the launch checklist is where they
//              become a problem.
//   headings   exactly one h1, and no skipped levels.
//   meta       title, description, canonical and Open Graph present.
//
// Exits non-zero when anything fails. That is deliberately loud in GitHub Actions
// and invisible to the client: Cloudflare deploys from main independently, so a
// red run never stops a content edit reaching the site. What a red run blocks is
// the launch checklist, which is a human step.

import { appendFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import { findCoveredText } from '../src/covered-text.mjs';
import { serve } from '../src/serve.mjs';

const WIDTHS = [320, 400, 768, 1280];

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const dir = arg('dir');
const url = arg('url');
const paths = (arg('path', '/') ?? '/').split(',');
// Off by default: a flaky third-party host should not turn a design check red.
// Worth enabling for the scheduled runs against a live site.
const checkExternal = args.includes('--external');
const jsonFile = arg('json');
if (!dir && !url) {
  console.error('Need --dir <build output> or --url <live site>');
  process.exit(2);
}

const server = dir ? await serve(dir) : null;
const origin = url ?? server.origin;
const browser = await chromium.launch();
const failures = [];
const lines = [];
// The same results as data, for --json: one entry per page, in the order checked.
const results = [];

/** Structure checks that do not vary by viewport, so they run once per page. */
async function checkDocument(page, path, result) {
  const found = await page.evaluate(() => {
    const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name)?.trim() ?? '';
    return {
      title: document.title.trim(),
      description: attr('meta[name="description"]', 'content'),
      canonical: attr('link[rel="canonical"]', 'href'),
      og: {
        title: attr('meta[property="og:title"]', 'content'),
        description: attr('meta[property="og:description"]', 'content'),
        type: attr('meta[property="og:type"]', 'content'),
        url: attr('meta[property="og:url"]', 'content'),
        image: attr('meta[property="og:image"]', 'content'),
      },
      headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
        level: Number(h.tagName[1]),
        text: h.textContent.trim().slice(0, 60),
      })),
      links: [...document.querySelectorAll('a[href]')].map((a) => ({
        href: a.getAttribute('href'),
        resolved: a.href,
        text: a.textContent.trim().slice(0, 40),
      })),
      anchorTargets: [...document.querySelectorAll('[id]')].map((el) => el.id),
    };
  });

  // Meta
  const missing = [];
  if (!found.title) missing.push('title');
  if (!found.description) missing.push('meta description');
  if (!found.canonical) missing.push('canonical');
  for (const [key, value] of Object.entries(found.og)) if (!value) missing.push(`og:${key}`);
  result.meta = { missing };
  if (missing.length) {
    failures.push(`${path}: missing ${missing.join(', ')}`);
    lines.push(`- ❌ meta incomplete: ${missing.join(', ')}`);
  } else {
    lines.push('- ✅ meta, canonical and Open Graph present');
  }

  // Headings
  const h1s = found.headings.filter((h) => h.level === 1).length;
  const skips = [];
  found.headings.forEach((h, i) => {
    const previous = found.headings[i - 1];
    if (previous && h.level > previous.level + 1) skips.push(`h${previous.level} to h${h.level} ("${h.text}")`);
  });
  result.headings = { count: found.headings.length, h1s, skips };
  if (h1s !== 1 || skips.length) {
    if (h1s !== 1) {
      failures.push(`${path}: ${h1s} h1 elements`);
      lines.push(`- ❌ heading order: ${h1s} h1 elements, expected exactly one`);
    }
    for (const skip of skips) {
      failures.push(`${path}: heading level skipped, ${skip}`);
      lines.push(`- ❌ heading order: skipped ${skip}`);
    }
  } else {
    lines.push(`- ✅ heading order (${found.headings.length} headings, one h1)`);
  }

  // Links
  const placeholders = found.links.filter((l) => l.href === '#');
  const broken = [];
  const checked = [];
  for (const link of found.links) {
    if (link.href === '#') continue;
    if (link.href.startsWith('#')) {
      checked.push(link.resolved);
      if (!found.anchorTargets.includes(link.href.slice(1))) broken.push({ ...link, problem: 'no such id' });
      continue;
    }
    if (!/^https?:/i.test(link.resolved)) continue;
    const sameOrigin = link.resolved.startsWith(origin);
    if (!sameOrigin && !checkExternal) continue;
    checked.push(link.resolved);
    try {
      let res = await fetch(link.resolved, { method: 'HEAD', redirect: 'follow' });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(link.resolved, { method: 'GET', redirect: 'follow' });
      }
      if (!res.ok) broken.push({ ...link, problem: String(res.status) });
    } catch (error) {
      broken.push({ ...link, problem: error.message });
    }
  }
  result.links = { checked, broken, placeholders: placeholders.length };
  if (broken.length) {
    for (const { href, problem } of broken) {
      failures.push(`${path}: broken link ${href} (${problem})`);
      lines.push(`- ❌ broken link: ${href} (${problem})`);
    }
  } else {
    lines.push(`- ✅ links resolve (${checked.length} checked)`);
  }
  if (placeholders.length) {
    lines.push(`- ℹ️ ${placeholders.length} placeholder links (\`href="#"\`), expected until launch`);
  }
}

for (const path of paths) {
  const target = new URL(path, origin).href;
  lines.push(`\n### ${path}\n`);
  const result = { path, widths: [] };
  results.push(result);

  const docContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const docPage = await docContext.newPage();
  await docPage.goto(target, { waitUntil: 'networkidle' });
  await checkDocument(docPage, path, result);
  await docContext.close();

  for (const width of WIDTHS) {
    // A context per width, not browser.newPage(): axe refuses to run on a page
    // created directly off the browser.
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(target, { waitUntil: 'networkidle' });

    // Horizontal overflow: the page is wider than its own viewport. One pixel of
    // tolerance for sub-pixel rounding.
    const overflow = await page.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
      document.documentElement.clientWidth
    );
    const widthResult = { width, overflow: Math.max(overflow, 0) };
    result.widths.push(widthResult);
    if (overflow > 1) {
      failures.push(`${path} overflows horizontally by ${overflow}px at ${width}px`);
      lines.push(`- ❌ **${width}px** overflows by ${overflow}px`);
    } else {
      lines.push(`- ✅ ${width}px no overflow`);
    }

    // Covered text, once the fonts have settled the lines where they will stay.
    await page.evaluate(() => document.fonts.ready);
    const covered = await page.evaluate(findCoveredText);
    widthResult.covered = covered;
    if (covered.length) {
      failures.push(`${path} at ${width}px: text covered in ${covered.length} element(s)`);
      lines.push(`- ❌ **${width}px** text covered in ${covered.length} element(s)`);
      for (const c of covered.slice(0, 5)) lines.push(`    - \`${c.element}\` ("${c.text}…") under \`${c.by}\``);
    } else {
      lines.push(`- ✅ ${width}px no covered text`);
    }

    // axe at the narrowest and widest only: the middle widths rarely differ, and
    // each scan costs a second or two.
    if (width === WIDTHS[0] || width === WIDTHS.at(-1)) {
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      widthResult.axe = violations.map((v) => ({
        id: v.id, help: v.help, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')),
      }));
      if (violations.length === 0) {
        lines.push(`- ✅ ${width}px axe clean`);
      } else {
        for (const v of violations) {
          failures.push(`${path} at ${width}px: ${v.id} (${v.nodes.length})`);
          lines.push(`- ❌ **${width}px** ${v.id}: ${v.help} (${v.nodes.length} element(s), ${v.impact})`);
          for (const node of v.nodes.slice(0, 3)) {
            lines.push(`    - \`${node.target.join(' ')}\``);
            if (node.any?.[0]?.message) lines.push(`      ${node.any[0].message}`);
          }
        }
      }
    }
    await context.close();
  }
}

await browser.close();
server?.close();

const heading = `## Accessibility and layout\n\nTarget: ${url ?? `${dir} (served locally)`}`;
const report = [heading, ...lines, '', failures.length
  ? `**${failures.length} problem(s).**`
  : '**All checks passed.**'].join('\n');

console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}
if (jsonFile) {
  const json = { target: url ?? dir, external: checkExternal, widths: WIDTHS, pages: results, failures };
  await writeFile(jsonFile, `${JSON.stringify(json, null, 2)}\n`);
}
process.exit(failures.length ? 1 : 0);
