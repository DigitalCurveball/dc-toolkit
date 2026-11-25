// Photos that open as they arrive (dc-pipeline #55, #56): as the page scrolls a photo up the
// screen, it arrives one of five ways. Four open its frame: a window growing from its centre to its
// edges, or a wipe from its left, its right or its top, while the photo inside settles from a
// little enlarged to its true size. The fifth, `dither`, forms the photo from its own pixels in
// full colour, in the order of an ordered dither, the darks first and the lights last (reveal.css).
// All are tied to the scrolling, not a clock, which for the dropped heading reveal was "too quick
// to notice": each begins as the photo's top comes onto the screen and is done by the time the
// photo's middle reaches the screen's, trailing the scroll by a fraction of a second, as GSAP's
// "scrub" does, and never goes back. Then the photo is as it was, with nothing of the effect left
// on it.
//
// A dithered photo answers the visitor afterwards: a tap dissolves a circle around the finger back
// into its pixels for a moment, and it forms again (tap.js), and on a laptop the cursor stirs the
// pixels where it moves, which form again once it rests. Neither while motion is paused.
//
// Its still is the photo. A photo on the screen already, or above it, when its effect starts (as
// the page opens, or scrolled to before the script was ready) stays as it is, so the page's
// largest paint is never hidden; so does every photo while the visitor has paused motion, and
// pausing finishes one that is arriving. Nothing hides a photo before the script runs, so if it
// never does, every photo is as it is. A photo still loading is asked to load at once, and waits,
// hidden, until it has: opening an empty frame would show nothing opening.
//
// It moves only as the visitor scrolls or touches it: no pause control (`loops: false`), and the
// pause control leaves it be (`pausable: false`). It draws nothing, so it runs wherever scripts do.

import { taps } from './tap.js';

const LAG = 0.18; // seconds: how far behind the scrolling it trails, roughly
const ROUND = 24; // CSS pixels of corner added to the window from the centre, at its smallest
const SHAPES = {
  // Each the clip-path's inset, top right bottom left, from how far closed it is (1 closed, 0 open).
  centre: (c) => `${c * 50}% ${c * 50}% ${c * 50}% ${c * 50}%`,
  left: (c) => `0 ${c * 100}% 0 0`,
  right: (c) => `0 0 0 ${c * 100}%`,
  top: (c) => `0 0 ${c * 100}% 0`,
};
SHAPES.center = SHAPES.centre;
const DEPTH = 0.9; // how far a tap or the cursor dissolves a dithered photo: 1 is as far as its darks alone
const STILL = 250; // milliseconds after the cursor last moved that its pixels start to form again
const HOLD = 350; // milliseconds a tap's circle stays dissolved

export default {
  loops: false,
  pausable: false,
  setup(element, kit) {
    const { from = 'centre', zoom = 0.15 } = kit.options;
    if (from === 'dither') return dither(element, kit);
    const shape = SHAPES[from] ?? SHAPES.centre;
    if (!arriving(element, kit)) return {};
    const photo = element.querySelector('img, video');
    const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
    let done = false;
    let way = 0; // how far the scrolling has taken it, from 0 to 1, never less
    let open = 0; // how far open it is, trailing `way`
    let last = 0;

    const apply = () => {
      const closed = (1 - open) ** 3; // how far closed: quick to begin opening, slow to finish
      const corner = radius + (shape === SHAPES.centre ? closed * ROUND : 0);
      element.style.clipPath = `inset(${shape(closed)} round ${corner.toFixed(1)}px)`;
      if (photo) photo.style.transform = `scale(${(1 + zoom * closed).toFixed(4)})`;
    };
    const finish = () => {
      if (done) return;
      done = true;
      element.style.removeProperty('clip-path');
      element.style.removeProperty('will-change');
      photo?.style.removeProperty('transform');
      photo?.style.removeProperty('will-change');
    };

    const loading = load([photo], finish); // a broken photo is shown as it is
    if (done) return {};
    element.style.willChange = 'clip-path';
    if (photo) photo.style.willChange = 'transform';
    apply();

    return {
      frame() {
        if (done) return false;
        if (kit.paused()) return finish();
        const now = performance.now();
        const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
        last = now;
        if (loading.done) way = Math.max(way, arrival(element));
        if (open === way) return false;
        open = trail(open, way, delta);
        if ((1 - open) ** 3 < 0.001) return finish(); // what is left of it can't be seen
        apply();
      },
      destroy: finish,
    };
  },
};

