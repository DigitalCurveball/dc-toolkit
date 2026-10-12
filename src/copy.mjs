// The copy check (bin/dc-check-copy.mjs): every fragment of a client's approved copy must appear
// in the page's text. A client on Presence or Practice supplies the words, so a dropped or
// changed word, or a comma, is a defect the eye misses on a long page. First written for a demo
// site's port, where it found all 88 fragments of the owner's copy (2026-10-06).

/** Text compared without case, curly quotes, dashes or runs of space mattering. */
export function normalise(text) {
  return text
    // EmailLink writes "name [at] domain" into the HTML; a script makes it the address.
    .replace(/ \[at\] /g, '@')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/–/g, '-')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The fragments of the copy in `text`, between the first line holding `from` and the first after
 * it holding `to` (either left out: the start or the end). Headings, blank lines and lines that
 * are only a bold label are not copy; `ignore` is a list of patterns removed from each line first,
 * such as a label the copy is written under ("Button: "), and a line they empty is skipped. The
 * rest is split at the end of each sentence and at each colon, so layout may set the pieces apart.
 */
export function copyFragments(text, { from, to, ignore = [] } = {}) {
  let lines = text.split('\n');
  if (from) {
    const start = lines.findIndex((line) => line.includes(from));
    if (start === -1) throw new Error(`No line holds "${from}"`);
    lines = lines.slice(start);
  }
  if (to) {
    const end = lines.findIndex((line, i) => i > 0 && line.includes(to));
    if (end === -1) throw new Error(`No line after "${from ?? 'the start'}" holds "${to}"`);
    lines = lines.slice(0, end);
  }
  const fragments = [];
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('#') || /^\*\*[^*]+\*\*:?$/.test(line)) continue;
    for (const pattern of ignore) line = line.replace(new RegExp(pattern), '');
    line = line.replace(/^[-*>]\s+/, '').replaceAll('**', '').trim();
    if (!line) continue;
    for (let piece of line.split(/(?<=[.?!:])\s+|:\s+/)) {
      piece = piece.trim().replace(/:+$/, '');
      if (piece.length > 2) fragments.push(piece);
    }
  }
  return fragments;
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', middot: '·', times: '×' };

/** A page's visible text, as a reader meets it: blocks and line breaks read as spaces. */
export function pageText(html) {
  let body = html.slice(Math.max(0, html.indexOf('<body')));
  // Scripts go without a trace: EmailLink's sits inside a sentence, before its full stop.
  body = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, '');
  // A line break, and the edge of every block, reads as a space however the HTML is formatted:
  // Astro adds attributes (<br data-astro-cid-…>) and leaves no whitespace between the blocks a
  // component renders.
  body = body.replace(/<br\b[^>]*>/g, ' ');
  body = body.replace(/<\/?(p|div|li|dt|dd|h[1-6]|figure|figcaption|blockquote|section|header|footer|aside|main|nav|ul|ol|dl|form|label|option|td|th|tr|table)\b[^>]*>/g, ' ');
  return body.replace(/<[^>]+>/g, '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return NAMED[code.toLowerCase()] ?? entity;
  });
}

/** The fragments missing from a page's HTML. */
export function missingCopy(fragments, html) {
  const text = normalise(pageText(html));
  return fragments.filter((fragment) => !text.includes(normalise(fragment)));
}
