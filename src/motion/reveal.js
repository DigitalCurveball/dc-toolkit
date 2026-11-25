// Photos that open as they arrive (dc-pipeline #55): as the page scrolls a photo up the screen, its
// frame opens, a window growing from its centre to its edges (or a wipe from its left, its right
// or its top), while the photo inside settles from a little enlarged to its true size. Tied to the
// scrolling, not a clock, which for the dropped heading reveal was "too quick to notice": it begins
// as the photo's top comes onto the screen and is open by the time the photo's middle reaches the
// screen's, trailing the scroll by a fraction of a second, as GSAP's "scrub" does, and it never
// closes again. Then the photo is as it was, with nothing of the effect left on it.
//
// Its still is the photo. A photo on the screen already, or above it, when its effect starts (as
// the page opens, or scrolled to before the script was ready) stays as it is, so the page's
// largest paint is never hidden; so does every photo while the visitor has paused motion, and
// pausing opens one that is opening. Nothing hides a photo before the script runs, so if it never
// does, every photo is as it is. A photo still loading is asked to load at once, and waits, closed,
// until it has: opening an empty frame would show nothing opening.
//
// It moves only as the visitor scrolls: no pause control (`loops: false`), and the pause control
// leaves it be (`pausable: false`). It draws nothing, so it runs wherever scripts do.

const LAG = 0.18; // seconds: how far behind the scrolling the opening trails, roughly
const ROUND = 24; // CSS pixels of corner added to the window from the centre, at its smallest
const SHAPES = {
  // Each the clip-path's inset, top right bottom left, from how far closed it is (1 closed, 0 open).
  centre: (c) => `${c * 50}% ${c * 50}% ${c * 50}% ${c * 50}%`,
  left: (c) => `0 ${c * 100}% 0 0`,
  right: (c) => `0 0 0 ${c * 100}%`,
  top: (c) => `0 0 ${c * 100}% 0`,
};
SHAPES.center = SHAPES.centre;

export default {
  loops: false,
  pausable: false,
  setup(element, kit) {
    const { from = 'centre', zoom = 0.15 } = kit.options;
    const shape = SHAPES[from] ?? SHAPES.centre;
    const box = element.getBoundingClientRect();
    if (kit.opening || kit.paused() || box.top < innerHeight || !box.height) return {};
    const photo = element.querySelector('img, video');
    const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
    let loaded = true;
    if (photo instanceof HTMLImageElement && !photo.complete) {
      loaded = false;
      photo.addEventListener('load', () => (loaded = true), { once: true });
      photo.addEventListener('error', () => finish(), { once: true });
      photo.loading = 'eager';
    } else if (photo instanceof HTMLImageElement && !photo.naturalWidth) {
      return {}; // a broken image: nothing to open
    }
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
        if (loaded) {
          const { top, height } = element.getBoundingClientRect();
          // Open once its middle reaches the screen's, or as far as the page can scroll, if not so far.
          const foot = top - (document.documentElement.scrollHeight - innerHeight - scrollY);
          const end = Math.max(innerHeight / 2 - height / 2, foot);
          way = Math.max(way, innerHeight - end > 1 ? clamp((innerHeight - top) / (innerHeight - end)) : 1);
        }
        if (open === way) return false;
        open = way - open < 0.001 ? way : open + (way - open) * (1 - Math.exp(-delta / LAG));
        if ((1 - open) ** 3 < 0.001) return finish(); // what is left of it can't be seen
        apply();
      },
      destroy: finish,
    };
  },
};

const clamp = (n) => Math.min(Math.max(Number.isFinite(n) ? n : 0, 0), 1);
