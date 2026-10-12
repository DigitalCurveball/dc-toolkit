// The report `dc-compare --shots <dir>` writes: every page compared into that folder, in the
// order they were run, as one page that reads as well on a phone as at a desk. Each run writes
// its page's pictures and a data.json into <dir>/<page>/, then rewrites <dir>/index.html from
// every data.json there, so comparing a checkpoint's pages one after another builds one report.
// It also writes <dir>/review.html, the same report picturing only what needs a look: a band
// that differs from its concept (the concept, the build and the difference), and each page no
// concept drew, whole. A band that matches is a tick in its page's table. That is the one to
// send: a checkpoint where everything matches is a few tables, and the pictures stay few.
//
// A table comes first, each band against each width; then each width's bands stacked in page
// order, so they read as the whole page, with the concept and the difference under any band that
// differs. Widths stay closed until opened, and pictures load as they are scrolled to, so a phone
// fetches only what is looked at.
//
// The page keeps to the rules for a page published as an artifact on claude.ai, so the folder can
// be sent to a phone as it is: a name for its title, every colour a token with dark values, a 16px
// gutter, and nothing wider than the screen but the table, which scrolls in its own box. To
// publish it, the outer <html>, <head> and <body> tags come off: the host adds its own.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const percent = (band, short) => {
  const p = (band.different / band.compared) * 100;
  if (p < 0.01) return '<0.01%';
  return `${p < 1 ? p.toFixed(2) : short && p >= 10 ? Math.round(p) : p.toFixed(1)}%`;
};

const STATUS = {
  match: { cell: '✓', caption: () => 'Matches' },
  differs: { cell: (band) => percent(band, true), caption: (band) => `${percent(band)} differs` },
  new: { cell: 'New', caption: () => 'Only in the build' },
  gone: { cell: 'Gone', caption: () => 'Only in the concept' },
  alone: { cell: '·', caption: () => '' },
};
const say = (band, part) => {
  const value = STATUS[band.status][part];
  return typeof value === 'function' ? value(band) : value;
};

const heightNote = (band) => {
  if (band.status !== 'differs' || band.concept.h === band.build.h) return '';
  const by = band.build.h - band.concept.h;
  return `, ${Math.abs(by)}px ${by > 0 ? 'taller' : 'shorter'} in the build`;
};

const picture = (shot, alt) =>
  `<a href="${esc(shot.file)}"><img src="${esc(shot.file)}" alt="${esc(alt)}" width="${shot.w}" height="${shot.h}" loading="lazy" decoding="async"></a>`;

function bandFigure(page, width, band, i) {
  const pictures = band.status === 'differs'
    ? `<p class="which">Concept</p>${picture(band.concept, `${band.label}, concept`)}
       <p class="which">Build</p>${picture(band.build, `${band.label}, build`)}
       <p class="which">Difference: red differs, blue is a photo, left out</p>${picture(band.diff, `${band.label}, difference`)}`
    : band.status === 'gone'
      ? picture(band.concept, `${band.label}, concept`)
      : picture(band.build, `${band.label}, build`);
  const pill = band.status === 'alone' ? '' : `<span class="pill ${band.status}">${esc(say(band, 'caption'))}</span> `;
  return `<figure class="band ${band.status}" id="${page.slug}-${width}-${i}">
    <figcaption>${pill}${esc(band.label)}${esc(heightNote(band))}</figcaption>
    ${pictures}
  </figure>`;
}

/** A page no concept drew: the whole page at each width, to be looked at, with nothing to compare. */
function alonePage(page) {
  const count = (n) => (n === 1 ? 'the whole page' : `${n} bands`);
  const widths = page.widths.map((width) => `<details class="width" id="${page.slug}-${width}">
    <summary>${width}px <span class="count">${count(page.shots[width].length)}</span></summary>
    ${page.shots[width].map((band, i) => bandFigure(page, width, band, i)).join('\n')}
  </details>`).join('\n');
  return `<section class="page" id="${page.slug}" aria-labelledby="${page.slug}-h">
  <h2 id="${page.slug}-h">${esc(page.path === '/' ? 'Home page' : page.path)}</h2>
  <p class="meta">${esc(page.title)}</p>
  <p class="summary">No concept drew this page, so its pictures are the build alone, to be looked at.</p>
  ${widths}
</section>`;
}

