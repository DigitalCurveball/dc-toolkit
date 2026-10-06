// Text that another element paints over: dc-qa's covered-text check. Neither the overflow
// check nor axe sees it, and an approved concept once shipped with a photo painting over the
// ends of its intro's lines from 800 to 1440px.
//
// findCoveredText runs inside the page (`page.evaluate(findCoveredText)`), so it is
// self-contained: Playwright sends its source, not its closure. For each line of visible
// text it asks, at three points along the line, what is on top (document.elementFromPoint).
// Anything other than the text's own element only fails when it paints there:
//
// - The covering elements are the ones between the hit and the nearest ancestor shared with
//   the text. A positioned element (or any other stacking context) and everything inside it
//   paints above ordinary content, so a background or image there covers the text.
// - With no such element in between, only an image or another replaced element can be on
//   top: an ordinary block's background is painted beneath every line of text.
//
// So a transparent overlay (a stretched link, say) passes, and so does text an ancestor's
// overflow or clip-path hides on purpose (visually hidden text, a clipped wordmark).

/** Every element whose text is painted over, as { element, text, by }. */
export function findCoveredText() {
  const SKIP = 'script, style, noscript, template, select, option, textarea';
  const REPLACED = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'IFRAME', 'PICTURE', 'OBJECT', 'EMBED', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON']);
  const MIN = 4; // px: a line or a visible part of one smaller than this is not checked

  const parseAlpha = (s) => (s.trim().endsWith('%') ? parseFloat(s) / 100 : parseFloat(s));
  const alpha = (colour) => {
    if (colour === 'transparent') return 0;
    const inner = colour.slice(colour.indexOf('(') + 1, colour.lastIndexOf(')'));
    if (inner.includes('/')) return parseAlpha(inner.split('/')[1]);
    const parts = inner.split(',');
    return parts.length === 4 ? parseAlpha(parts[3]) : 1;
  };
  const replaced = (e) => REPLACED.has(e.tagName.toUpperCase()) || e instanceof SVGElement;
  const paints = (e) => {
    if (replaced(e)) return true;
    const st = getComputedStyle(e);
    return alpha(st.backgroundColor) > 0.05 || st.backgroundImage !== 'none';
  };
  const isLayer = (e) => {
    const st = getComputedStyle(e);
    return st.position !== 'static' || st.transform !== 'none' || st.zIndex !== 'auto' || Number(st.opacity) < 1 ||
      st.filter !== 'none' || st.isolation === 'isolate' || st.clipPath !== 'none' || st.mixBlendMode !== 'normal';
  };
  const describe = (e) => {
    const name = e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + [...e.classList].map((c) => `.${c}`).join('');
    const named = e.parentElement?.closest('[id], [class]');
    return e.id || e.classList.length || !named ? name : `${name} in ${describe(named)}`;
  };

  // The part of a line that its ancestors' overflow and clip-path leave on screen.
  const visible = (el, rect) => {
    let { left, top, right, bottom } = rect;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const st = getComputedStyle(a);
      const clipped = st.clipPath !== 'none';
      const x = clipped || st.overflowX !== 'visible';
      const y = clipped || st.overflowY !== 'visible';
      if (!x && !y) continue;
      const r = a.getBoundingClientRect();
      if (x) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
      if (y) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
    }
    return right - left >= MIN && bottom - top >= MIN ? { left, top, width: right - left, height: bottom - top } : null;
  };

  // What paints over el at a point where `hit` is on top, or null.
  const coverer = (hit, el) => {
    const chain = [];
    for (let e = hit; e && !e.contains(el); e = e.parentElement) chain.push(e);
    const layer = chain.findLastIndex(isLayer);
    return (layer >= 0 ? chain.slice(0, layer + 1).find(paints) : chain.find(replaced)) ?? null;
  };

  const found = new Map();
  const width = document.documentElement.clientWidth;
  const height = window.innerHeight;
  const startY = window.scrollY;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || !node.data.trim() || found.has(el) || el.closest(SKIP)) continue;
    // Not rendered: display: none, visibility: hidden, or a closed <details>, whose content
    // still has boxes in Chrome though nothing is drawn.
    if (!el.checkVisibility({ visibilityProperty: true })) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const lines = range.getClientRects().length;
    for (let i = 0; i < lines && !found.has(el); i++) {
      let rect = range.getClientRects()[i];
      if (!rect || rect.width < MIN || rect.height < MIN) continue;
      // Hit testing sees only the viewport. A line is brought to its middle, where a sticky
      // header (at the top) or a fixed bar (at the bottom) is not in the way.
      const middle = rect.top + rect.height / 2;
      if (middle < height * 0.25 || middle > height * 0.75) {
        window.scrollTo({ top: window.scrollY + middle - height / 2, behavior: 'instant' });
        rect = range.getClientRects()[i];
        if (!rect) continue;
      }
      const box = visible(el, rect);
      if (!box) continue;
      for (const along of [0.1, 0.5, 0.9]) {
        const x = box.left + box.width * along;
        const y = box.top + box.height / 2;
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
        const by = coverer(hit, el);
        if (by) {
          found.set(el, { element: describe(el), text: node.data.trim().replace(/\s+/g, ' ').slice(0, 50), by: describe(by) });
          break;
        }
      }
    }
  }
  window.scrollTo({ top: startY, behavior: 'instant' });
  return [...found.values()];
}
