// A scrolling band of display type (dc-pipeline #54): the site's words in a row that drifts
// sideways without stopping, and speeds up for a moment when the page is scrolled.
//
// Its still is the text as written, wrapping as any paragraph does (band.css). While it moves, the
// row is the text itself followed by copies of it, enough to fill the row twice over, each with a
// separator between: the copies and separators are hidden from screen readers, which hear the
// words once. The row moves by whole repeats, so its loop has no seam.
//
// It moves by itself for as long as it is on the screen, so it needs the page's pause control
// (`loops: true`; WCAG 2.2.2): put a MotionToggle beside it. Paused, it holds where it is.
//
// Options (data-motion-options, or the component's props):
//   speed      1, about 80 CSS pixels a second; 0.5 is half as fast
//   direction  'left' (the default) or 'right'
//   separator  what stands between the copies, '·'; '' for none

const SPEED = 80; // CSS pixels a second, at speed 1
const BOOST = 300; // a scroll of this many CSS pixels a second adds this speed again
const MOST = 4; // and up to this many times as fast in all

export default {
  loops: true,
  setup(element, kit) {
    const options = { speed: 1, direction: 'left', separator: '·', ...kit.options };
    const text = element.querySelector('.dc-band-text');
    if (!text) {
      console.error('dc-motion: a band needs its words in a .dc-band-text', element);
      return null;
    }
    const track = document.createElement('span');
    track.className = 'dc-band-track';
    text.replaceWith(track);
    track.append(text);
    let unit = 0; // the width of the text and a separator: the row repeats every this many pixels
    let rate = 1; // how much faster than its own speed it moves, after a scroll
    let extra = 0; // how far the scrolling has moved it beyond its own speed
    let lastY = scrollY;

    /** Copies enough to fill the row twice over, each after a separator. */
    function fill() {
      track.replaceChildren(text);
      const separator = () => {
        const mark = document.createElement('span');
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = options.separator;
        return mark;
      };
      const first = separator();
      track.append(first);
      unit = first.getBoundingClientRect().right - text.getBoundingClientRect().left + parseFloat(getComputedStyle(track).columnGap || 0);
      const copies = Math.ceil((element.clientWidth * 2) / Math.max(unit, 1));
      for (let i = 0; i < copies; i++) {
        const copy = text.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        track.append(copy, separator());
      }
    }

    return {
      resize: fill,
      frame(time, delta) {
        // A scroll speeds it up for a moment; the speed eases back once the page is still.
        const velocity = delta > 0 ? Math.abs(scrollY - lastY) / delta : 0;
        lastY = scrollY;
        const target = 1 + Math.min(velocity / BOOST, MOST - 1);
        rate += (target - rate) * (1 - Math.exp(-delta * (target > rate ? 8 : 2)));
        extra += SPEED * options.speed * (rate - 1) * delta;
        const offset = (SPEED * options.speed * time + extra) % Math.max(unit, 1);
        const x = options.direction === 'right' ? offset - unit : -offset;
        track.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
      },
      destroy() {
        track.replaceWith(text);
      },
    };
  },
};