/** A page against its concept. With `review`, only the bands that differ are pictured. */
function pageSection(page, review) {
  if (!page.concept) return alonePage(page);
  // The table's rows: every band seen at any width, in page order.
  const rows = [];
  for (const width of page.widths) {
    page.shots[width].forEach((band, i) => {
      if (!rows.some((row) => row.key === band.key)) {
        const before = rows.findIndex((row) => row.key === page.shots[width][i - 1]?.key);
        rows.splice(before + 1, 0, { key: band.key, label: band.label });
      }
    });
  }
  const at = (row, width) => {
    const i = page.shots[width].findIndex((band) => band.key === row.key);
    return i === -1 ? null : { band: page.shots[width][i], i };
  };
  const matching = rows.filter((row) => page.widths.every((w) => at(row, w)?.band.status === 'match')).length;
  const summary = matching === rows.length
    ? `Every band matches the concept at every width.`
    : `${matching} of ${rows.length} bands match the concept at every width.`;

  const head = `<tr><th scope="col">Band</th>${page.widths.map((w) => `<th scope="col">${w}</th>`).join('')}</tr>`;
  const body = rows.map((row) => `<tr><th scope="row">${esc(row.label)}</th>${page.widths.map((w) => {
    const found = at(row, w);
    if (!found) return '<td class="none">–</td>';
    if (review && found.band.status === 'match') return '<td class="match">✓</td>';
    return `<td class="${found.band.status}"><a href="#${page.slug}-${w}-${found.i}">${esc(say(found.band, 'cell'))}</a></td>`;
  }).join('')}</tr>`).join('\n');

  const shown = review ? page.widths.filter((width) => page.shots[width].some((band) => band.status !== 'match')) : page.widths;
  const widths = shown.map((width) => {
    const bands = page.shots[width];
    const differ = bands.filter((band) => band.status !== 'match').length;
    const boxes = page.boxes?.[width] ?? [];
    return `<details class="width" id="${page.slug}-${width}">
    <summary>${width}px <span class="count">${differ ? `${differ} of ${bands.length} bands differ` : 'all bands match'}</span></summary>
    ${bands.map((band, i) => (review && band.status === 'match' ? '' : bandFigure(page, width, band, i))).join('\n')}
    <details class="boxes"><summary>Box measurements at ${width}px</summary><pre>${esc(boxes.length ? boxes.join('\n') : 'Every box matches.')}</pre></details>
  </details>`;
  }).join('\n');

  return `<section class="page" id="${page.slug}" aria-labelledby="${page.slug}-h">
  <h2 id="${page.slug}-h">${esc(page.path === '/' ? 'Home page' : page.path)}</h2>
  <p class="meta">${esc(page.title)} · against <code>${esc(page.concept)}</code></p>
  <p class="summary">${summary}</p>
  <div class="table"><table>
    <thead>${head}</thead>
    <tbody>${body}</tbody>
  </table></div>
  ${widths}
</section>`;
}

/**
 * Rewrites <dir>/index.html and <dir>/review.html from every page's data.json in <dir>, and says
 * how many pictures the review holds.
 */
