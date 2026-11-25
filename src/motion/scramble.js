// A text scramble (dc-pipeline #54), for a short label: an eyebrow, a button, a menu link. Its
// letters flicker through other characters and settle on the real ones, left to right, in under a
// second: once as it scrolls into view, and again when a mouse or pen moves over it.
//
// The real text stays where it is, transparent, so the label keeps its exact size and nothing
// around it moves; the flickering letters are laid over it, each centred on the character it
// stands for, and hidden from screen readers, which read the real text throughout. Afterwards the
// label is its own text node again. A label on the screen when the page opens doesn't scramble
// until it is hovered, and none does while the visitor has paused motion.
//
// Plain text only, up to 60 characters: a label with markup in it, or a longer one, stays as it
// is. Never body text, or a heading people need to read.
//
// It plays once, in under a second: no pause control (`loops: false`).

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+=?<>/';
const HOLD = 0.2; // seconds before the first letter settles
const SETTLE = 0.55; // seconds over which the letters settle, first to last
const STEP = 0.06; // seconds between one flicker and the next
const MOST = 60; // characters at most

export default {
  loops: false,
  setup(element, kit) {
    const text = element.textContent;
    if (element.children.length || !text.trim() || text.length > MOST) {
      console.warn('dc-motion: a scramble takes plain text of up to 60 characters', element);
      return {};
    }
    const original = [...element.childNodes];
    const starts = kit.opening || kit.paused() ? [] : [0]; // when each scramble began, in the effect's time
    let hovered = false;
    let glyphs = null; // the letters laid over the real ones, while it scrambles
    let shown = '';
    let now = 0; // the effect's time at its last frame

    const hover = (event) => {
      if (event.pointerType !== 'touch' && !kit.paused()) hovered = true;
    };
    element.addEventListener('pointerenter', hover);

    /** The real text, transparent, with a letter over each of its characters. */
    function build() {
      const real = document.createElement('span');
      real.style.color = 'transparent';
      real.append(...original);
      const over = document.createElement('span');
      over.setAttribute('aria-hidden', 'true');
      element.replaceChildren(real, over);
      if (getComputedStyle(element).position === 'static') element.style.position = 'relative';
      const origin = element.getBoundingClientRect();
      const node = original[0];
      const range = document.createRange();
      glyphs = [...text].map((char, i) => {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const box = range.getBoundingClientRect();
        const glyph = document.createElement('span');
        // Its line exactly the character's height, so its letter sits where the real one does.
        glyph.style.cssText = `position:absolute;left:${box.left - origin.left - element.clientLeft}px;top:${box.top - origin.top - element.clientTop}px;width:${box.width}px;height:${box.height}px;line-height:${box.height}px;text-align:center;white-space:pre;letter-spacing:0`;
        glyph.textContent = char;
        over.append(glyph);
        return { glyph, char };
      });
    }

    function restore() {
      if (!glyphs) return;
      glyphs = null;
      shown = '';
      element.replaceChildren(...original);
      element.style.removeProperty('position');
    }

    return {
      frame(time) {
        now = time;
        if (hovered) {
          hovered = false;
          if (!glyphs) starts.push(time);
        }
        const start = starts.findLast((s) => s <= time && time - s < HOLD + SETTLE);
        if (start === undefined) {
          restore();
          return false;
        }
        const step = Math.floor((time - start) / STEP);
        const key = `${start} ${step}`;
        if (key === shown) return false;
        if (!glyphs) build();
        shown = key;
        const last = Math.max(glyphs.length - 1, 1);
        glyphs.forEach(({ glyph, char }, i) => {
          const settled = time - start >= HOLD + SETTLE * (i / last);
          glyph.textContent = settled || !char.trim() ? char : GLYPHS[hash(i, step, start) % GLYPHS.length];
        });
      },
      // Paused by the visitor, or off the screen or in a hidden tab once it has been seen: the real
      // text, at once.
      pause() {
        if (kit.paused() || now > 0) {
          starts.length = 0;
          restore();
        }
      },
      destroy() {
        element.removeEventListener('pointerenter', hover);
        restore();
      },
    };
  },
};

/** The same choice of letter every time a moment is drawn again. */
function hash(i, step, start) {
  let h = Math.imul(i + 1, 2654435761) ^ Math.imul(step + 1, 2246822519) ^ Math.imul(Math.round(start * 1000) + 1, 3266489917);
  h ^= h >>> 15;
  return Math.abs(Math.imul(h, 668265263) ^ (h >>> 13));
}