/** The dither way in, and the circle a tap or the cursor dissolves afterwards: reveal.css's layer, shown and set from here. */
function dither(element, kit) {
  const look = element.querySelector(':scope > .dc-reveal-dither');
  const copy = look?.querySelector('img');
  if (!copy) return {};
  const photo = [...element.querySelectorAll('img')].find((img) => !look.contains(img));
  let way = arriving(element, kit) ? 0 : 1; // how far the scrolling has taken it, never less
  let formed = way; // how far formed it is, trailing `way`
  const loading = load([photo, copy], () => (way = 1));
  const pointer = kit.pointer();
  let stir = 0; // how far the circle has dissolved, from 0 to 1
  let at = { x: 0.5, y: 0.5 }; // where the circle is, as a share of the element's width and height
  let seen = ''; // where the cursor was last frame
  let moved = 0; // when it last moved
  let held = 0; // until when a tap's circle stays dissolved
  let drawn = '';
  let last = 0;

  const untap = taps(element, (event) => {
    const box = element.getBoundingClientRect();
    if (kit.paused() || formed < 1 || !box.width || !box.height) return;
    at = { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height };
    held = performance.now() + HOLD;
  });

  // How far the grey copy is pushed to white or black before the threshold: 1 is all paper, 0 the
  // photo's darks alone, -1 the whole photo.
  const draw = () => {
    const lens = formed >= 1 && stir > 0;
    const push = formed < 1 ? 1 - 2 * formed : lens ? -1 + DEPTH * stir : -1;
    const state = `${push} ${lens} ${at.x} ${at.y}`;
    if (state === drawn) return false;
    drawn = state;
    element.classList.toggle('is-dithering', push > -1);
    element.classList.toggle('is-lens', lens);
    if (push > -1) {
      element.style.setProperty('--dc-reveal-white', Math.max(push, 0).toFixed(3));
      element.style.setProperty('--dc-reveal-black', Math.max(-push, 0).toFixed(3));
    } else {
      element.style.removeProperty('--dc-reveal-white');
      element.style.removeProperty('--dc-reveal-black');
    }
    if (lens) {
      element.style.setProperty('--dc-reveal-x', `${(at.x * 100).toFixed(2)}%`);
      element.style.setProperty('--dc-reveal-y', `${(at.y * 100).toFixed(2)}%`);
    } else {
      element.style.removeProperty('--dc-reveal-x');
      element.style.removeProperty('--dc-reveal-y');
    }
  };
  draw();

  return {
    frame() {
      const now = performance.now();
      const delta = last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      if (formed < 1) {
        if (loading.done) way = Math.max(way, arrival(element));
        formed = kit.paused() ? 1 : trail(formed, way, delta);
        if (formed > 0.985) formed = 1; // past here no pixel is paper: the lightest needs the push under -0.97
      } else {
        const where = `${pointer.x} ${pointer.y}`;
        if (pointer.inside && where !== seen) {
          moved = now;
          at = { x: pointer.x, y: pointer.y };
        }
        seen = where;
        const stirring = !kit.paused() && ((pointer.inside && now - moved < STILL) || now < held);
        stir = trail(stir, stirring ? 1 : 0, delta, stirring ? 0.1 : 0.35);
        if (stir < 0.03) stir = 0; // under this no pixel is paper, as above
      }
      return draw();
    },
    destroy() {
      untap();
      formed = 1;
      stir = 0;
      draw();
    },
  };
}

/** Whether the element is below the screen, to arrive as it scrolls on: not on it or above it already, nor while motion is paused. */
function arriving(element, kit) {
  const box = element.getBoundingClientRect();
  return !kit.opening && !kit.paused() && box.top >= innerHeight && box.height > 0;
}

/** Images asked to load at once, and whether they all have (`done`); `failed` is called if one can't. */
function load(images, failed) {
  const state = { done: true };
  const waiting = new Set();
  for (const image of images) {
    if (!(image instanceof HTMLImageElement)) continue;
    if (image.complete) {
      if (!image.naturalWidth) failed();
      continue;
    }
    waiting.add(image);
    state.done = false;
    image.addEventListener('load', () => {
      waiting.delete(image);
      state.done = waiting.size === 0;
    }, { once: true });
    image.addEventListener('error', () => failed(), { once: true });
    image.loading = 'eager';
  }
  return state;
}

/**
 * How far the page has scrolled `element` on: 0 as its top comes onto the screen at the foot, 1 by
 * the time its middle reaches the screen's, or by the foot of the page if the page can't scroll so
 * far.
 */
function arrival(element) {
  const { top, height } = element.getBoundingClientRect();
  const foot = top - (document.documentElement.scrollHeight - innerHeight - scrollY); // its top, the page scrolled to its foot
  const end = Math.max(innerHeight / 2 - height / 2, foot);
  return innerHeight - end > 1 ? clamp((innerHeight - top) / (innerHeight - end)) : 1;
}

/** `value` moved toward `target` over `delta` seconds, about `lag` seconds behind, landing on it once within a thousandth. */
function trail(value, target, delta, lag = LAG) {
  if (Math.abs(target - value) < 0.001) return target;
  return value + (target - value) * (1 - Math.exp(-delta / lag));
}

const clamp = (n) => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), 1);