export async function writeReport(dir) {
  const pages = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      pages.push(JSON.parse(await readFile(join(dir, entry.name, 'data.json'), 'utf8')));
    } catch {
      // A folder with no data.json is not a page of the report.
    }
  }
  pages.sort((a, b) => a.ran.localeCompare(b.ran));
  const site = pages.find((page) => page.siteName)?.siteName;
  const title = site ? `${site} port check` : 'Port check';
  const widths = [...new Set(pages.flatMap((page) => page.widths))].sort((a, b) => a - b);
  const written = new Date().toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
  const contents = pages.length > 1
    ? `<nav aria-label="Pages"><ul>${pages.map((page) => `<li><a href="#${page.slug}">${esc(page.path === '/' ? 'Home page' : page.path)}</a></li>`).join('')}</ul></nav>`
    : '';

  const render = (review) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<style>
  /* A contact sheet: a summary table per page, then each width's bands stacked as the page reads. */
  :root {
    --bg: #eef1f4; --surface: #ffffff; --fg: #1a1f26; --muted: #525c68; --line: #cfd6de; --focus: #1f5aa6;
    --ok: #17613a; --ok-bg: #dcefe3; --warn: #7a4300; --warn-bg: #f8e6c4;
    --new: #1f4f8f; --new-bg: #dde8f6; --gone: #5b4a7a; --gone-bg: #e8e2f2;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #12161b; --surface: #1b2128; --fg: #e6eaef; --muted: #a2adba; --line: #323b46; --focus: #8db8f2;
      --ok: #8fd4a9; --ok-bg: #173826; --warn: #f0c27e; --warn-bg: #3a2a10;
      --new: #9fc1f0; --new-bg: #1a2c45; --gone: #c9b8ea; --gone-bg: #2c2440;
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #12161b; --surface: #1b2128; --fg: #e6eaef; --muted: #a2adba; --line: #323b46; --focus: #8db8f2;
    --ok: #8fd4a9; --ok-bg: #173826; --warn: #f0c27e; --warn-bg: #3a2a10;
    --new: #9fc1f0; --new-bg: #1a2c45; --gone: #c9b8ea; --gone-bg: #2c2440;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 var(--sans); }
  main { max-width: 72rem; margin-inline: auto; padding-inline: 16px; padding-block: 1.5rem 4rem; }
  h1 { font-size: 1.6rem; line-height: 1.2; margin: 0 0 0.5rem; text-wrap: balance; }
  h2 { font-size: 1.3rem; margin: 0 0 0.25rem; }
  p { margin: 0 0 0.75rem; max-width: 42rem; }
  code, pre { font-family: var(--mono); font-size: 0.85rem; }
  a { color: var(--focus); }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .intro { color: var(--muted); }
  nav ul { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; padding: 0; margin: 0 0 1.5rem; list-style: none; }
  .page { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid var(--line); }
  .meta { color: var(--muted); font-size: 0.9rem; overflow-wrap: anywhere; }
  .summary { font-weight: 600; }
  .table { overflow-x: auto; margin-bottom: 1rem; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; }
  table { border-collapse: collapse; font-size: 0.9rem; font-variant-numeric: tabular-nums; width: 100%; }
  th, td { padding: 0.35rem 0.25rem; border-bottom: 1px solid var(--line); text-align: center; white-space: nowrap; }
  tbody tr:last-child > * { border-bottom: 0; }
  /* The band names stay put while the widths scroll beside them on a phone. */
  th:first-child { position: sticky; left: 0; z-index: 1; background: var(--surface); padding-inline: 0.5rem; text-align: left; }
  th[scope="row"] { font-weight: 500; white-space: normal; min-width: 7.5rem; max-width: 11rem; }
  td a { display: block; min-width: 2.75rem; padding-inline: 0.2rem; text-decoration: none; color: inherit; font-weight: 600; border-radius: 4px; }
  td.match { color: var(--ok); }
  td.differs a { background: var(--warn-bg); color: var(--warn); }
  td.new a { background: var(--new-bg); color: var(--new); }
  td.gone a { background: var(--gone-bg); color: var(--gone); }
  td.none { color: var(--muted); }
  details.width { background: var(--surface); border: 1px solid var(--line); border-radius: 6px; margin-bottom: 0.5rem; }
  details.width > summary { padding: 0.6rem 0.75rem; cursor: pointer; font-weight: 600; }
  details.width[open] > summary { border-bottom: 1px solid var(--line); }
  .count { font-weight: 400; color: var(--muted); margin-left: 0.5rem; }
  figure.band { margin: 0; padding: 0.75rem; display: grid; gap: 0.4rem; justify-items: start; border-bottom: 1px solid var(--line); }
  figcaption { font-size: 0.9rem; }
  .pill { display: inline-block; padding: 0 0.45rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; margin-right: 0.25rem; }
  .pill.match { background: var(--ok-bg); color: var(--ok); }
  .pill.differs { background: var(--warn-bg); color: var(--warn); }
  .pill.new { background: var(--new-bg); color: var(--new); }
  .pill.gone { background: var(--gone-bg); color: var(--gone); }
  .which { margin: 0.4rem 0 0; font-size: 0.8rem; color: var(--muted); }
  figure.band a { display: block; max-width: 100%; }
  figure.band img { display: block; max-width: 100%; height: auto; outline: 1px solid var(--line); }
  details.boxes { padding: 0.6rem 0.75rem; font-size: 0.9rem; }
  details.boxes summary { cursor: pointer; color: var(--muted); }
  details.boxes pre { overflow-x: auto; white-space: pre; margin: 0.5rem 0 0; }
</style>
</head>
<body>
<main>
  <h1>${esc(title)}</h1>
  <p class="intro">Each page of the build beside its approved concept, band by band, at ${widths.join(', ')}px wide. Written ${esc(written)}.</p>
  <p class="intro">A tick means a band matches the concept. A percentage is the share of a band's pixels that differ, not counting photos, which are left out because the build serves its own copies; their crops are there to be looked at. New is only in the build, Gone only in the concept. Tap a cell to see the band, and a picture to see it full size.</p>
  ${review ? '<p class="intro">Only what needs a look is pictured: each band that differs, and each page no concept drew. A band that matches is a tick, with no picture.</p>' : ''}
  ${contents}
  ${pages.map((p) => pageSection(p, review)).join('\n')}
</main>
<script>
  // A link to a band inside a closed width opens the width first, in every browser.
  const openTo = (id) => {
    for (let d = document.getElementById(id)?.closest('details'); d; d = d.parentElement?.closest('details')) d.open = true;
  };
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (link) openTo(link.hash.slice(1));
  });
  if (location.hash) {
    openTo(location.hash.slice(1));
    document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
</script>
</body>
</html>
`;
  const reviewHtml = render(true);
  await writeFile(join(dir, 'index.html'), render(false));
  await writeFile(join(dir, 'review.html'), reviewHtml);
  const pictures = new Set([...reviewHtml.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1])).size;
  return { index: join(dir, 'index.html'), review: join(dir, 'review.html'), pictures };
}
