// Sections that stack like cards (dc-pipeline #55): cards pinned one after another with CSS's own
// `position: sticky` (stack.css), so the browser does the scrolling, each sliding up over the last,
// a little lower than it, while the ones beneath shrink a little, so their top edges show above
// like a deck. This sets only the shrinking, as --dc-stack-depth on each card: how many cards lie
// over it, with fractions while one slides over. And it does two things a template's stack gets
// wrong:
//
// - **A card taller than the screen pins by its foot**, not its top (stack.css, from each card's
//   height in --dc-stack-height), so the next can't cover lines not yet read.
// - **Tabbing into a covered card scrolls back to where it is uncovered**, so focus never lands
//   under another card (WCAG 2.4.11, Focus Not Obscured).
//
// It moves only as the visitor scrolls: it plays no part in the pause control (`pausable: false`)
// and needs none (`loops: false`). It draws nothing, so it runs wherever scripts do.

const ROOM = 24; // CSS pixels kept above a focused element scrolled back into view

export default {
  loops: false,
  pausable: false,
  setup(element) {
    const cards = [...element.children].filter((child) => child.classList.contains('dc-stack-card'));
    if (cards.length < 2) {
      console.error('dc-motion: a stack needs two or more .dc-stack-card, as its own children');
      return null;
    }
    let heights = [];
    let pins = []; // where each card's top pins on the screen, from stack.css
    let size = '';
    let last = '';

    const measure = () => {
      heights = cards.map((card) => card.offsetHeight);
      cards.forEach((card, i) => card.style.setProperty('--dc-stack-height', `${heights[i]}px`));
      pins = cards.map((card) => parseFloat(getComputedStyle(card).top) || 0);
      size = `${innerWidth} ${innerHeight}`;
      last = '';
    };

    const focus = (event) => {
      const i = cards.findIndex((card) => card.contains(event.target));
      if (i < 0 || i === cards.length - 1) return;
      const target = event.target.getBoundingClientRect();
      if (cards[i + 1].getBoundingClientRect().top >= target.bottom) return; // not covered
      // Where the card's top is in the page with nothing pinned: the cards one after another.
      const css = getComputedStyle(element);
      const gap = parseFloat(css.rowGap) || 0;
      let y = element.getBoundingClientRect().top + scrollY + parseFloat(css.borderTopWidth) + parseFloat(css.paddingTop);
      for (const [k, card] of cards.entries()) {
        const style = getComputedStyle(card);
        y += parseFloat(style.marginTop);
        if (k === i) break;
        y += heights[k] + parseFloat(style.marginBottom) + gap;
      }
      // There, just as it pins, the next card hasn't reached it; higher still if the focused
      // element would be above the screen, as on a tall card pinned by its foot.
      const card = cards[i].getBoundingClientRect();
      const scale = card.width / cards[i].offsetWidth || 1;
      const within = (target.top - card.top) / scale;
      scrollTo(scrollX, Math.min(y - pins[i], y + within - ROOM));
    };
    element.addEventListener('focusin', focus);

    return {
      resize: measure,
      frame() {
        if (`${innerWidth} ${innerHeight}` !== size) measure();
        const state = String(element.getBoundingClientRect().top);
        if (state === last) return false;
        last = state;
        const tops = cards.map((card) => card.getBoundingClientRect().top);
        let depth = 0;
        for (let i = cards.length - 1; i >= 0; i--) {
          cards[i].style.setProperty('--dc-stack-depth', depth.toFixed(3));
          if (i === 0) break;
          // How far this card has slid over the one before, of the way it goes.
          const over = tops[i - 1] + heights[i - 1] - tops[i];
          const full = heights[i - 1] - (pins[i] - pins[i - 1]);
          depth += clamp(full > 1 ? over / full : 0);
        }
      },
      destroy() {
        element.removeEventListener('focusin', focus);
        for (const card of cards) {
          card.style.removeProperty('--dc-stack-depth');
          card.style.removeProperty('--dc-stack-height');
        }
      },
    };
  },
};

const clamp = (n) => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), 1);
