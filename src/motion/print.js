// Grain, dither and halftone on photos (dc-pipeline #56). The look is CSS (print.css), there from
// the first paint; this moves it. As a photo scrolls in it prints itself, filling in from the
// paper colour in the pattern's own order, the darks first: dither pixels in their ordered
// sequence, halftone dots growing from nothing. That is tied to the scrolling, as the opening
// photos are (scroll.js), from the photo's top coming onto the screen to its middle reaching the
// screen's, and never goes back. On a laptop the photo's own colours show through a soft circle
// under the cursor, which closes when it leaves; on a phone a tap opens one where the finger lands,
// for a moment (tap.js).
//
// A photo on the screen already, or above it, when its effect starts is printed already, and so is
// every photo while the visitor has paused motion: nothing blanks a photo before the script runs,
// so if it never does, every photo shows its look. A photo still loading is asked to load at once,
// and stays blank until it has.
//
// It plays once and then moves only in answer to the visitor: no pause control (`loops: false`),
// and the pause control leaves it be (`pausable: false`), but for printing at once. Grain has
// nothing of this: still grain is CSS alone, and moving grain is `grain`, below.

import { arrival, trail } from './scroll.js';
import { taps } from './tap.js';

const LENS = 110; // the circle's radius in CSS pixels; its edge fades over the outer half
const HOLD = 900; // milliseconds a tap's circle stays open

export default {
  loops: false,
  pausable: false,
  setup(element, kit) {
    const copy = element.querySelector(':scope > .dc-print-look .dc-print-tone img');
    if (!copy) return {};
    const blankLayer = copy.parentElement.querySelector('.dc-print-blank');
    const box = element.getBoundingClientRect();
    let way = kit.opening || kit.paused() || box.top < innerHeight ? 1 : 0; // how far the scrolling has taken it, never less
    let blank = 1 - way; // how much is still paper, trailing `way`
    let loaded = true;
    if (blank && !copy.complete) {
      loaded = false;
      copy.addEventListener('load', () => (loaded = true), { once: true });
      copy.addEventListener('error', () => (way = 1), { once: true });
      for (const img of element.querySelectorAll('img')) img.loading = 'eager';
    }
    const pointer = kit.pointer();
    let open = 0; // how far open the circle is, from 0 to 1
    let at = { x: 0.5, y: 0.5 }; // where it is, as a share of the element's width and height
    let tapped = { x: 0.5, y: 0.5, until: 0 };
    let last = 0;
    let drawn = '';

    const untap = taps(element, (event) => {
      const box = element.getBoundingClientRect();
      if (box.width && box.height) tapped = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height, until: performance.now() + HOLD };
    });

    const draw = () => {
      const state = `${blank} ${open} ${at.x} ${at.y}`;
      if (state === drawn) return false;
      drawn = state;
      if (blank > 0) element.style.setProperty('--dc-print-blank', blank.toFixed(3));
      else element.style.removeProperty('--dc-print-blank');
      blankLayer.style.willChange = blank > 0 ? 'opacity' : '';
      element.classList.toggle('is-lens', open > 0);
      if (open > 0) {
        element.style.setProperty('--dc-print-x', `${(at.x * 100).toFixed(2)}%`);
        element.style.setProperty('--dc-print-y', `${(at.y * 100).toFixed(2)}%`);
        element.style.setProperty('--dc-print-lens', `${(open * LENS).toFixed(1)}px`);
      } else {
        for (const name of ['--dc-print-x', '--dc-print-y', '--dc-print-lens']) element.style.removeProperty(name);
      }
    };
    draw();

    return {
      frame() {
        const now = performance.now();
        const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        if (blank > 0) {
          if (loaded) way = Math.max(way, arrival(element));
          blank = kit.paused() ? 0 : trail(blank, 1 - way, delta);
          if (blank < 0.005) blank = 0; // what is left of the paper can't be seen
        }
        const tapping = now < tapped.until;
        if (pointer.inside) at = { x: pointer.x, y: pointer.y };
        else if (tapping) at = { x: tapped.x, y: tapped.y };
        open = trail(open, pointer.inside || tapping ? 1 : 0, delta, 0.12);
        return draw();
      },
      destroy() {
        untap();
        blank = 0;
        open = 0;
        draw();
      },
    };
  },
};

/** Grain that moves like film (print.css's animation, while the runtime says it runs): it loops, so the page needs a MotionToggle. */
export const grain = {
  loops: true,
  setup: () => ({}),
};
