// The logo formed from particles (dc-pipeline #51): the site's logo as fine dots of its own
// colours, which gather into it when it is first seen, move aside from a mouse or pen and spring
// back, and drift apart as the logo scrolls off the top of the screen, gathering again when it
// comes back: a phone has no pointer, but it scrolls.
//
// Its still is the logo itself: the element's first <svg> or <img>, or the one marked
// `data-motion-still`, an inline SVG or an image of an SVG or of a PNG on a transparent ground. It
// shows without scripts, under reduced motion and until the dots have drawn, then fades as they
// fade in (motion.css), scattered around it at their first moment. Its colours are read from the
// page, so a logo coloured by the site's CSS keeps them. Its text must be outlined
// (dc-outline-text): an SVG drawn as an image can't load fonts.
//
// It gathers once, in a little over two seconds, and then moves only when the visitor does: it
// needs no pause control (`loops: false`), and draws nothing while nothing moves. The dots fill
// the element, so give the logo room in it to gather from; text inside it is measured over them
// (dc-qa).
//
// Options (data-motion-options, or the component's props):
//   spacing  the distance between dots, in CSS pixels at the logo's size, 3
//   speed    how fast the dots gather, 1; 0.5 is half as fast
//   pointer  how far a mouse or pen pushes the dots, 1; 0 ignores it
//   scroll   how far the dots drift apart as the logo scrolls off the top, 1; 0 keeps it whole
//
// A 2D canvas, where the moving background uses WebGL: a few thousand squares is light work for
// one, with no shader to compile, and drawn in software it costs about what it costs a phone.

const MOST = 12000; // dots at most: past this, they are spaced wider
const DOT = 0.72; // a dot's size, as a share of the spacing
const GATHER = 1.6; // seconds each dot takes to gather
const STAGGER = 0.6; // the longest a dot waits before it sets off
const SPREAD = [0.12, 0.55]; // how far from its place a dot starts, as a share of the logo's size
const SWIRL = 0.3; // how far the dots curve as they gather, as a share of their way
const DRIFT = [0.25, 0.9]; // how far a dot drifts as the logo scrolls off, as a share of its size
const REACH = 0.22; // how far the pointer reaches, as a share of the logo's width
const PUSH = 0.5; // how far a dot under the pointer moves, as a share of the reach
const SPRING = 170; // how hard a pushed dot is pulled back to its place
const DAMPING = 16; // and how quickly its swing dies

