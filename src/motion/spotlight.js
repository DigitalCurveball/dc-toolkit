// A cursor spotlight (dc-pipeline #57): on a dark section, a faint glow in a brand colour follows a
// mouse or pen, and the cards near it (`.dc-spotlight-card`) light at their edges, as Linear's and
// Vercel's spotlight cards do. spotlight.css draws both from --dc-spotlight-x, --dc-spotlight-y and
// --dc-spotlight-on (from 0 to 1), set here on the section, in its CSS pixels, and on each card, in
// the card's: never only on the section for the cards to inherit, which restyled everything inside
// it on every frame the light moved (spotlight.css). On a phone a
// tap lights the spot for a moment (tap.js, the ripple's rule: only a tap, and none on a section
// inside a link or holding one).
//
// Its still is the section without the glow. Text over the glow must pass contrast at its
// brightest: dc-qa places the glow behind each line to measure it, since it can't move a cursor.
// It moves only in answer to the visitor: no pause control (`loops: false`), and the pause control
// leaves it be (`pausable: false`), but for putting the light out.

import { taps } from './tap.js';

const HOLD = 900; // milliseconds a tap's light stays on

export default {
  loops: false,
  pausable: false,
  setup(element, kit) {
    const cards = [...element.querySelectorAll('.dc-spotlight-card')];
    const pointer = kit.pointer();
    let on = 0;
    let at = { x: 0, y: 0 };
    let places = cards.map(() => ({ left: 0, top: 0 })); // each card's place in the section
    let held = 0;
    let drawn = '';
    let last = 0;
    const untap = taps(element, (event) => {
      if (kit.paused()) return;
      const box = element.getBoundingClientRect();
      at = { x: event.clientX - box.left, y: event.clientY - box.top };
      held = performance.now() + HOLD;
    });

    const draw = () => {
      const state = `${on} ${at.x} ${at.y}`;
      if (state === drawn) return false;
      drawn = state;
      light(element, on, at);
      cards.forEach((card, i) => light(card, on, { x: at.x - places[i].left, y: at.y - places[i].top }));
    };

    return {
      resize() {
        const box = element.getBoundingClientRect();
        places = cards.map((card) => {
          const place = card.getBoundingClientRect();
          return { left: place.left - box.left, top: place.top - box.top };
        });
        drawn = ''; // the cards' light moves with their places
      },
      frame() {
        const now = performance.now();
        const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        const lit = !kit.paused() && (pointer.inside || now < held);
        if (pointer.inside) {
          const box = element.getBoundingClientRect();
          at = { x: pointer.x * box.width, y: pointer.y * box.height };
        }
        const target = lit ? 1 : 0;
        on = Math.abs(target - on) < 0.02 ? target : on + (target - on) * (1 - Math.exp(-delta / (lit ? 0.15 : 0.3))); // 2% of a faint glow can't be seen
        return draw();
      },
      destroy() {
        untap();
        on = 0;
        draw();
      },
    };
  },
};

/** The light on one element, at a point in its own CSS pixels: off, nothing is set. */
function light(target, on, at) {
  if (on > 0) {
    target.style.setProperty('--dc-spotlight-on', on.toFixed(3));
    target.style.setProperty('--dc-spotlight-x', `${at.x.toFixed(1)}px`);
    target.style.setProperty('--dc-spotlight-y', `${at.y.toFixed(1)}px`);
  } else {
    for (const name of ['--dc-spotlight-on', '--dc-spotlight-x', '--dc-spotlight-y']) target.style.removeProperty(name);
  }
}
