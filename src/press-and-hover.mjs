// Hover only with a mouse, and a press state on everything pressed: dc-qa's press and hover check
// (dc-pipeline docs/site-stack.md). On a phone a tap applies :hover and leaves it on until the next
// tap somewhere else, so a hover rule a mouse doesn't gate leaves a button dark, or a card lifted,
// after it is tapped; and a button with no :active state answers a press only once the finger
// lifts (Emil Kowalski's skills, dc-pipeline docs/facts.md, Tools, 2026-11-27).
//
// findPressAndHover runs inside the page (`page.evaluate(findPressAndHover)`), so it is
// self-contained. From the page's own style sheets (another origin's, a font service's, can't be
// read, and holds no hover), with nested rules read as their full selectors:
//
// - every rule whose selector has :hover sits inside a media rule asking for both
//   (hover: hover) and (pointer: fine);
// - every button (button, an input of type submit, button or reset, [role=button]) and every
//   link drawn as one (a box of its own, not inline, with a background or a border all round,
//   holding no photo, and on the page: a skip link waits above it until it is focused, and is
//   only ever pressed from the keyboard) matches a rule with :active, read without its :active.
//   A disabled button,
//   and anything under [hidden], are left out: a hidden pause control is shown only with motion,
//   when it is checked again.

/** The page's problems, as { hover: [{ selector, sheet }], press: [{ element, text }] }. */
export function findPressAndHover() {
  const splitSelectors = (text) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === ',' && depth === 0) {
        parts.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(text.slice(start).trim());
    return parts.filter(Boolean);
  };
  // A nested rule's selectors in full: `&` is its parent rule's, and a selector without one is
  // inside it.
  const resolve = (rule) => {
    let parent = rule.parentRule;
    while (parent && !(parent instanceof CSSStyleRule)) parent = parent.parentRule;
    const own = splitSelectors(rule.selectorText);
    if (!parent) return own;
    const outer = `:is(${resolve(parent).join(', ')})`;
    return own.map((part) => (part.includes('&') ? part.replaceAll('&', outer) : `${outer} ${part}`));
  };
  const asksForMouse = (media) => {
    const text = media.mediaText.replace(/\s+/g, '');
    return text.includes('(hover:hover)') && text.includes('(pointer:fine)');
  };
  const sheetName = (rule) => {
    let sheet = rule.parentStyleSheet;
    while (sheet?.parentStyleSheet) sheet = sheet.parentStyleSheet;
    return sheet?.href ? new URL(sheet.href).pathname : 'a <style> in the page';
  };

  const hover = [];
  const pressed = []; // selectors that match an element while it is pressed, read without :active
  const ACTIVE = /:active(?![\w-])/;
  const walk = (rules, mouse) => {
    for (const rule of rules) {
      if (rule instanceof CSSImportRule) {
        if (rule.styleSheet) walk(rule.styleSheet.cssRules, mouse);
        continue;
      }
      const inMouse = mouse || (rule instanceof CSSMediaRule && asksForMouse(rule.media));
      if (rule instanceof CSSStyleRule) {
        const selectors = resolve(rule);
        if (!inMouse && rule.selectorText.includes(':hover')) {
          hover.push({ selector: rule.selectorText, sheet: sheetName(rule) });
        }
        if (rule.style.length) {
          for (const part of selectors) if (ACTIVE.test(part)) pressed.push(part.replace(new RegExp(ACTIVE, 'g'), ''));
        }
      }
      if (rule.cssRules) walk(rule.cssRules, inMouse);
    }
  };
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // another origin's
    }
    walk(rules, false);
  }

  const parseAlpha = (s) => (s.trim().endsWith('%') ? parseFloat(s) / 100 : parseFloat(s));
  const alpha = (colour) => {
    if (colour === 'transparent') return 0;
    const inner = colour.slice(colour.indexOf('(') + 1, colour.lastIndexOf(')'));
    if (inner.includes('/')) return parseAlpha(inner.split('/')[1]);
    const parts = inner.split(',');
    return parts.length === 4 ? parseAlpha(parts[3]) : 1;
  };
  const drawnAsButton = (link) => {
    const st = getComputedStyle(link);
    if (st.display === 'inline' || st.display === 'contents' || st.display === 'none') return false;
    if (link.querySelector('img, picture, video')) return false;
    const box = link.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) return false;
    if (box.bottom + scrollY <= 0 || box.right + scrollX <= 0) return false; // a skip link, off the page until focused

    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const bordered = sides.every((side) =>
      parseFloat(st[`border${side}Width`]) > 0 && st[`border${side}Style`] !== 'none' && alpha(st[`border${side}Color`]) > 0);
    return alpha(st.backgroundColor) > 0 || bordered;
  };
  const matchesPressed = (el) => pressed.some((selector) => {
    try {
      return el.matches(selector);
    } catch {
      return false; // :active was part of a :not() or the like
    }
  });
  const name = (el) => {
    const text = (el.textContent || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
    return {
      element: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${[...el.classList].filter((c) => !c.startsWith('astro-')).map((c) => `.${c}`).join('')}`,
      text: text.slice(0, 40),
    };
  };
  const press = [];
  const candidates = document.querySelectorAll('button, input[type="submit"], input[type="button"], input[type="reset"], [role="button"], a[href]');
  for (const el of candidates) {
    if (el.closest('[hidden]') || el.disabled) continue;
    if (el.matches('a[href]:not([role="button"])') && !drawnAsButton(el)) continue;
    if (!matchesPressed(el)) press.push(name(el));
  }
  return { hover, press };
}