export default {
  loops: false,
  setup(element, kit) {
    const options = { spacing: 3, speed: 1, pointer: 1, scroll: 1, ...kit.options };
    const logo = element.querySelector('[data-motion-still]') ?? element.querySelector('svg, img');
    if (!logo) {
      console.error('dc-motion: the particle logo has no <svg> or <img> inside it to draw');
      return null;
    }
    logo.setAttribute('data-motion-still', '');
    const canvas = kit.layer('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    // A 2D canvas can lose its context too, in Chromium, when the GPU resets.
    canvas.addEventListener('contextlost', kit.lost);
    canvas.addEventListener('contextrestored', kit.restored);

    const pointer = kit.pointer();
    let dots = null; // the dots, once the logo has been read
    let reading = false;
    let tried = 0; // the width the logo was last read at, so a failed read isn't tried every frame
    let width = 0;
    let height = 0;
    let ratio = 1;
    let dirty = true;
    let moving = false; // a dot is on its way to where the pointer pushes it, or back
    let last = '';
    let gone = false;

    async function read(w, h) {
      reading = true;
      tried = w;
      try {
        dots = make(await pixels(logo, w, h), w, h, options.spacing);
        dirty = true;
      } catch (error) {
        // An image from another origin without CORS, say, or one that didn't load: the still stays.
        if (!dots && !gone) {
          console.error('dc-motion: the particle logo could not read its logo', error);
          kit.failed();
        }
      }
      reading = false;
    }

    return {
      resize(w, h, dpr) {
        width = w;
        height = h;
        ratio = Math.min(dpr, 2);
        canvas.width = Math.max(1, Math.round(w * ratio));
        canvas.height = Math.max(1, Math.round(h * ratio));
        dirty = true;
      },
      frame(time, delta) {
        const outer = element.getBoundingClientRect();
        const box = logo.getBoundingClientRect();
        const lw = Math.round(box.width);
        const lh = Math.round(box.height);
        if (!lw || !lh) return false;
        // Read again when the logo is drawn at a size far from the one it was read at, and until
        // then scale the dots read before.
        if (!reading && lw !== tried && (!dots || Math.abs(lw / dots.width - 1) > 0.25)) read(lw, lh);
        if (!dots) return false;

        const k = lw / dots.width;
        const left = box.left - outer.left - element.clientLeft;
        const top = box.top - outer.top - element.clientTop;
        const gather = Math.min(time * options.speed, STAGGER + GATHER);
        // Drifting apart: from when the logo's top passes a quarter of the way down the screen (or
        // where it starts, for a logo above that), until it has moved up its own height, so it
        // comes apart while it is still in view.
        const line = Math.min(innerHeight * 0.25, box.top + scrollY);
        const apart = options.scroll > 0 ? Math.min(Math.max((line - box.top) / lh, 0), 1) : 0;
        const reach = options.pointer > 0 && pointer.inside;

        const state = [canvas.width, canvas.height, left, top, lw, gather, apart, reach && pointer.x, reach && pointer.y].join(' ');
        if (!dirty && !moving && state === last) return false;
        dirty = false;
        last = state;

        if (reach || moving) moving = push(dots, delta, pointer.x * width - left, pointer.y * height - top, reach, k, lw, options.pointer);
        draw(context, dots, { k, left, top, gather, apart: apart * apart * options.scroll, ratio, size: dots.spacing * DOT * k });
      },
      destroy() {
        gone = true;
        canvas.removeEventListener('contextlost', kit.lost);
        canvas.removeEventListener('contextrestored', kit.restored);
      },
    };
  },
};

/** The logo drawn at `width` by `height` CSS pixels, as RGBA; throws where it can't be read. */
async function pixels(logo, width, height) {
  let image = logo;
  if (logo instanceof HTMLImageElement) await logo.decode();
  else image = await svgImage(logo, width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

// What an inline SVG's shapes take from the page's CSS, written onto a copy of it, since an SVG
// drawn as an image sees none of the page's styles. The logo's own opacity is left out: it is 0
// while the dots show.
const STYLES = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'visibility', 'display'];

function svgImage(svg, width, height) {
  const copy = svg.cloneNode(true);
  const originals = svg.querySelectorAll('*');
  copy.querySelectorAll('*').forEach((node, i) => {
    const style = getComputedStyle(originals[i]);
    node.setAttribute('style', STYLES.map((name) => `${name}:${style.getPropertyValue(name)}`).join(';'));
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', width);
  copy.setAttribute('height', height);
  copy.removeAttribute('style');
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  const image = new Image();
  image.src = url;
  return image.decode().then(() => image).finally(() => URL.revokeObjectURL(url));
}

/** A dot at every `spacing` pixels the logo paints, grouped by colour, each with its own way in and out. */
function make(data, width, height, spacing) {
  let found;
  for (;;) {
    found = [];
    for (let y = spacing / 2; y < height; y += spacing) {
      for (let x = spacing / 2; x < width; x += spacing) {
        const i = (Math.floor(y) * width + Math.floor(x)) * 4;
        if (data[i + 3] >= 128) found.push({ x, y, colour: `rgb(${data[i]} ${data[i + 1]} ${data[i + 2]})` });
      }
    }
    if (found.length <= MOST) break;
    spacing *= Math.sqrt(found.length / MOST) * 1.01;
  }
  found.sort((a, b) => (a.colour < b.colour ? -1 : a.colour > b.colour ? 1 : 0));

  const n = found.length;
  const size = Math.max(width, height);
  const random = seeded(n);
  const dots = {
    n, width, spacing, groups: [],
    home: new Float32Array(n * 2), // its place in the logo
    from: new Float32Array(n * 2), // where it starts, from its place
    away: new Float32Array(n * 2), // where it drifts as the logo scrolls off, from its place
    wait: new Float32Array(n), // how long it waits before it sets off
    offset: new Float32Array(n * 2), // how far the pointer has pushed it
    velocity: new Float32Array(n * 2),
  };
  found.forEach(({ x, y, colour }, i) => {
    if (colour !== dots.groups.at(-1)?.colour) dots.groups.push({ colour, from: i, to: i });
    dots.groups.at(-1).to = i + 1;
    dots.home[i * 2] = x;
    dots.home[i * 2 + 1] = y;
    // Both ways lead outward from the logo's centre, give or take, so it gathers from a cloud
    // around itself and scatters into one.
    const outward = Math.atan2(y - height / 2, x - width / 2);
    const start = outward + (random() - 0.5) * Math.PI;
    const far = size * (SPREAD[0] + random() * (SPREAD[1] - SPREAD[0]));
    dots.from[i * 2] = Math.cos(start) * far;
    dots.from[i * 2 + 1] = Math.sin(start) * far;
    const drift = outward + (random() - 0.5) * 1.2;
    const farther = size * (DRIFT[0] + random() * (DRIFT[1] - DRIFT[0]));
    dots.away[i * 2] = Math.cos(drift) * farther;
    dots.away[i * 2 + 1] = Math.sin(drift) * farther;
    dots.wait[i] = random() * STAGGER;
  });
  return dots;
}

/** Moves each dot toward where the pointer pushes it, or back to its place; whether any is still on its way. */
function push(dots, delta, px, py, reach, k, lw, strength) {
  const { n, home, offset, velocity } = dots;
  const radius = REACH * lw;
  let moving = false;
  // Short steps, so the spring holds steady through a slow frame.
  const steps = Math.ceil(delta / (1 / 60));
  const dt = delta / Math.max(steps, 1);
  for (let i = 0; i < n * 2; i += 2) {
    let tx = 0;
    let ty = 0;
    if (reach) {
      const dx = home[i] * k - px;
      const dy = home[i + 1] * k - py;
      const d = Math.hypot(dx, dy) || 1;
      if (d < radius) {
        const f = ((1 - d / radius) ** 2 * radius * PUSH * strength) / d;
        tx = dx * f;
        ty = dy * f;
      }
    }
    for (let s = 0; s < steps; s++) {
      velocity[i] += ((tx - offset[i]) * SPRING - velocity[i] * DAMPING) * dt;
      velocity[i + 1] += ((ty - offset[i + 1]) * SPRING - velocity[i + 1] * DAMPING) * dt;
      offset[i] += velocity[i] * dt;
      offset[i + 1] += velocity[i + 1] * dt;
    }
    if (Math.abs(tx - offset[i]) + Math.abs(ty - offset[i + 1]) + Math.abs(velocity[i]) + Math.abs(velocity[i + 1]) > 0.05) moving = true;
  }
  if (!moving && !reach) {
    offset.fill(0);
    velocity.fill(0);
  }
  return moving;
}

/** Every dot where it is at this moment, on whole device pixels so each stays sharp. */
function draw(context, dots, { k, left, top, gather, apart, ratio, size }) {
  const { home, from, away, wait, offset } = dots;
  const side = Math.max(1, Math.round(size * ratio));
  const half = side / 2;
  context.clearRect(0, 0, context.canvas.width, context.canvas.height);
  context.globalAlpha = 1 - 0.5 * apart;
  for (const group of dots.groups) {
    context.fillStyle = group.colour;
    for (let i = group.from; i < group.to; i++) {
      const j = i * 2;
      const p = Math.min(Math.max((gather - wait[i]) / GATHER, 0), 1);
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
      const rest = 1 - e;
      const curl = SWIRL * 4 * e * rest;
      const x = (home[j] + from[j] * rest - from[j + 1] * curl + away[j] * apart) * k + offset[j] + left;
      const y = (home[j + 1] + from[j + 1] * rest + from[j] * curl + away[j + 1] * apart) * k + offset[j + 1] + top;
      context.fillRect(Math.round(x * ratio - half), Math.round(y * ratio - half), side, side);
    }
  }
}

/** The same sequence of numbers from 0 to 1 every time, so any moment can be drawn again. */
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
